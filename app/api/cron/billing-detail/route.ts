// NIGHTLY BILLING-DETAIL SYNC (Jon, 2026-08-17: "feel like our maintenance rev is low, make sure
// it's all accounted for" — it was low because THIS pull was a manual button nobody pressed).
//
// The Breezeway task LIST the mirror syncs from does not carry costs[]/supplies[]; only the
// per-task retrieve does. Any task whose detail was never retrieved bills $0 in the labor engine
// no matter what a tech typed in Breezeway. Measured 2026-08-17: 601 August tasks had no detail
// row; pulling them moved 30-day maintenance revenue from $6,855 to $8,140 (+19%) with zero code
// changes. So this cron retrieves whatever the current month is missing, every night, gently and
// resumably — the same logic as the manual POST /api/billing/detail, without needing a human.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { retrieveBreezewayTask, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { monthTasks } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function GET() {
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway not configured' })
  const db = supabaseAdmin()
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  const tasks = await monthTasks(month)
  const tids = tasks.map(t => String(t.id))
  const have: Record<string, boolean> = {}
  for (let i = 0; i < tids.length; i += 400) {
    const chunk = tids.slice(i, i + 400)
    if (!chunk.length) break
    const { data } = await db.from('breezeway_billing_details').select('task_id').in('task_id', chunk)
    for (const d of (data || []) as any[]) have[String(d.task_id)] = true
  }
  // Money first, same as the manual pull: rated tasks, then maintenance, then the rest.
  const rated = tasks.filter(t => Number(t.rate_paid) > 0 && !have[String(t.id)])
  const maint = tasks.filter(t => !(Number(t.rate_paid) > 0) && String(t.type_department || '') === 'maintenance' && !have[String(t.id)])
  const rest = tasks.filter(t => !(Number(t.rate_paid) > 0) && String(t.type_department || '') !== 'maintenance' && !have[String(t.id)])
  const ids = rated.concat(maint, rest).map(t => String(t.id))
  if (!ids.length) return NextResponse.json({ ok: true, month, done: 0, failed: 0, remaining: 0 })

  const started = Date.now()
  let done = 0, failed = 0, i = 0
  for (; i < ids.length; i++) {
    if (Date.now() - started > 250_000) break   // resumable: tomorrow's run continues
    const id = ids[i]
    let r: any
    try { r = await retrieveBreezewayTask(id) } catch { failed++; continue }
    if (!r?.ok || !r.data) { failed++; await sleep(120); continue }
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
  return NextResponse.json({ ok: true, month, done, failed, remaining: ids.length - i })
}
