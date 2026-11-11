// REACH — the parts of the business Eve could not see (Eve reorganisation, 2026-11-10).
//
// The audit of 2026-11-10 listed about twenty areas the app tracks and Eve had no tool for. These are
// the first six, chosen because they are what a property-upkeep decision is made of:
//   upkeep_due           the PM ledger — every unit x cadence: last done, next due, how late
//   inspection_results   the Breezeway inspection checklists and what failed on them
//   blocked_units        what cannot be sold right now, and why
//   vendor_work          what an outside vendor has open, has finished, and has invoiced
//   calls                welcome / post-checkout calls logged, and the Talkroute call log, as counts
//   ai_spend             what the AI itself cost, by task and by day
//
// EVERY ONE IS THIN AND READ-ONLY. Each reads through the same lib function the page reads through
// (lib/pm-calendar, lib/blocked-units, lib/project-vendors) or one table with its filters IN the
// query, returns `total_rows` / `truncated` when a list is capped, carries a `_meta` evidence block
// (lib/eve/ctx.ts toolMeta), and degrades to a plain "not available" when a table is missing.
//
// ROOMS. A vendor's room sees its own buildings only (scopeIds) and never people's names, another
// vendor's work, call logs or AI spend.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { buildDueCalendar, type DueCalendar, type DueItem } from '@/lib/pm-calendar'
import { blockedUnits, type BlockedReport } from '@/lib/blocked-units'
import { getVendors } from '@/lib/staffing'
import { vendorSummary } from '@/lib/project-vendors'
import { spendNow } from '@/lib/ai-budget'
import { CADENCE_KEY, resolveCadences } from '@/lib/cadences'
import { getSetting } from '@/lib/app-settings'
import type { EveTool } from './types'
import { obj, S } from './types'
import type { EveCtx } from './ctx'
import { clampDays, clampLimit, shiftDay, lc, has, num, round2, pageRows, resolveListing, scopeIds, toolMeta } from './ctx'

const likeSafe = (v: any): string => String(v || '').replace(/[%_,()*"\\]/g, ' ').replace(/\s+/g, ' ').trim()
const guarded = (ctx: EveCtx): boolean => ctx.tier === 'vendor' || !!ctx.guestSafe
const etDay = (iso: any): string => {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t)) : ''
}

// ───────────────────────────────────────────────────────────── shared, cached readers
// The upkeep ledger takes a few seconds to assemble (lib/pm-calendar reads the task mirror once), and
// a 360 and an upkeep question in the same conversation should not pay for it twice. Five minutes,
// per server instance; a failed build is never kept.
let _due: { at: number; today: string; cal: DueCalendar } | null = null
export async function dueCalendarCached(today: string): Promise<DueCalendar> {
  if (_due && _due.today === today && Date.now() - _due.at < 5 * 60_000) return _due.cal
  const cal = await buildDueCalendar(today, { horizonDays: 400, market: 'all' })
  _due = { at: Date.now(), today, cal }
  return cal
}

// Blocked units read Guesty's live multi-calendar for every listing, so it is cached for ten minutes
// the way the Blocked page caches it (app/api/blocked-units). Outside a request (a script, a test)
// Next's cache is not there; the report is then simply built directly.
const _blockedCached = unstable_cache((days: number) => blockedUnits(days), ['eve-blocked-units-v1'], { revalidate: 600 })
export async function blockedReportCached(days: number): Promise<BlockedReport> {
  try { return await _blockedCached(days) } catch { return blockedUnits(days) }
}

/** One line for an upkeep item, the shape upkeep_due and unit_360 both return. */
export function dueLine(it: DueItem): any {
  return {
    unit: it.unit, building: it.building, cadence: it.label, cadence_key: it.cadenceKey, dept: it.dept,
    last_done: it.lastDone,
    last_done_from: it.recorded ? 'a date a person recorded' : it.lastDone ? 'a finished task' : it.newUnit ? `new unit — clock started at go-live ${it.newUnit.goLive}` : it.clock ? `no record — clock started ${it.clock.started}` : 'no record',
    next_due: it.dueOn,
    days_late: it.daysOver > 0 ? it.daysOver : 0,
    days_until_due: it.daysOver < 0 ? -it.daysOver : 0,
    state: it.band === 'late' ? 'LATE' : it.band === 'week' ? 'due this week' : it.band === 'unknown' ? 'no record' : 'not due yet',
    already_scheduled: it.scheduled ? it.scheduled.date : null,
  }
}

// ───────────────────────────────────────────────────────────── ops drawer
const UPKEEP_DUE: EveTool = {
  name: 'upkeep_due',
  description: 'THE UPKEEP LEDGER — what recurring upkeep is due or LATE, per unit and per cadence (A/C filter changes, deep cleans, coil and mini-split cleans, battery changes, PM, inspections, FF&E audits — whatever cadences are switched on in Settings). For each: last done, next due, days late, and whether a task is already scheduled. Filters: building, unit (name) or id, cadence (a word from its name, e.g. "filter", "deep clean"), state ("late" | "week" | "later" | "no_record"; default = late + this week + no record). Returns totals for everything that matched, each cadence\'s interval as configured (measured_against, e.g. "every 35 days" — always say it), and EVERY matching item as one compact line grouped by cadence, worst first. Use it for "what is overdue", "which units need filters", "is 1205 up to date" — never infer upkeep from task names when this exists.',
  input_schema: obj({ building: S.str, unit: S.str, id: S.str, cadence: S.str, state: S.str, limit: S.num }),
  run: async (input, ctx) => {
    // No small cap: every overdue / due / no-record item is listed as one compact line (500 is a guard, not a page).
    const lim = clampLimit(input?.limit, 500, 500)
    const scope = scopeIds(ctx)
    if (scope && !scope.length) return { count: 0, total_rows: 0, truncated: false, items_by_cadence: [], note: 'This room is scoped to buildings that match no units, so there is no upkeep to show from here.' }
    const unit = input?.unit || input?.id ? resolveListing(ctx, { id: input?.id, name: input?.unit, building: input?.building }) : null
    if ((input?.unit || input?.id) && !unit) return { error: `No unit matches "${input?.unit || input?.id}".`, note: 'That is not the same as "nothing due" — check the unit name, or use resolve.' }
    let cal: DueCalendar
    try { cal = await dueCalendarCached(ctx.today) } catch (e: any) { return { error: 'The upkeep ledger could not be built right now: ' + String(e?.message || e).slice(0, 160) } }
    let items: DueItem[] = []
    for (const b of cal.buildings) for (const it of b.items) items.push(it)
    if (scope) { const ok: Record<string, true> = {}; for (const id of scope) ok[id] = true; items = items.filter(it => ok[it.listingId]) }
    if (unit) items = items.filter(it => it.listingId === unit.id)
    else if (input?.building) {
      const ids: Record<string, true> = {}
      for (const id of ctx.idsForBuilding(String(input.building))) ids[id] = true
      items = items.filter(it => ids[it.listingId] || has(it.building, input.building))
      if (!items.length && !Object.keys(ids).length) return { error: `No building matches "${input.building}".`, note: 'That is not the same as "nothing due" — check the building name, or use resolve.' }
    }
    const cq = lc(input?.cadence).trim()
    if (cq) items = items.filter(it => lc(it.label).includes(cq) || lc(it.cadenceKey).includes(cq))
    const everything = items
    const st = lc(input?.state).trim().replace(/[\s-]+/g, '_')
    const wantBand = st === 'late' ? ['late'] : st === 'week' ? ['week'] : st === 'later' ? ['later'] : st === 'no_record' || st === 'unknown' ? ['unknown'] : st === 'all' ? ['late', 'week', 'later', 'unknown'] : (unit ? ['late', 'week', 'later', 'unknown'] : ['late', 'week', 'unknown'])
    const listed = everything.filter(it => wantBand.indexOf(it.band) >= 0)
      .sort((a, b) => (b.daysOver - a.daysOver) || String(a.unit).localeCompare(String(b.unit)))
    const tally = (rows: DueItem[]) => ({
      late: rows.filter(r => r.band === 'late').length, due_this_week: rows.filter(r => r.band === 'week').length,
      not_due_yet: rows.filter(r => r.band === 'later').length, no_record: rows.filter(r => r.band === 'unknown').length,
      already_scheduled: rows.filter(r => !!r.scheduled).length,
    })
    const byCadence: Record<string, DueItem[]> = {}
    for (const it of everything) (byCadence[it.label] = byCadence[it.label] || []).push(it)
    const byBuilding: Record<string, DueItem[]> = {}
    for (const it of everything) (byBuilding[String(it.building || 'Other')] = byBuilding[String(it.building || 'Other')] || []).push(it)
    const cut = listed.length > lim
    const degraded = cal.degraded && cal.degraded.length > 0
    // THE CADENCE IT IS MEASURED AGAINST (eval 2026-11-11: she listed overdue filters without ever
    // saying "every 35 days"). Read from the same settings the ledger was built from (lib/cadences),
    // never written here.
    const every: Record<string, number> = {}
    try {
      const cfg = resolveCadences(await getSetting<any>(CADENCE_KEY, null).catch(() => null))
      for (const c of cfg.cadences) if (Number(c.everyDays) > 0) every[c.key] = Number(c.everyDays)
    } catch { /* the cadence column then says it could not be read */ }
    const everyOf = (it: DueItem): number | null => every[it.cadenceKey] ?? null
    // EVERY LISTED ITEM, ONE COMPACT LINE (eval 2026-11-11: a 40-row list of objects, then halved to fit,
    // missed units). Grouped by cadence so the cadence and its interval are said once, worst first.
    const compact = (it: DueItem): string => [
      `${it.unit}${it.building ? ` (${it.building})` : ''}`,
      it.band === 'late' ? `${it.daysOver}d LATE` : it.band === 'week' ? 'due this week' : it.band === 'unknown' ? 'NO RECORD' : 'not due yet',
      `last ${it.lastDone || 'none on record'}${it.recorded ? ' (recorded by a person)' : it.newUnit ? ` (new unit, go-live ${it.newUnit.goLive})` : it.clock ? ` (clock started ${it.clock.started})` : ''}`,
      `due ${it.dueOn}`,
      it.scheduled ? `already scheduled ${it.scheduled.date}` : '',
    ].filter(Boolean).join(' · ')
    const shown = listed.slice(0, lim)
    const groups: Record<string, DueItem[]> = {}
    for (const it of shown) (groups[it.label] = groups[it.label] || []).push(it)
    return {
      scope: unit ? `unit: ${unit.meta.name}` : input?.building ? `building: ${input.building}` : scope ? 'this room\'s buildings' : 'whole portfolio',
      as_of_day: cal.today,
      upkeep_tracking_on: cal.enabled,
      totals: tally(everything),
      by_cadence: Object.keys(byCadence).map(k => ({ cadence: k, every_days: everyOf(byCadence[k][0]), ...tally(byCadence[k]), worst_days_late: Math.max(0, ...byCadence[k].map(r => r.daysOver)) })).sort((a, b) => b.late - a.late),
      by_building: unit ? undefined : Object.keys(byBuilding).map(k => ({ building: k, ...tally(byBuilding[k]) })).sort((a, b) => b.late - a.late).slice(0, 25),
      count: shown.length, total_rows: listed.length, truncated: cut || degraded,
      line_format: 'unit (building) · days LATE / due this week / NO RECORD · last done (and where that date came from) · next due · already scheduled',
      items_by_cadence: Object.keys(groups).map(k => ({
        cadence: k,
        measured_against: everyOf(groups[k][0]) ? `every ${everyOf(groups[k][0])} days` : 'interval could not be read — say so',
        units: groups[k].length,
        lines: groups[k].map(compact),
      })),
      cadences_not_running: cal.inert.length ? cal.inert.map(c => `${c.label} (${c.why})`) : undefined,
      note: [
        'Name the cadence each list is measured against (measured_against, e.g. "every 35 days") and list EVERY unit in the lines — do not sample.',
        cut ? `Listing the ${lim} most overdue of ${listed.length}; the totals above count everything that matched.` : '',
        degraded ? `Some reads stopped early (${cal.degraded.join('; ').slice(0, 200)}) — the counts are floors, not exact. Say so.` : '',
        '"no record" means we have never seen it done and its clock has not started — it is unknown, not late.',
      ].filter(Boolean).join(' '),
      _meta: toolMeta({ source: 'the upkeep ledger (lib/pm-calendar: cadence settings + finished Breezeway tasks + recorded dates)', window: `due through ${shiftDay(cal.today, cal.horizonDays)} plus everything overdue`, n: everything.length, truncated: cut || degraded }),
    }
  },
}

export const INSPECTION_RESULTS: EveTool = {
  name: 'inspection_results',
  description: 'THE BREEZEWAY INSPECTION CHECKLISTS, LINE BY LINE — the post-clean housekeeping audits (kind "hk_post_clean"), PM inspections ("pm") and arrival inspections ("arrival"): for each finished inspection the unit, date, who inspected, who was being inspected, yes/no counts, pass %, the 1-5 score and exactly WHICH checklist items failed. Also the roll-up: overall pass %, the items that fail most often, and pass % by unit. Filters: building, unit (name) or id, kind, person (the housekeeper / technician inspected, or the inspector), days (default 30). Use it for "what keeps failing at Eden", "how did the last inspection of 1205 go", "which checklist items do we miss most". This is NOT the coordinator\'s manual log (that is `inspections`).',
  input_schema: obj({ building: S.str, unit: S.str, id: S.str, kind: S.str, person: S.str, days: S.num, limit: S.num }),
  run: async (input, ctx) => {
    const lim = clampLimit(input?.limit, 60, 200)
    const days = clampDays(input?.days, 30, 365)
    const since = shiftDay(ctx.today, -days)
    const scope = scopeIds(ctx)
    if (scope && !scope.length) return { count: 0, total_rows: 0, truncated: false, inspections: [], note: 'This room is scoped to buildings that match no units.' }
    const unit = input?.unit || input?.id ? resolveListing(ctx, { id: input?.id, name: input?.unit, building: input?.building }) : null
    if ((input?.unit || input?.id) && !unit) return { error: `No unit matches "${input?.unit || input?.id}".`, note: 'That is not the same as "no inspections" — check the unit name, or use resolve.' }
    let ids: string[] | null = scope ? scope.slice() : null
    if (unit) ids = [unit.id]
    else if (input?.building) {
      const b = ctx.idsForBuilding(String(input.building))
      if (!b.length) return { error: `No building matches "${input.building}".`, note: 'That is not the same as "no inspections" — check the building name, or use resolve.' }
      ids = ids ? b.filter(x => ids!.indexOf(x) >= 0) : b
    }
    const kind = lc(input?.kind).trim().replace(/[\s-]+/g, '_')
    const kindQ = /post|hk|house|clean/.test(kind) ? 'hk_post_clean' : /arriv/.test(kind) ? 'arrival' : /pm|prevent|maint/.test(kind) ? 'pm' : ''
    const person = guarded(ctx) ? '' : likeSafe(input?.person)
    // A long id list does not fit a URL; past 150 the building is filtered after the read and the result says so.
    const idsInQuery = ids && ids.length <= 150 ? ids : null
    let q = ctx.db.from('inspection_results')
      .select('task_id,kind,listing_id,unit,market,scheduled_date,finished_at,inspector,subject_name,yes_count,no_count,pass_rate,score,clean_finished,misses,notes', { count: 'exact' })
      .gte('finished_at', since + 'T00:00:00Z')
    if (idsInQuery) q = q.in('listing_id', idsInQuery)
    if (kindQ) q = q.eq('kind', kindQ)
    if (person) q = q.or(`subject_name.ilike.%${person}%,inspector.ilike.%${person}%`)
    const { data, error, count } = await q.order('finished_at', { ascending: false }).order('task_id').limit(lim)
    if (error) return { error: 'Inspection results are not available (migration 174 may not have run, or the sync has not filled the table yet): ' + String(error.message || '').slice(0, 120), note: 'Say plainly that the Breezeway inspection checklists could not be read — never report a pass. For a unit\'s inspection history, unit_360 / building_360 also carry an inspection section.' }
    let rows: any[] = (data as any[]) || []
    if (ids && !idsInQuery) { const ok: Record<string, true> = {}; for (const id of ids) ok[id] = true; rows = rows.filter(r => ok[String(r.listing_id)]) }
    const totalRows: number | null = ids && !idsInQuery ? null : (typeof count === 'number' ? count : null)
    const cut = totalRows != null ? totalRows > rows.length : ((data as any[]) || []).length >= lim
    let yes = 0, no = 0
    const missCount: Record<string, { item: string; section: string; n: number }> = {}
    const byKind: Record<string, number> = {}
    const byUnit: Record<string, { unit: string; n: number; yes: number; no: number }> = {}
    for (const r of rows) {
      yes += num(r.yes_count); no += num(r.no_count)
      byKind[String(r.kind)] = (byKind[String(r.kind)] || 0) + 1
      const uk = String(r.listing_id || r.unit)
      if (!byUnit[uk]) byUnit[uk] = { unit: r.listing_id && ctx.listingMeta[String(r.listing_id)] ? ctx.listingMeta[String(r.listing_id)].name : String(r.unit || ''), n: 0, yes: 0, no: 0 }
      byUnit[uk].n++; byUnit[uk].yes += num(r.yes_count); byUnit[uk].no += num(r.no_count)
      for (const m of (Array.isArray(r.misses) ? r.misses : [])) {
        const item = String(m?.item_en || m?.item_es || '').trim()
        if (!item) continue
        const k = lc(item)
        if (!missCount[k]) missCount[k] = { item: item.slice(0, 140), section: String(m?.section || ''), n: 0 }
        missCount[k].n++
      }
    }
    const pct = (y: number, n: number): number | null => (y + n > 0 ? Math.round((y / (y + n)) * 1000) / 10 : null)
    const hideNames = guarded(ctx)
    return {
      window: `${since} → ${ctx.today} (finished date)`,
      scope: unit ? `unit: ${unit.meta.name}` : input?.building ? `building: ${input.building}` : scope ? 'this room\'s buildings' : 'whole portfolio',
      count: rows.length, total_rows: totalRows, truncated: cut,
      overall: { inspections: rows.length, checks_passed: yes, checks_failed: no, pass_pct: pct(yes, no) },
      by_kind: byKind,
      top_misses: Object.keys(missCount).map(k => missCount[k]).sort((a, b) => b.n - a.n).slice(0, 12).map(m => ({ item: m.item, section: m.section || undefined, times_failed: m.n })),
      weakest_units: Object.keys(byUnit).map(k => ({ unit: byUnit[k].unit, inspections: byUnit[k].n, pass_pct: pct(byUnit[k].yes, byUnit[k].no), checks_failed: byUnit[k].no })).filter(u => u.checks_failed > 0).sort((a, b) => (a.pass_pct ?? 101) - (b.pass_pct ?? 101)).slice(0, 12),
      inspections: rows.slice(0, 40).map(r => ({
        unit: r.listing_id && ctx.listingMeta[String(r.listing_id)] ? ctx.listingMeta[String(r.listing_id)].name : r.unit,
        kind: r.kind, finished: etDay(r.finished_at) || String(r.finished_at || '').slice(0, 10),
        inspector: hideNames ? undefined : r.inspector, inspected: hideNames ? undefined : (r.subject_name || undefined),
        passed: r.yes_count, failed: r.no_count, pass_pct: r.pass_rate == null ? null : Math.round(Number(r.pass_rate) * 1000) / 10,
        score_1_to_5: r.score, clean_finished_before_inspection: r.clean_finished ?? undefined,
        misses: (Array.isArray(r.misses) ? r.misses : []).slice(0, 8).map((m: any) => String(m?.item_en || m?.item_es || '').slice(0, 120)).filter(Boolean),
        notes: r.notes ? String(r.notes).slice(0, 200) : undefined,
        task: r.task_id,
      })),
      note: [
        cut ? `Only the newest ${rows.length} of ${totalRows ?? 'more'} inspections were read — the roll-up covers ONLY these. Say it is partial; narrow by building, kind or days.` : '',
        'A failed line is a finding about a unit on a day, not a verdict on a person — a clean can be right and the item still broken. Under five inspections, give the count, not a percentage.',
      ].filter(Boolean).join(' '),
      _meta: toolMeta({ source: 'inspection_results (Breezeway inspection checklists)', window: `${since} → ${ctx.today}`, n: rows.length, truncated: cut }),
    }
  },
}

const BLOCKED_UNITS: EveTool = {
  name: 'blocked_units',
  description: 'WHAT CANNOT BE SOLD RIGHT NOW, AND WHY — every unit with nights blocked on the Guesty calendar over the next days (default 30, up to 120): out of service today or upcoming, the block\'s dates and nights, the reason as Guesty labels it, the note someone left, who created it and whether it has an end date. Blocks Guesty made automatically because a linked listing sold are counted apart (they are the system working, not a unit down). Optional building. Returns EVERY block as one compact line (unit · reason on record · since · until or "no end date" · note), grouped by building — list them all. Use it for "which units are blocked", "why is 1205 offline", "how many nights are we losing to blocks". Read from Guesty\'s live calendar, cached ten minutes.',
  input_schema: obj({ building: S.str, days: S.num }),
  run: async (input, ctx) => {
    const days = Math.min(Math.max(Math.round(Number(input?.days) || 30), 1), 120)
    let rep: BlockedReport
    try { rep = await blockedReportCached(days) } catch (e: any) { return { error: 'The blocked-units report could not be built right now (it reads Guesty\'s live calendar): ' + String(e?.message || e).slice(0, 160) } }
    const mine = (lid: string) => !!ctx.listingMeta[String(lid)]
    const bq = lc(input?.building).trim()
    const bIds: Record<string, true> = {}
    if (bq) for (const id of ctx.idsForBuilding(bq)) bIds[id] = true
    const inScope = (r: any) => mine(r.listingId) && (!bq || bIds[String(r.listingId)] || has(r.building, bq))
    const runs = rep.runs.filter(inScope).sort((a, b) => (Number(b.live) - Number(a.live)) || (b.nights - a.nights))
    const linked = rep.linkedRuns.filter(inScope)
    const hide = guarded(ctx)
    // EVERY BLOCK, ONE LINE EACH (eval 2026-11-11: "which units are blocked" got 10 of 67 — a 40-row
    // cap, then the 7,000-character fit halved the list of objects twice). One compact line per block,
    // grouped by building, under a wider budget (registry.ts WIDE_TOOLS), so the whole list arrives.
    const line = (r: any): string => {
      const since = r.blockStart ? String(r.blockStart).slice(0, 10) : r.live ? `before ${r.from} (start not on record)` : r.from
      const until = r.blockEnd ? String(r.blockEnd).slice(0, 10) : r.openEnded ? 'no end date' : r.to
      const note = !hide && r.note ? String(r.note).replace(/\s+/g, ' ').trim().slice(0, 70) : ''
      const who = !hide && r.createdBy ? String(r.createdBy).slice(0, 30) : ''
      return [
        r.unit,
        r.guestyLabel || r.reason || 'no reason on record',
        `since ${since}`,
        `until ${until}`,
        r.live ? 'OUT NOW' : `starts in ${r.startsInDays}d`,
        `${r.nights}n in window`,
        note ? `note: ${note}` : '',
        who ? `by ${who}` : '',
        r.alsoBlocks && r.alsoBlocks.length ? `also takes offline ${r.alsoBlocks.slice(0, 3).join(', ')}` : '',
      ].filter(Boolean).join(' · ')
    }
    const byB: Record<string, any[]> = {}
    for (const r of runs) (byB[String(r.building || 'Other')] = byB[String(r.building || 'Other')] || []).push(r)
    const buildings = Object.keys(byB).sort((a, b) => byB[b].length - byB[a].length || a.localeCompare(b))
    return {
      as_of: new Date().toISOString(),
      window: `${rep.from} → ${rep.to} (next ${rep.days} days)`,
      scope: bq ? `building: ${input.building}` : ctx.scopedBuildings ? 'this room\'s buildings' : 'whole portfolio',
      listings_checked: bq || ctx.scopedBuildings ? undefined : rep.listingsChecked,
      out_of_service_now: runs.filter(r => r.live).length,
      upcoming_blocks: runs.filter(r => !r.live).length,
      nights_blocked: runs.reduce((s, r) => s + (Number(r.nights) || 0), 0),
      no_end_date: runs.filter(r => r.openEnded && !r.blockEnd).length,
      auto_blocked_by_a_linked_listing: linked.length,
      count: runs.length, total_rows: runs.length, truncated: false,
      line_format: 'unit · reason on record (as Guesty labels it) · since · until (or "no end date") · OUT NOW or starts in Nd · nights in window · note · created by',
      blocks_by_building: buildings.map(b => ({ building: b, blocks: byB[b].length, lines: byB[b].map(line) })),
      note: `Every out-of-service block in the window is listed — quote them all, grouped by building. "since" is Guesty's own block start when it has one; "until" is Guesty's own last blocked night, or "no end date" when the block runs past the window with none set. The reason is exactly as recorded — never guess one when it says "no reason on record". Nights are counted from today for ${rep.days} days (cached up to ten minutes); they are nights, not dollars.`,
      _meta: toolMeta({ source: 'Guesty multi-calendar (live, cached 10 min)', window: `${rep.from} → ${rep.to}`, n: runs.length, truncated: false }),
    }
  },
}

const VENDOR_WORK: EveTool = {
  name: 'vendor_work',
  money: true,
  description: 'WHAT AN OUTSIDE VENDOR HAS DONE FOR US — pass the vendor (name or key; use resolve if unsure). Returns the vendor\'s record (trade, buildings, whether they are a regular with a cadence, insurance certificate state), open work with them and recent finished work across project steps, guest issues (glitches assigned to them) and field requests, their last visit and whether a regular is overdue, guest issues sent to them in the window (default 180 days) by category with how long they took to close, and invoices approved or paid in the last 12 months, plus jobs_by_month — a job count for EVERY month of the window (project visits done, guest issues sent and closed, field requests); for "the last three months" pass days 90 and quote each month. With no vendor: the vendor list. If several vendors fit (e.g. more than one A/C company), it asks which one — never pick one silently. It does NOT include cleaning-company invoices read on the Cleaning invoices page or Breezeway tasks assigned to a vendor crew — say so if asked for a vendor\'s total cost.',
  input_schema: obj({ vendor: S.str, days: S.num }),
  run: async (input, ctx) => {
    if (guarded(ctx)) return { error: 'Vendor records are not read out in this room. Ask in a Stay Hospitality team room or in the app.' }
    const days = clampDays(input?.days, 180, 730)
    const vendors = await getVendors(true)
    const text = String(input?.vendor || '').trim()
    if (!text) {
      return {
        count: vendors.length,
        vendors: vendors.slice(0, 80).map(v => ({ key: v.key, name: v.label, covers: v.buildings.slice(0, 8), billing: v.billing || undefined, active: v.active })),
        note: vendors.length ? 'Pass vendor (key or name) for one vendor\'s work.' : 'No vendors are saved yet (Settings → Vendors), or the vendors table is not there.',
        _meta: toolMeta({ source: 'vendors', window: 'now', n: vendors.length }),
      }
    }
    const t = lc(text)
    const exact = vendors.filter(v => lc(v.key) === t || lc(v.label) === t)
    const loose = exact.length ? exact : vendors.filter(v => lc(v.label).includes(t) || lc(v.key).includes(t.replace(/\s+/g, '-')))
    if (!loose.length) return { found: false, note: `No saved vendor matches "${text}". That is not the same as "they have done no work" — check the name against the vendor list (call vendor_work with no vendor).` }
    const liveOnes = loose.filter(v => v.active)
    const pool = liveOnes.length ? liveOnes : loose
    if (pool.length > 1) return { ambiguous: true, question: `Which one? "${text}" fits ${pool.length} vendors.`, candidates: pool.slice(0, 12).map(v => ({ key: v.key, name: v.label, covers: v.buildings.slice(0, 6) })), note: 'Do not pick one yourself — ask, or call again with the key.' }
    const v = pool[0]
    const since = shiftDay(ctx.today, -days)
    const [sum, gl, steps, reqs] = await Promise.all([
      vendorSummary(v.key, ctx.today).catch(() => null),
      pageRows<any>((a, b) => ctx.db.from('glitches').select('id,category,status,unit,listing_id,created_at,closed_at,closed_at_estimated,vendor_visit_on').eq('vendor_key', v.key).gte('created_at', since + 'T00:00:00Z').order('id').range(a, b), 5),
      // For the month-by-month counts (eval 2026-11-11: "what has our A/C vendor done in the last three
      // months" got no per-month figure). A vendor's project steps are few, so they are read whole and
      // dated in code (visit day, else done day); field requests by the day they were raised.
      pageRows<any>((a, b) => ctx.db.from('project_steps').select('id,status,done,visit_on,done_at').eq('vendor_key', v.key).order('id').range(a, b), 5),
      pageRows<any>((a, b) => ctx.db.from('field_requests').select('id,status,created_at').eq('vendor_key', v.key).gte('created_at', since + 'T00:00:00Z').order('id').range(a, b), 5),
    ])
    // ── jobs by month, every month of the window listed (a month with nothing says 0, not nothing)
    const monthKeys: string[] = []
    for (let m = since.slice(0, 7); m <= ctx.today.slice(0, 7);) {
      monthKeys.push(m)
      const [y, mo] = m.split('-').map(Number)
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
    }
    type MonthRow = { month: string; project_visits_done: number; guest_issues_sent: number; guest_issues_closed: number; field_requests_raised: number }
    const months: Record<string, MonthRow> = {}
    for (const m of monthKeys) months[m] = { month: m, project_visits_done: 0, guest_issues_sent: 0, guest_issues_closed: 0, field_requests_raised: 0 }
    const monthOf = (iso: any): string => { const d = etDay(iso) || String(iso || '').slice(0, 10); return d >= since && d <= ctx.today ? d.slice(0, 7) : '' }
    for (const s of steps.rows) {
      if (!(s.done === true || String(s.status) === 'done')) continue
      const k = monthOf(s.visit_on ? String(s.visit_on).slice(0, 10) + 'T12:00:00Z' : s.done_at)
      if (k && months[k]) months[k].project_visits_done++
    }
    for (const g of gl.rows) {
      const k = monthOf(g.created_at); if (k && months[k]) months[k].guest_issues_sent++
      if (/^(closed|done|resolved)$/i.test(String(g.status || '')) && g.closed_at) { const c = monthOf(g.closed_at); if (c && months[c]) months[c].guest_issues_closed++ }
    }
    for (const r of reqs.rows) { const k = monthOf(r.created_at); if (k && months[k]) months[k].field_requests_raised++ }
    const byMonth = monthKeys.map(m => ({ ...months[m], jobs: months[m].project_visits_done + months[m].guest_issues_sent + months[m].field_requests_raised }))
    const byCat: Record<string, { n: number; open: number; hours: number[] }> = {}
    for (const g of gl.rows) {
      const c = String(g.category || 'uncategorised')
      if (!byCat[c]) byCat[c] = { n: 0, open: 0, hours: [] }
      byCat[c].n++
      const closed = /^(closed|done|resolved)$/i.test(String(g.status || ''))
      if (!closed) byCat[c].open++
      else if (g.closed_at && !g.closed_at_estimated) {
        const h = (Date.parse(String(g.closed_at)) - Date.parse(String(g.created_at))) / 3600_000
        if (Number.isFinite(h) && h >= 0) byCat[c].hours.push(h)
      }
    }
    const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
    const rec: any = sum ? sum.vendor : null
    return {
      found: true,
      vendor: { key: v.key, name: v.label, active: v.active, covers: v.buildings, billing: v.billing || undefined, trade: rec?.trade || undefined, regular: rec?.regular ? (rec?.cadence || true) : false, insurance_certificate: sum?.coi ? sum.coi.label : undefined },
      last_visit: sum?.lastVisit || null,
      overdue_by_days: sum?.overdueBy ?? null,
      jobs_by_month: {
        window: `${since} → ${ctx.today}`,
        what_counts: 'jobs = project visits finished in the month + guest issues sent to them in the month + field requests raised for them in the month. guest_issues_closed is shown alongside, not added. Breezeway tasks done by their crew are not in this.',
        months: byMonth,
        truncated: steps.truncated || gl.truncated || reqs.truncated || undefined,
      },
      open_work: (sum?.open || []).slice(0, 20).map(j => ({ kind: j.kind, what: j.title, where: j.where, when: j.when })),
      recent_finished: (sum?.recent || []).slice(0, 20).map(j => ({ kind: j.kind, what: j.title, where: j.where, when: j.when })),
      guest_issues_sent_to_them: {
        window: `${since} → ${ctx.today}`,
        count: gl.rows.length, truncated: gl.truncated,
        by_category: Object.keys(byCat).map(c => ({ category: c, issues: byCat[c].n, still_open: byCat[c].open, median_hours_to_close: median(byCat[c].hours) == null ? null : round2(median(byCat[c].hours) as number), closed_with_a_recorded_time: byCat[c].hours.length })).sort((a, b) => b.issues - a.issues),
      },
      invoices_approved_or_paid_12_months: sum ? { invoices: sum.invoices.count, amount_usd: Math.round(sum.invoices.cents) / 100 } : null,
      note: [
        sum ? '' : 'The vendor\'s project / request history could not be read; only guest issues are shown.',
        'Open and recent work lists are capped at the newest of each kind. Costs here are PROJECT invoices only — not cleaning-company invoices and not Breezeway task amounts, so this is not the vendor\'s total cost.',
      ].filter(Boolean).join(' '),
      _meta: toolMeta({ source: 'vendors + project_steps + glitches + field_requests + project_invoices', window: `guest issues ${since} → ${ctx.today}; invoices last 12 months`, n: gl.rows.length, truncated: gl.truncated }),
    }
  },
}

export const REACH_OPS_TOOLS: EveTool[] = [UPKEEP_DUE, INSPECTION_RESULTS, BLOCKED_UNITS, VENDOR_WORK]

// ───────────────────────────────────────────────────────────── guests drawer
const CALLS: EveTool = {
  name: 'calls',
  description: 'THE PHONE, COUNTED — two sources over a window (default 7 days, up to 90). (1) Calls the team LOGGED against a booking: welcome calls and post-checkout calls, with outcomes (post-checkout: happy / issue / no_answer) and who made them. (2) The Talkroute call log: inbound and outbound calls, answered vs missed vs hang-up, voicemails, average length, and how many were matched to a booking as a welcome / post-checkout / in-stay call. Counts only — no guest names or numbers. kind: "welcome" | "post_checkout" narrows the logged calls. Use it for "how many welcome calls did we make this week", "how many calls did we miss", "how are the post-checkout calls going". For WHICH upcoming arrivals still need a welcome call use welcome_calls.',
  input_schema: obj({ days: S.num, kind: S.str }),
  run: async (input, ctx) => {
    if (guarded(ctx)) return { error: 'Call logs are not read out in this room.' }
    const days = clampDays(input?.days, 7, 90)
    const since = shiftDay(ctx.today, -days)
    const sinceIso = since + 'T00:00:00Z'
    const kind = lc(input?.kind).trim().replace(/[\s-]+/g, '_')
    const kindQ = /welcome/.test(kind) ? 'welcome' : /post|checkout|recover/.test(kind) ? 'post_checkout' : ''
    const [logged, tr] = await Promise.all([
      pageRows<any>((a, b) => {
        let q = ctx.db.from('guest_calls').select('reservation_id,kind,outcome,called_by,called_at,listing_id').gte('called_at', sinceIso)
        if (kindQ) q = q.eq('kind', kindQ)
        return q.order('called_at').order('reservation_id').range(a, b)
      }, 10),
      pageRows<any>((a, b) => ctx.db.from('talkroute_calls').select('id,direction,result,duration,voicemail,match_kind,call_at').gte('call_at', sinceIso).order('call_at').order('id').range(a, b), 20),
    ])
    const byKind: Record<string, { n: number; outcomes: Record<string, number> }> = {}
    const byCaller: Record<string, number> = {}
    const byDay: Record<string, number> = {}
    for (const r of logged.rows) {
      const k = String(r.kind || 'other')
      if (!byKind[k]) byKind[k] = { n: 0, outcomes: {} }
      byKind[k].n++
      const o = String(r.outcome || 'done')
      byKind[k].outcomes[o] = (byKind[k].outcomes[o] || 0) + 1
      const who = String(r.called_by || 'unknown').split('@')[0]
      byCaller[who] = (byCaller[who] || 0) + 1
      const d = etDay(r.called_at); if (d) byDay[d] = (byDay[d] || 0) + 1
    }
    const dir: Record<string, { n: number; answered: number; missed: number; hangup: number; voicemail: number; secs: number; timed: number }> = {}
    const matched: Record<string, number> = {}
    for (const c of tr.rows) {
      const d = lc(c.direction) || 'unknown'
      if (!dir[d]) dir[d] = { n: 0, answered: 0, missed: 0, hangup: 0, voicemail: 0, secs: 0, timed: 0 }
      dir[d].n++
      const res = lc(c.result)
      if (res === 'answered') dir[d].answered++
      else if (res === 'missed') dir[d].missed++
      else if (res === 'hangup') dir[d].hangup++
      if (c.voicemail) dir[d].voicemail++
      if (res === 'answered' && num(c.duration) > 0) { dir[d].secs += num(c.duration); dir[d].timed++ }
      if (c.match_kind) matched[String(c.match_kind)] = (matched[String(c.match_kind)] || 0) + 1
    }
    const loggedMissing = logged.truncated && !logged.rows.length
    const trMissing = tr.truncated && !tr.rows.length
    return {
      window: `${since} → ${ctx.today}`,
      logged_calls: loggedMissing ? { unavailable: 'The guest_calls table could not be read.' } : {
        count: logged.rows.length, truncated: logged.truncated || undefined,
        by_kind: Object.keys(byKind).map(k => ({ kind: k, calls: byKind[k].n, outcomes: byKind[k].outcomes })),
        by_caller: Object.keys(byCaller).map(k => ({ who: k, calls: byCaller[k] })).sort((a, b) => b.calls - a.calls).slice(0, 15),
        by_day: Object.keys(byDay).sort().map(d => ({ day: d, calls: byDay[d] })),
        what_it_is: 'One row per booking per kind, written when someone marks the call done in Lighthouse — a call nobody logged is not here.',
      },
      phone_log: trMissing ? { unavailable: 'The Talkroute call log could not be read (or the sync is not set up).' } : {
        count: tr.rows.length, truncated: tr.truncated || undefined,
        by_direction: Object.keys(dir).map(d => ({ direction: d, calls: dir[d].n, answered: dir[d].answered, missed: dir[d].missed, hung_up: dir[d].hangup, voicemails: dir[d].voicemail, answered_pct: dir[d].n >= 5 ? Math.round((dir[d].answered / dir[d].n) * 100) : null, avg_minutes_when_answered: dir[d].timed ? round2(dir[d].secs / dir[d].timed / 60) : null })),
        matched_to_a_booking: matched,
        what_it_is: 'Every call Talkroute recorded on our numbers. "matched" means the number was tied to a booking; an unmatched call can still be a guest.',
      },
      _meta: toolMeta({ source: 'guest_calls + talkroute_calls', window: `${since} → ${ctx.today}`, n: logged.rows.length + tr.rows.length, truncated: logged.truncated || tr.truncated }),
    }
  },
}

export const REACH_GUEST_TOOLS: EveTool[] = [CALLS]

// ───────────────────────────────────────────────────────────── system drawer
const AI_SPEND: EveTool = {
  name: 'ai_spend',
  money: true,
  description: 'WHAT THE AI ITSELF HAS COST — every model call Lighthouse made over a window (default 7 days, up to 60), priced: total dollars, by task (Eve chat, Slack reading, sentiment, review replies, …), by day and by model, with call counts, failures and how much of the input was served from cache; plus today\'s and this month\'s spend against the caps and whether AI is paused. Use it for "what did you cost today", "what is the most expensive AI job", "are we near the cap".',
  input_schema: obj({ days: S.num, task: S.str }),
  run: async (input, ctx) => {
    if (guarded(ctx)) return { error: 'AI spend is not read out in this room.' }
    const days = clampDays(input?.days, 7, 60)
    const since = shiftDay(ctx.today, -(days - 1))
    const taskQ = String(input?.task || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
    const got = await pageRows<any>((a, b) => {
      let q = ctx.db.from('ai_usage').select('id,at,task,model,cost_usd,input_tokens,output_tokens,cache_read,cache_write,ok').gte('at', shiftDay(since, -1) + 'T00:00:00Z')
      if (taskQ) q = q.eq('task', taskQ)
      return q.order('id').range(a, b)
    }, 40)
    if (got.truncated && !got.rows.length) return { error: 'The AI usage ledger could not be read.' }
    const byTask: Record<string, { calls: number; cost: number; failed: number; inTok: number; cacheRead: number }> = {}
    const byDay: Record<string, { calls: number; cost: number }> = {}
    const byModel: Record<string, { calls: number; cost: number }> = {}
    let total = 0, calls = 0
    for (const r of got.rows) {
      // The read starts a day early in UTC; the window itself is whole Eastern days.
      const rowDay = etDay(r.at)
      if (rowDay && rowDay < since) continue
      const c = num(r.cost_usd)
      total += c; calls++
      const t = String(r.task || 'unknown')
      if (!byTask[t]) byTask[t] = { calls: 0, cost: 0, failed: 0, inTok: 0, cacheRead: 0 }
      byTask[t].calls++; byTask[t].cost += c
      if (r.ok === false) byTask[t].failed++
      byTask[t].inTok += num(r.input_tokens) + num(r.cache_read) + num(r.cache_write); byTask[t].cacheRead += num(r.cache_read)
      const d = etDay(r.at) || String(r.at || '').slice(0, 10)
      if (!byDay[d]) byDay[d] = { calls: 0, cost: 0 }
      byDay[d].calls++; byDay[d].cost += c
      const m = String(r.model || 'unknown')
      if (!byModel[m]) byModel[m] = { calls: 0, cost: 0 }
      byModel[m].calls++; byModel[m].cost += c
    }
    let caps: any = null
    try {
      const s = await spendNow()
      caps = { spent_today_usd: round2(s.day), spent_this_month_usd: round2(s.month), daily_cap_usd: s.budget.totalUsd, automatic_jobs_daily_cap_usd: s.budget.automaticUsd, monthly_cap_usd: s.budget.monthUsd, caps_on: s.budget.on, ai_paused: s.budget.paused }
    } catch { caps = null }
    return {
      window: `${since} → ${ctx.today} (Eastern days)`,
      calls, truncated: got.truncated || undefined,
      spend_usd: round2(total),
      by_task: Object.keys(byTask).map(t => ({ task: t, calls: byTask[t].calls, cost_usd: round2(byTask[t].cost), share_pct: total > 0 ? Math.round((byTask[t].cost / total) * 100) : null, failed_calls: byTask[t].failed || undefined, input_from_cache_pct: byTask[t].inTok > 0 ? Math.round((byTask[t].cacheRead / byTask[t].inTok) * 100) : null })).sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 25),
      by_day: Object.keys(byDay).sort().map(d => ({ day: d, calls: byDay[d].calls, cost_usd: round2(byDay[d].cost) })),
      by_model: Object.keys(byModel).map(m => ({ model: m, calls: byModel[m].calls, cost_usd: round2(byModel[m].cost) })).sort((a, b) => b.cost_usd - a.cost_usd),
      caps_and_today: caps || 'The caps could not be read.',
      note: (got.truncated ? 'The ledger read stopped early — these totals are floors. ' : '') + 'Costs are what Lighthouse priced each call at when it was made (lib/ai-usage), not an invoice. Tasks are the keys on Settings → AI models.',
      _meta: toolMeta({ source: 'ai_usage (the AI call ledger)', window: `${since} → ${ctx.today}`, n: calls, truncated: got.truncated }),
    }
  },
}

export const REACH_SYSTEM_TOOLS: EveTool[] = [AI_SPEND]
