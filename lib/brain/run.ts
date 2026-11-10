// THE NIGHTLY BUILD — one pass over the brain, inside one function's time limit (migration 178).
//
// ORDER, AND WHY:
//   1. the spine (buildings, units; people when there is time) — everything joins to it; vendor
//      spellings (lib/brain/vendors) are rebuilt just before the events, which use them
//   2. fact_unit_day for every calendar month that touches the last 45 days — late folio edits,
//      refunds and finished tasks land on days already built, so the recent window is rebuilt whole
//      every night. CHUNKS ARE CALENDAR MONTHS (2026-11-10): Revenue Center's Expedia cleaning split
//      is worked out per window, so a month built as one window agrees with that month on the page
//   3. fact_maintenance_event — the last 150 days nightly; 400 on the first build and on Sundays
//   4. unit_health_daily for today
//   5. owner_month / vendor_month — this month and the two before it
//   6. THE BACKFILL, with whatever time is left: fact_unit_day walks backwards a month at a time
//      until it reaches the month 400 days ago. When DEFS_VERSION changes (a definition moved), the
//      cursor starts over once so history is rebuilt under the new rule. The cursor lives in app_settings (business_brain_state) and
//      only moves when a chunk was written whole, so a run that is cut off resumes where it stopped.
//      When it finishes, the roll-ups are rebuilt once over 13 months.
//
// FAILS OPEN. No tables → { ok: true, skipped }. One builder throwing does not stop the others; its
// error is on its own row of the result and the run reports ok: false.
import 'server-only'
import { getSettingFresh, setSetting } from '@/lib/app-settings'
import { buildSpine, buildPeople, loadUnits, type DimUnit } from './spine'
import { buildVendorXref } from './vendors'
import { buildUnitDays } from './unit-day'
import { buildMaintenanceEvents } from './maintenance'
import { buildUnitHealth } from './health'
import { buildOwnerMonths, buildVendorMonths, recentMonths } from './rollups'
import { brainTables, BRAIN_STATE_KEY, EMPTY_STATE, BRAIN_MIGRATION, DEFS_VERSION, todayET, addDays, monthStartOf, monthEndOf, str, type BrainState, type BuildResult } from './shared'

export const NIGHTLY_DAYS = 45
export const BACKFILL_DAYS = 400
export const CHUNK_DAYS = 30
export const SKIPPED_NO_TABLES = 'tables missing — run migration 178'

export type BrainRun = {
  ok: boolean
  skipped?: string
  missing?: string[]
  migration?: string
  count: number
  tables: Record<string, BuildResult>
  backfill: { backfilledTo: string | null; done: boolean; target: string; chunks: number }
  ms: number
  error?: string
}

export async function getBrainState(): Promise<BrainState> {
  const s = await getSettingFresh<any>(BRAIN_STATE_KEY, null).catch(() => null)
  if (!s || typeof s !== 'object') return { ...EMPTY_STATE }
  return {
    backfilledTo: /^\d{4}-\d{2}-\d{2}$/.test(str(s.backfilledTo)) ? str(s.backfilledTo) : null,
    backfillDone: s.backfillDone === true,
    rollupsBackfilled: s.rollupsBackfilled === true,
    defsVersion: typeof s.defsVersion === 'number' ? s.defsVersion : 1,
    lastRunAt: s.lastRunAt ? str(s.lastRunAt) : null,
    lastOk: typeof s.lastOk === 'boolean' ? s.lastOk : null,
    tables: s.tables && typeof s.tables === 'object' ? s.tables : {},
  }
}

const OUT_OF_TIME: BuildResult = { rows: 0, partial: true, note: 'not run — out of time this pass' }

export async function runBrain(opts: { deadline: number; by?: string | null }): Promise<BrainRun> {
  const t0 = Date.now()
  const deadline = opts.deadline
  const left = () => deadline - Date.now()
  const today = todayET()
  const target = monthStartOf(addDays(today, -BACKFILL_DAYS))

  const presence = await brainTables()
  if (presence.missing.length) {
    return {
      ok: true, skipped: SKIPPED_NO_TABLES, missing: presence.missing, migration: BRAIN_MIGRATION, count: 0, tables: {},
      backfill: { backfilledTo: null, done: false, target, chunks: 0 }, ms: Date.now() - t0,
    }
  }

  const state = await getBrainState()
  // A definition changed since history was built: rebuild it once (cursor, roll-ups and the deep
  // event pass all start over). Cheap — the first full build took under a minute.
  const defsChanged = (state.defsVersion || 1) !== DEFS_VERSION
  if (defsChanged) { state.backfilledTo = null; state.backfillDone = false; state.rollupsBackfilled = false }
  const tables: Record<string, BuildResult> = {}
  const safe = async (fn: () => Promise<BuildResult>): Promise<BuildResult> => {
    try { return await fn() } catch (e: any) { return { rows: 0, partial: true, error: str(e?.message || e).slice(0, 200) } }
  }
  const add = (name: string, r: BuildResult) => {
    const prev = tables[name]
    tables[name] = prev
      ? { rows: prev.rows + r.rows, partial: prev.partial || r.partial, ...(prev.error || r.error ? { error: prev.error || r.error } : {}), ...(prev.note || r.note ? { note: prev.note || r.note } : {}) }
      : r
  }

  // 1. The spine.
  try {
    const s = await buildSpine(deadline)
    add('dim_building', s.dim_building); add('dim_unit', s.dim_unit); add('entity_alias', s.entity_alias)
  } catch (e: any) {
    const err: BuildResult = { rows: 0, partial: true, error: str(e?.message || e).slice(0, 200) }
    add('dim_building', err); add('dim_unit', err); add('entity_alias', err)
  }
  const emptyUnits: { units: DimUnit[]; byId: Record<string, DimUnit>; partial: boolean } = { units: [], byId: {}, partial: true }
  const { units, byId, partial: unitsShort } = await loadUnits().catch(() => emptyUnits)

  // 2. The recent window, rebuilt whole — every calendar month that touches the last 45 days.
  const recentFrom = monthStartOf(addDays(today, -NIGHTLY_DAYS))
  if (left() > 45_000) {
    for (let start = monthStartOf(today); start >= recentFrom && left() > 30_000; start = monthStartOf(addDays(start, -1))) {
      const monthEnd = monthEndOf(start)
      const end = monthEnd < today ? monthEnd : today
      add('fact_unit_day', await safe(() => buildUnitDays(start, end, units, deadline)))
    }
  } else add('fact_unit_day', OUT_OF_TIME)

  // 3a. Vendor spellings first, so tonight's events can carry the vendor their assignee names.
  if (left() > 60_000) add('vendor_xref', await safe(() => buildVendorXref(deadline)))
  else add('vendor_xref', OUT_OF_TIME)

  // 3. Events. Deep on the first build, after a definition change, and once a week; the usual
  //    night reaches 150 days.
  const firstEvents = defsChanged || !state.tables || !state.tables.fact_maintenance_event || !(state.tables.fact_maintenance_event.rows > 0)
  const sunday = new Date().getUTCDay() === 0
  if (left() > 40_000) add('fact_maintenance_event', await safe(() => buildMaintenanceEvents(firstEvents || sunday ? BACKFILL_DAYS : 150, units, byId, deadline)))
  else add('fact_maintenance_event', OUT_OF_TIME)

  // 4. Health, for today.
  if (left() > 30_000) add('unit_health_daily', await safe(() => buildUnitHealth(units, byId, deadline)))
  else add('unit_health_daily', OUT_OF_TIME)

  // 5. Roll-ups: this month and the two before it.
  if (left() > 30_000) {
    add('owner_month', await safe(() => buildOwnerMonths(recentMonths(3), byId, deadline)))
    add('vendor_month', await safe(() => buildVendorMonths(recentMonths(3), byId, deadline)))
  } else { add('owner_month', OUT_OF_TIME); add('vendor_month', OUT_OF_TIME) }

  // People and vendors: two outside calls (Breezeway people, the Homebase roster), so they run after
  // the numbers and only with time in hand.
  if (left() > 40_000) {
    try { const p = await buildPeople(Date.now() + Math.min(30_000, left() - 20_000)); add('person_xref', p.person_xref) }
    catch (e: any) { add('person_xref', { rows: 0, partial: true, error: str(e?.message || e).slice(0, 200) }) }
  } else add('person_xref', OUT_OF_TIME)

  // 6. The backfill — backwards from the recent window, a calendar month at a time, while there is
  //    time. A cursor saved mid-month by the old 30-day chunks is snapped to its month's start.
  let cursor = state.backfilledTo && state.backfilledTo < recentFrom ? monthStartOf(state.backfilledTo) : recentFrom
  let done = state.backfillDone === true && cursor <= target
  let chunks = 0
  if (cursor <= target) done = true
  while (!done && units.length && left() > 50_000) {
    const end = addDays(cursor, -1)
    const start = monthStartOf(end)
    const r = await safe(() => buildUnitDays(start, end, units, deadline))
    add('fact_unit_day', r)
    // The cursor moves only when the chunk was written whole. A short READ still moves it (the rows
    // carry partial = true); an unfinished WRITE does not — the next run takes the chunk again.
    if (r.error || r.incomplete) break
    cursor = start
    chunks++
    if (cursor <= target) done = true
  }

  // Once the backfill is whole, the roll-ups are rebuilt once over 13 months.
  let rollupsBackfilled = state.rollupsBackfilled === true
  if (done && !rollupsBackfilled && left() > 60_000) {
    const ro = await safe(() => buildOwnerMonths(recentMonths(13), byId, deadline))
    const rv = await safe(() => buildVendorMonths(recentMonths(13), byId, deadline))
    add('owner_month', ro); add('vendor_month', rv)
    if (!ro.error && !rv.error && !/time limit/.test(str(ro.note))) rollupsBackfilled = true
  }

  if (unitsShort && tables.dim_unit) tables.dim_unit = { ...tables.dim_unit, partial: true }
  let count = 0
  let firstError = ''
  const summary: BrainState['tables'] = {}
  for (const name of Object.keys(tables)) {
    const r = tables[name]
    count += r.rows
    if (r.error && !firstError) firstError = name + ': ' + r.error
    summary[name] = { rows: r.rows, partial: r.partial, ...(r.error ? { error: r.error } : {}), ...(r.note ? { note: r.note.slice(0, 600) } : {}) }
  }
  const ok = !firstError
  // A table that wrote nothing this pass keeps its last good count in the saved state, so "first
  // build" is not re-detected because one night ran out of time.
  const savedTables: BrainState['tables'] = { ...(state.tables || {}) }
  for (const name of Object.keys(summary)) {
    if (summary[name].rows > 0 || !savedTables[name]) savedTables[name] = summary[name]
    else savedTables[name] = { ...savedTables[name], partial: true, ...(summary[name].error ? { error: summary[name].error } : {}) }
  }
  const next: BrainState = {
    backfilledTo: cursor, backfillDone: done, rollupsBackfilled, defsVersion: DEFS_VERSION,
    lastRunAt: new Date().toISOString(), lastOk: ok, tables: savedTables,
  }
  try { await setSetting(BRAIN_STATE_KEY, next, opts.by || 'cron') } catch { /* the next run recomputes from the old cursor */ }

  return {
    ok, count, tables,
    backfill: { backfilledTo: cursor, done, target, chunks },
    ms: Date.now() - t0,
    ...(firstError ? { error: firstError } : {}),
  }
}
