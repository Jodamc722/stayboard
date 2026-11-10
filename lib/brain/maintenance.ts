// fact_maintenance_event — everything that broke or was fixed, in one shape (migration 178).
//
// THREE SOURCES, ONE ROW PER EVENT:
//   glitch      a guest issue on the glitch board. The Breezeway task pushed from it is the SAME
//               event: its minutes, finisher and billed lines fold into the glitch row and the task
//               gets no row of its own.
//   bz_task     a Breezeway MAINTENANCE-department task that is not tied to a glitch and is not
//               routine upkeep (see ROUTINE below).
//   work_order  a field request of type 'issue'.
//
// ONE SYSTEM CLASSIFIER (lib/task-categories systemOf): hvac · plumbing · appliance · lock_access ·
// electrical · pest · wifi_tv · furniture · cleaning · other. A system a person picked when closing
// the glitch wins (system_source 'picked'); otherwise the glitch category, otherwise the words.
//
// ROUTINE UPKEEP IS NOT A FAILURE. An A/C filter change every 60 days is the cadence working, and
// counting it would mark every well-kept unit as a repeat A/C problem. Preventative work, filter and
// battery changes, deep cleans, inspections, unit checks and walk-throughs are left out.
//
// REPEATS. Per physical unit + system, ordered by when the event opened:
//   repeat_n_90d   = how many earlier events of the same system on the same apartment opened in the
//                    90 days before this one
//   is_repeat      = repeat_n_90d ≥ 1, and the system is not 'other' (two unrelated "other" issues
//                    are not a pattern)
//   prior_event_id = the most recent of those
// The read reaches 90 days further back than the rows it writes, so the oldest rows written still
// see their full look-back.
//
// MONEY. billed_owner is the Breezeway cost + supply lines (or the work order's amount): what was
// BILLED. labor_cost / parts_cost / vendor_cost — what it cost US — are not captured anywhere yet
// and are written null, on purpose.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isTaskDone, isTaskGone, systemOfWith, isSystemKey, RESOLUTION_KEYS } from '@/lib/task-categories'
import type { DimUnit } from './spine'
import { billedOf } from './unit-day'
import { str, num, numOrNull, aliasKey, todayET, addDays, round2, readIn, upsertBatches, type BuildResult } from './shared'

const ROUTINE = /preventat|preventive|filter (change|clean|replac)|deep clean|coil clean|batter(y|ies) (change|replac|swap)|inspection|unit check|walk-?through|quality (check|audit)|\baudit\b|exterior clean|parking (check|sweep)|lost (&|and) found|supply (run|drop)|restock/i
const GUEST_RE = /guest[\s-]*reported|glitch|guest complaint|guest issue/i
const GLITCH_CLOSED = ['closed', 'done', 'resolved']

type Ev = Record<string, any> & { event_id: string; physical_unit_id: string | null; system: string; opened_at: string | null }

const iso = (v: any): string | null => {
  const s = str(v)
  if (!s) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T16:00:00Z' : s)   // a bare date = midday Eastern
  return isNaN(d.getTime()) ? null : d.toISOString()
}
const hoursBetween = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null
  const h = (Date.parse(b) - Date.parse(a)) / 3600_000
  return Number.isFinite(h) && h >= 0 ? Math.round(h * 10) / 10 : null
}

/**
 * Rebuild the events opened in the last `days` days. Reads `days + 90` so repeat counts are whole.
 */
export async function buildMaintenanceEvents(days: number, units: DimUnit[], byId: Record<string, DimUnit>, deadline: number): Promise<BuildResult> {
  if (!units.length) return { rows: 0, partial: true, error: 'dim_unit is empty' }
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const today = todayET()
  const writeFrom = addDays(today, -Math.max(1, days))
  const readFrom = addDays(writeFrom, -90)
  const readFromIso = readFrom + 'T00:00:00Z'
  const span = days + 90
  let partial = false
  const notes: string[] = []

  // A glitch filed with a typed unit and no listing: an exact nickname match earns the link.
  const byNick: Record<string, string> = {}
  for (const u of units) { const k = aliasKey(u.nickname); if (k && (u.status !== 'inactive' || !byNick[k])) byNick[k] = u.listing_id }
  const place = (listingId: any, typedUnit?: any): { listing_id: string | null; u: DimUnit | null } => {
    let lid = str(listingId)
    if (!lid || !byId[lid]) { const hit = byNick[aliasKey(typedUnit)]; if (hit) lid = hit }
    return { listing_id: lid || null, u: lid && byId[lid] ? byId[lid] : null }
  }

  // ── 1. GLITCHES ────────────────────────────────────────────────────────────────────────────────
  const G_BASE = 'id,status,category,listing_id,unit,market,reservation_id,overview,incident_date,created_at,closed_at,closed_at_estimated,refund_approved,vendor_key,breezeway_task_id'
  const readGlitches = (cols: string) => pageRows<any>((a, b) => db.from('glitches').select(cols)
    .gte('created_at', readFromIso).order('created_at').order('id').range(a, b), Math.ceil((span * 20) / 1000) + 2)
  let gRead = await readGlitches(G_BASE + ',system,root_cause,resolution,part')
  let closeCols = true
  if (gRead.truncated && !gRead.rows.length) {
    // The close-detail columns arrive with migration 178 too; a database without them still builds.
    closeCols = false
    gRead = await readGlitches(G_BASE)
    if (!gRead.truncated || gRead.rows.length) notes.push('glitches.system / resolution not present yet')
  }
  if (gRead.truncated) partial = true
  const glitchTaskIds: Record<string, string> = {}          // breezeway task id -> glitch id
  for (const g of gRead.rows) { const t = str(g.breezeway_task_id); if (t) glitchTaskIds[t] = str(g.id) }

  // ── 2. BREEZEWAY MAINTENANCE TASKS ─────────────────────────────────────────────────────────────
  const T_COLS = 'id,reference_property_id,name,status,type_department,scheduled_date,started_at,finished_at,total_minutes,finished_by_name,assignee_name,linked_reservation_id,created:raw->>created_at'
  const tRead = await pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select(T_COLS)
    .ilike('type_department', '%maint%').gte('scheduled_date', readFrom)
    .order('scheduled_date').order('id').range(a, b), Math.ceil((span * 60) / 1000) + 3)
  if (tRead.truncated) partial = true
  const taskById: Record<string, any> = {}
  for (const t of tRead.rows) taskById[str(t.id)] = t
  // The tasks pushed from glitches may be scheduled outside the read above; fetch any still missing.
  const missingTaskIds = Object.keys(glitchTaskIds).filter(id => !taskById[id])
  if (missingTaskIds.length) {
    const extra = await readIn<any>('breezeway_tasks_sync', T_COLS, 'id', missingTaskIds)
    if (extra.truncated) partial = true
    for (const t of extra.rows) taskById[str(t.id)] = t
  }

  // ── 3. WORK ORDERS ─────────────────────────────────────────────────────────────────────────────
  const wRead = await pageRows<any>((a, b) => db.from('field_requests')
    .select('id,type,title,description,listing_id,unit,reservation_id,status,amount_usd,created_at,updated_at')
    .gte('created_at', readFromIso).order('created_at').order('id').range(a, b), 6)
  if (wRead.truncated) partial = true

  // Billed lines for every task that will appear (standalone or folded into a glitch).
  const billed: Record<string, number> = {}
  {
    const bd = await readIn<any>('breezeway_billing_details', 'task_id,costs,supplies', 'task_id', Object.keys(taskById))
    if (bd.truncated) partial = true
    for (const d of bd.rows) billed[str(d.task_id)] = billedOf(d.costs, d.supplies)
  }

  const events: Ev[] = []
  for (const g of gRead.rows) {
    const id = str(g.id); if (!id) continue
    const { listing_id, u } = place(g.listing_id, g.unit)
    const picked = closeCols && isSystemKey(g.system) ? str(g.system) : ''
    const guess = systemOfWith(g.overview, g.category)
    const opened = iso(g.created_at)
    const isClosed = GLITCH_CLOSED.indexOf(str(g.status).toLowerCase()) >= 0
    const closed = isClosed ? iso(g.closed_at) : null
    const t = taskById[str(g.breezeway_task_id)]
    const mins = t ? Number(t.total_minutes) : NaN
    const resolution = closeCols && RESOLUTION_KEYS.indexOf(str(g.resolution)) >= 0 ? str(g.resolution) : null
    events.push({
      event_id: 'glitch:' + id, source: 'glitch', source_id: id,
      listing_id, physical_unit_id: u ? u.physical_unit_id : null, building_id: u ? u.building_id : null,
      market: u ? u.market : (str(g.market) || null),
      system: picked || guess.system, system_source: picked ? 'picked' : (guess.source === 'none' ? null : guess.source),
      title: str(g.overview).replace(/\s+/g, ' ').trim().slice(0, 200) || str(g.category) || null,
      root_cause: closeCols ? (str(g.root_cause).slice(0, 300) || null) : null,
      resolution, part: closeCols ? (str(g.part).slice(0, 160) || null) : null,
      opened_at: opened, closed_at: closed,
      // A close time backfilled from updated_at (migration 085) is not a measurement.
      hours_to_close: g.closed_at_estimated === true ? null : hoursBetween(opened, closed),
      is_open: !isClosed, guest_impacting: true,
      reservation_id: str(g.reservation_id) || null,
      person_name: t ? (str(t.finished_by_name) || str(t.assignee_name) || null) : null,
      vendor_key: str(g.vendor_key) || null,
      bz_task_id: str(g.breezeway_task_id) || null,
      labor_minutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : null,
      billed_owner: t && billed[str(t.id)] != null ? billed[str(t.id)] : null,
      labor_cost: null, parts_cost: null, vendor_cost: null,
      refund: numOrNull(g.refund_approved) == null ? null : round2(num(g.refund_approved)),
    })
  }
  let routine = 0
  for (const t of tRead.rows) {
    const id = str(t.id)
    if (!id || glitchTaskIds[id] || isTaskGone(t.status)) continue
    const name = str(t.name)
    if (ROUTINE.test(name)) { routine++; continue }
    const { listing_id, u } = place(t.reference_property_id)
    const guess = systemOfWith(name)
    const done = isTaskDone(t.status, t.finished_at)
    const opened = iso(t.created) || iso(t.scheduled_date)
    const closed = done ? iso(t.finished_at) : null
    const mins = Number(t.total_minutes)
    events.push({
      event_id: 'bz:' + id, source: 'bz_task', source_id: id,
      listing_id, physical_unit_id: u ? u.physical_unit_id : null, building_id: u ? u.building_id : null, market: u ? u.market : null,
      system: guess.system, system_source: guess.source === 'none' ? null : guess.source,
      title: name.replace(/\s+/g, ' ').trim().slice(0, 200) || null,
      root_cause: null, resolution: null, part: null,
      opened_at: opened, closed_at: closed, hours_to_close: hoursBetween(opened, closed),
      is_open: !done, guest_impacting: GUEST_RE.test(name),
      reservation_id: str(t.linked_reservation_id) || null,
      person_name: str(t.finished_by_name) || str(t.assignee_name) || null,
      vendor_key: null, bz_task_id: id,
      labor_minutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : null,
      billed_owner: billed[id] != null ? billed[id] : null,
      labor_cost: null, parts_cost: null, vendor_cost: null, refund: null,
    })
  }
  for (const w of wRead.rows) {
    const id = str(w.id)
    if (!id || str(w.type).toLowerCase() !== 'issue' || /cancel/i.test(str(w.status))) continue
    const { listing_id, u } = place(w.listing_id, w.unit)
    const guess = systemOfWith(str(w.title) + ' ' + str(w.description))
    const done = str(w.status).toLowerCase() === 'done'
    const opened = iso(w.created_at)
    events.push({
      event_id: 'wo:' + id, source: 'work_order', source_id: id,
      listing_id, physical_unit_id: u ? u.physical_unit_id : null, building_id: u ? u.building_id : null, market: u ? u.market : null,
      system: guess.system, system_source: guess.source === 'none' ? null : guess.source,
      title: str(w.title).replace(/\s+/g, ' ').trim().slice(0, 200) || null,
      root_cause: null, resolution: null, part: null,
      // A work order has no close stamp; its last edit stands in, so no time-to-close is claimed.
      opened_at: opened, closed_at: done ? iso(w.updated_at) : null, hours_to_close: null,
      is_open: !done, guest_impacting: !!str(w.reservation_id),
      reservation_id: str(w.reservation_id) || null,
      person_name: null, vendor_key: null, bz_task_id: null, labor_minutes: null,
      billed_owner: numOrNull(w.amount_usd) == null ? null : round2(num(w.amount_usd)),
      labor_cost: null, parts_cost: null, vendor_cost: null, refund: null,
    })
  }

  // ── REPEATS ────────────────────────────────────────────────────────────────────────────────────
  const groups: Record<string, Ev[]> = {}
  for (const e of events) {
    e.repeat_n_90d = 0; e.is_repeat = false; e.prior_event_id = null
    if (!e.physical_unit_id || !e.opened_at) continue
    const k = e.physical_unit_id + '|' + e.system
    ;(groups[k] = groups[k] || []).push(e)
  }
  const WINDOW_MS = 90 * 86400_000
  for (const k of Object.keys(groups)) {
    const list = groups[k].sort((a, b) => (a.opened_at as string) < (b.opened_at as string) ? -1 : (a.opened_at as string) > (b.opened_at as string) ? 1 : (a.event_id < b.event_id ? -1 : 1))
    for (let i = 0; i < list.length; i++) {
      const at = Date.parse(list[i].opened_at as string)
      let n = 0
      for (let j = i - 1; j >= 0; j--) {
        if (at - Date.parse(list[j].opened_at as string) > WINDOW_MS) break
        n++
      }
      list[i].repeat_n_90d = n
      list[i].is_repeat = n >= 1 && list[i].system !== 'other'
      list[i].prior_event_id = n >= 1 ? list[i - 1].event_id : null
    }
  }

  // Only the rows inside the write window are written; the 90 days before it were read for context.
  const writeFromIso = writeFrom + 'T00:00:00Z'
  const rows = events.filter(e => !e.opened_at || e.opened_at >= writeFromIso).map(e => ({ ...e, built_at: now, partial }))
  const w = await upsertBatches('fact_maintenance_event', rows, 'event_id', { deadline, batch: 500 })
  notes.push(routine + ' routine upkeep task(s) left out')
  return { rows: w.written, partial: partial || w.stoppedEarly, ...(w.error ? { error: w.error } : {}), note: notes.join('; ') }
}
