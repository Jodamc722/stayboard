// NIGHTLY BILLING-DETAIL SYNC (Jon, 2026-08-17: "feel like our maintenance rev is low, make sure
// it's all accounted for" — it was low because THIS pull was a manual button nobody pressed).
//
// The Breezeway task LIST the mirror syncs from does not carry costs[]/supplies[]; only the
// per-task retrieve does. Any task whose detail was never retrieved bills $0 in the labor engine
// no matter what a tech typed in Breezeway. Measured 2026-08-17: 601 August tasks had no detail
// row; pulling them moved 30-day maintenance revenue from $6,855 to $8,140 (+19%) with zero code
// changes. So this cron retrieves whatever the current month is missing, every night, gently and
// resumably — the same logic as the manual POST /api/billing/detail, without needing a human.
//
// 2026-08-24: IT ONLY EVER LOOKED AT THE CURRENT MONTH, so a task that slipped through in July
// stayed undetailed forever and billed $0 forever. Nobody would ever see it: the gap is silent by
// construction, because an unpulled task is indistinguishable from a task with nothing to bill.
// That is real money left on the table every month, permanently. So after the current month is
// clean, whatever time is left in the run walks BACKWARDS through earlier months, oldest gap
// first, up to a year. The month it is working on is remembered, so each night resumes where the
// last one stopped rather than re-checking the same months forever.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { retrieveBreezewayTask, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { monthTasks } from '@/lib/billing'
import { getSetting, setSetting } from '@/lib/app-settings'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const BACKFILL_KEY = 'billing_detail_backfill_month'
const MAX_MONTHS_BACK = 12

function shiftMonth(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron). Until 2026-08-20
// this route had no check of any kind while running for up to five minutes, hammering the
// Breezeway API and writing to two tables.
// RECEIPT (2026-09-28): the registry has always said this job writes one; it never did.
const receipted = withRouteReceipt<NextRequest>('billing-detail', run, { count: (b) => (typeof b.done === 'number' ? b.done : undefined) })
export async function GET(req: NextRequest) { return receipted(req) }

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway not configured' })
  const db = supabaseAdmin()
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  const started = Date.now()
  const BUDGET_MS = 250_000
  // `gone` = Breezeway answered 404: the task no longer exists, so it is not a failure — but it is
  // counted, because it will be asked about again every night until the mirror forgets it.
  let done = 0, failed = 0, gone = 0, remaining = 0
  let firstError = ''
  const monthsTouched: string[] = []

  /** Which tasks in one month still have no billing detail, money-first. */
  async function gapsFor(ym: string): Promise<string[]> {
    const tasks = await monthTasks(ym)
    const tids = tasks.map((t: any) => String(t.id))
    const have: Record<string, boolean> = {}
    for (let i = 0; i < tids.length; i += 400) {
      const chunk = tids.slice(i, i + 400)
      if (!chunk.length) break
      const { data } = await db.from('breezeway_billing_details').select('task_id').in('task_id', chunk)
      for (const d of (data || []) as any[]) have[String(d.task_id)] = true
    }
    // Money first, same as the manual pull: rated tasks, then maintenance, then the rest.
    const rated = tasks.filter((t: any) => Number(t.rate_paid) > 0 && !have[String(t.id)])
    const maint = tasks.filter((t: any) => !(Number(t.rate_paid) > 0) && String(t.type_department || '') === 'maintenance' && !have[String(t.id)])
    const rest = tasks.filter((t: any) => !(Number(t.rate_paid) > 0) && String(t.type_department || '') !== 'maintenance' && !have[String(t.id)])
    return rated.concat(maint, rest).map((t: any) => String(t.id))
  }

  /** Pull detail for a list of task ids until the budget runs out. Returns how many were left. */
  async function pull(ids: string[]): Promise<number> {
    let i = 0
    for (; i < ids.length; i++) {
      if (Date.now() - started > BUDGET_MS) break
      const id = ids[i]
      let r: any
      try { r = await retrieveBreezewayTask(id) } catch (e: any) { failed++; if (!firstError) firstError = String(e?.message || e).slice(0, 160); continue }
      if (r?.status === 404) { gone++; await sleep(120); continue }
      if (!r?.ok || !r.data) { failed++; if (!firstError) firstError = 'Breezeway ' + (r?.status ?? '?') + ' on task ' + id; await sleep(120); continue }
      const t = r.data
      try {
        await db.from('breezeway_billing_details').upsert({
          task_id: id,
          bill_to: t?.bill_to ? String(t.bill_to) : null,
          rate_type: t?.rate_type ? String(t.rate_type) : null,
          costs: Array.isArray(t?.costs) ? t.costs : [],
          supplies: Array.isArray(t?.supplies) ? t.supplies : [],
          synced_at: new Date().toISOString(),
        }, { onConflict: 'task_id' })
        const m: any = mapBreezewayTask(t)
        if (m?.id) {
          const rp = Number(m.rate_paid)
          m.rate_paid = Number.isFinite(rp) ? rp : null
          m.synced_at = new Date().toISOString()
          await db.from('breezeway_tasks_sync').upsert(m, { onConflict: 'id' })
        }
        done++
      } catch { failed++ }
      await sleep(120)
    }
    return ids.length - i
  }

  // THIS MONTH FIRST, ALWAYS. Current-month revenue is what anybody is looking at today, and a
  // backfill must never be able to starve it.
  const current = await gapsFor(month)
  if (current.length) {
    monthsTouched.push(month)
    remaining += await pull(current)
  }

  // Then walk backwards with whatever time is left. Resume from where last night stopped; when the
  // walk reaches the end, start again from the month before this one, because tasks keep landing
  // late and a month that was clean in September can have a hole by November.
  let cursor = await getSetting<string>(BACKFILL_KEY, '')
  const oldest = shiftMonth(month, -MAX_MONTHS_BACK)
  if (!cursor || cursor < oldest || cursor >= month) cursor = shiftMonth(month, -1)

  while (Date.now() - started < BUDGET_MS && cursor >= oldest) {
    const gaps = await gapsFor(cursor)
    if (gaps.length) {
      monthsTouched.push(cursor)
      const left = await pull(gaps)
      remaining += left
      // Out of time with work still to do here — stay on this month tomorrow.
      if (left > 0) break
    }
    cursor = shiftMonth(cursor, -1)
  }
  await setSetting(BACKFILL_KEY, cursor, 'billing-detail-cron')

  // HONEST OK (2026-09-28): a night where calls failed and nothing landed is a failure, not
  // `ok: true` — that is what a dead token or a Breezeway outage looks like from here.
  const ok = failed === 0 || done > 0
  return NextResponse.json({
    ok, month, monthsTouched, backfillCursor: cursor, done, failed, gone, remaining,
    ...(ok ? {} : { error: failed + ' task detail call(s) failed and none landed — first: ' + firstError }),
  })
}
