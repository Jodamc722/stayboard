// ONE OPEN TASK PER UNIT PER CADENCE (Jon, 2026-10-28: "We should never create a duplicate task
// for filter changes, we should move if not completed… I see many duplicates. Delete them").
//
// TWO PARTS.
//   openCadenceTaskMap — every OPEN Breezeway task whose name matches a cadence, by unit, read straight
//     from the mirror with NO department veto and a wide date window. The recurrence pass asks this
//     before it creates anything: if the unit already has one, that task is the successor — it is
//     MOVED (when its day has passed) instead of a second one being filed.
//   dedupeCadenceTasks — the clean-up. Per unit, keep one open task and CANCEL the rest in
//     Breezeway (cancel, not complete: it does not claim the work was done, and a cancelled task can
//     be reopened). The kept task is the one somebody started, else the one the ledger points at,
//     else the oldest; if its day has passed it moves to the unit's next checkout (filters ride the
//     departure) or today.
//
// WHY THEY DUPLICATED. The due calendar decides "already scheduled" with a department check: a
// filter task filed under Housekeeping (it rides the departure clean) did not count as the
// maintenance cadence's task, so the pass filed another — every run, until the cap. The ledger also
// reset a "created" row to "scheduled" whenever the calendar did not see its task, which re-armed it.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { getSetting } from './app-settings'
import { CADENCE_KEY, resolveCadences, cadenceRe, type CadenceDef } from './cadences'
import { cancelBreezewayTask, updateBreezewayTask, breezewayConfigured } from './breezeway'
import { isTaskDone, isTaskGone, isTaskRunning } from './task-categories'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (ymd: string, days: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + days * 86400000))

export type OpenCadenceTask = { id: string; listingId: string; name: string; date: string; dept: string; started: boolean; assigned: boolean }

/** Open tasks matching each cadence, by cadence key then listing id. Any department; 200 days back, 200 ahead. One read for all. */
export async function openCadenceTaskMap(cads: CadenceDef[], today = ymdET(new Date())): Promise<Record<string, Record<string, OpenCadenceTask[]>>> {
  const res = cads.map(c => ({ c, re: cadenceRe(c.match) })).filter(x => !!x.re) as { c: CadenceDef; re: RegExp }[]
  const out: Record<string, Record<string, OpenCadenceTask[]>> = {}
  if (!res.length) return out
  const db = supabaseAdmin()
  const got = await pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,finished_at,started_at,type_department,assignees')
    .gte('scheduled_date', shift(today, -200)).lte('scheduled_date', shift(today, 200))
    .not('name', 'ilike', '%departure clean%').not('name', 'ilike', '%strip%')
    .order('id').range(a, b), 20)
  if (got.truncated) throw new Error('the task mirror read stopped early — not deciding on a partial list')
  for (const t of got.rows) {
    if (isTaskGone(t.status) || isTaskDone(t.status, t.finished_at)) continue
    const lid = str(t.reference_property_id)
    if (!lid) continue
    const name = str(t.name)
    // First match wins, as in the due calendar, so one task never counts for two cadences.
    const hit = res.find(x => x.re.test(name))
    if (!hit) continue
    const m = (out[hit.c.key] = out[hit.c.key] || {})
    ;(m[lid] = m[lid] || []).push({
      id: str(t.id), listingId: lid, name, date: str(t.scheduled_date).slice(0, 10), dept: str(t.type_department),
      started: isTaskRunning(t.status, t.started_at), assigned: Array.isArray(t.assignees) && t.assignees.length > 0,
    })
  }
  return out
}

/** The open task a unit already has for a cadence: started first, then the earliest. */
export function pickOpen(list: OpenCadenceTask[] | undefined): OpenCadenceTask | null {
  if (!list || !list.length) return null
  return list.slice().sort((a, b) => (Number(b.started) - Number(a.started)) || a.date.localeCompare(b.date) || (Number(a.id) - Number(b.id)))[0]
}

export type DedupeResult = {
  ok: boolean; error?: string; dryRun: boolean; cadence: string
  units: number; kept: number; cancelled: number; moved: number; failed: number
  lines: string[]
  groups: { unit: string; keep: { id: string; date: string; name: string }; cancel: { id: string; date: string; name: string }[]; moveTo: string | null }[]
}

export async function dedupeCadenceTasks(opts: { cadenceKey?: string; dryRun?: boolean; max?: number } = {}): Promise<DedupeResult> {
  const dryRun = opts.dryRun !== false
  const key = opts.cadenceKey || 'ac_filter'
  const out: DedupeResult = { ok: true, dryRun, cadence: key, units: 0, kept: 0, cancelled: 0, moved: 0, failed: 0, lines: [], groups: [] }
  const cfg = resolveCadences(await getSetting<any>(CADENCE_KEY, null).catch(() => null))
  const c = cfg.cadences.find(x => x.key === key)
  if (!c) return { ...out, ok: false, error: `no cadence "${key}"` }
  if (!dryRun && !breezewayConfigured()) return { ...out, ok: false, error: 'Breezeway is not configured' }
  const today = ymdET(new Date())
  const db = supabaseAdmin()

  // Matched against EVERY cadence (first match wins), so a task that belongs to another cadence is
  // never counted as a duplicate of this one.
  let byUnit: Record<string, OpenCadenceTask[]>
  try { byUnit = (await openCadenceTaskMap(cfg.cadences.filter(x => x.mode !== 'off' || x.key === key), today))[key] || {} } catch (e: any) { return { ...out, ok: false, error: String(e?.message || e) } }
  const dupes = Object.keys(byUnit).filter(lid => byUnit[lid].length > 1)
  out.units = dupes.length
  if (!dupes.length) { out.lines.push('no unit has more than one open task for this cadence'); return out }

  const [{ data: names }, { data: ledger }, { data: res }] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title').in('id', dupes),
    db.from('pm_schedule').select('listing_id,task_id').eq('cadence_key', key).in('listing_id', dupes),
    c.ridesDeparture
      ? db.from('guesty_reservations').select('listing_id,check_out,status').in('listing_id', dupes).gte('check_out', today).lte('check_out', shift(today, 14)).in('status', ['confirmed', 'reserved', 'checked_in']).order('check_out').limit(1000)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const unitOf: Record<string, string> = {}
  for (const l of (names || []) as any[]) unitOf[str(l.id)] = str(l.nickname || l.title) || str(l.id)
  const ledgerTask: Record<string, string> = {}
  for (const r of (ledger || []) as any[]) if (r.task_id) ledgerTask[str(r.listing_id)] = str(r.task_id)
  const nextOut: Record<string, string> = {}
  for (const r of (res || []) as any[]) { const lid = str(r.listing_id), co = str(r.check_out).slice(0, 10); if (!nextOut[lid] || co < nextOut[lid]) nextOut[lid] = co }

  const max = Math.max(1, Math.min(opts.max ?? 400, 1000))
  let cancelBudget = max
  for (const lid of dupes) {
    const list = byUnit[lid].slice()
    // Keep: started → assigned → the ledger's own task → the oldest (lowest id).
    list.sort((a, b) =>
      (Number(b.started) - Number(a.started)) ||
      (Number(b.assigned) - Number(a.assigned)) ||
      (Number(b.id === ledgerTask[lid]) - Number(a.id === ledgerTask[lid])) ||
      (Number(a.id) - Number(b.id)))
    const keep = list[0]
    const extra = list.slice(1)
    const moveTo = keep.date < today && !keep.started ? (nextOut[lid] || today) : null
    const unit = unitOf[lid] || lid
    out.groups.push({ unit, keep: { id: keep.id, date: keep.date, name: keep.name }, cancel: extra.map(t => ({ id: t.id, date: t.date, name: t.name })), moveTo })
    out.kept++
    if (dryRun) {
      out.cancelled += extra.length; if (moveTo) out.moved++
      out.lines.push(`${unit}: keep #${keep.id} (${keep.date})${moveTo ? ` → move to ${moveTo}` : ''}, cancel ${extra.map(t => '#' + t.id).join(', ')}`)
      continue
    }
    for (const t of extra) {
      if (cancelBudget <= 0) break
      cancelBudget--
      const r = await cancelBreezewayTask(t.id).catch((e: any) => ({ ok: false, text: String(e?.message || e) } as any))
      if (r.ok) {
        out.cancelled++
        try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled', synced_at: new Date().toISOString() }).eq('id', t.id) } catch { /* the sync catches up */ }
      } else { out.failed++; out.lines.push(`${unit}: could not cancel #${t.id} — ${str(r.text).slice(0, 80)}`) }
    }
    if (moveTo) {
      const u = await updateBreezewayTask(keep.id, { name: keep.name, scheduled_date: moveTo }).catch(() => ({ ok: false } as any))
      if (u.ok) {
        out.moved++
        try { await db.from('breezeway_tasks_sync').update({ scheduled_date: moveTo, synced_at: new Date().toISOString() }).eq('id', keep.id) } catch { /* fine */ }
      } else { out.failed++; out.lines.push(`${unit}: could not move #${keep.id} to ${moveTo}`) }
    }
    // The ledger points at the one that stays, so the recurrence pass manages it from here.
    try {
      await db.from('pm_schedule').update({ status: 'created', task_id: keep.id, task_date: moveTo || keep.date, note: `deduped ${today}`, updated_at: new Date().toISOString() })
        .eq('listing_id', lid).eq('cadence_key', key)
    } catch { /* the next pass reconciles */ }
    out.lines.push(`${unit}: kept #${keep.id}${moveTo ? ` (moved to ${moveTo})` : ''}, cancelled ${extra.length}`)
    if (cancelBudget <= 0) { out.lines.push(`stopped at the cap of ${max} — run again for the rest`); break }
  }
  return out
}
