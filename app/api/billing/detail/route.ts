// BILLING DETAIL PULL — the task list we mirror does not reliably carry costs[], supplies[],
// bill_to or rate_type; the single-task retrieve does. POST { month } refreshes every task in
// that month that has no detail row yet (or ?stale=1 re-pulls everything), POST { taskIds } does
// exactly those tasks. Sequential with a small gap — Breezeway's data-endpoint rate limits are
// undocumented, so this is deliberately gentle and resumable (call again to continue).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { retrieveBreezewayTask, mapBreezewayTask, breezewayConfigured } from '@/lib/breezeway'
import { monthTasks } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway is not configured.' }, { status: 400 })
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const explicit: string[] = Array.isArray(body?.taskIds) ? body.taskIds.map((x: any) => String(x)).filter(Boolean) : []
  const month = String(body?.month || '').slice(0, 7)
  const all = !!body?.all

  let ids: string[] = explicit
  if (!ids.length && month) {
    const tasks = await monthTasks(month)
    const tids = tasks.map(t => String(t.id))
    if (all) ids = tids
    else {
      // only the ones with no detail row yet
      const have: Record<string, boolean> = {}
      for (let i = 0; i < tids.length; i += 400) {
        const chunk = tids.slice(i, i + 400)
        if (!chunk.length) break
        const { data } = await db.from('breezeway_billing_details').select('task_id').in('task_id', chunk)
        for (const d of (data || []) as any[]) have[String(d.task_id)] = true
      }
      // Money first: tasks with a rate, then maintenance, then the rest.
      const rated = tasks.filter(t => Number(t.rate_paid) > 0 && !have[String(t.id)])
      const maint = tasks.filter(t => !(Number(t.rate_paid) > 0) && String(t.type_department || '') === 'maintenance' && !have[String(t.id)])
      const rest = tasks.filter(t => !(Number(t.rate_paid) > 0) && String(t.type_department || '') !== 'maintenance' && !have[String(t.id)])
      ids = rated.concat(maint, rest).map(t => String(t.id))
    }
  }
  if (!ids.length) return NextResponse.json({ ok: true, done: 0, failed: 0, remaining: 0 })

  const started = Date.now()
  let done = 0
  let failed = 0
  let i = 0
  for (; i < ids.length; i++) {
    if (Date.now() - started > 250_000) break
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
      // keep the mirror row fresh too (status / hours / rate move with the retrieve)
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
  return NextResponse.json({ ok: true, done, failed, remaining: ids.length - i })
}
