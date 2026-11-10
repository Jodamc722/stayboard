// THE PM CALENDAR — what is due, and when, before anybody has to decide about it.
//
// Jon, 2026-09-09: "review full today in ops plan, build it, add tasks, suggestions, PMs."
//
// lib/suggestions answers one question extremely well: what could be done TODAY, by somebody who is
// already standing nearby. To do that it throws almost everything away — a job three days from due
// is "not due"; a job in a building nobody is visiting is "nobody near it". Both are right answers
// to that question and both make the same thing impossible: seeing the shape of the month. A
// supervisor cannot plan a Tuesday run to 17WEST from a list that only ever shows today.
//
// So this file asks the OTHER question, over the same cadence catalogue and the same history:
//
//   for every active unit × every live cadence — when is it next due, and how late is it now?
//
// No proximity, no caps, no day read, no dismissals: this is the ledger, not the plan. It is what
// you look at on a quiet Thursday to book next week, and what tells you a building has drifted.
//
// GROUPED BY BUILDING, because that is how the work is actually done — one trip, one lift, one
// afternoon. A per-unit list of 233 rows is a spreadsheet; "17WEST: nine filters and two flushes,
// four of the units are empty Tuesday" is a plan.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { marketOf, buildingOf } from './segments'
import { vendorRegex } from './ops-presets'
import { getOpsPresets } from './app-settings'
import { CADENCE_KEY, resolveCadences, cadenceRe, daysBetween, matchOrder as cadenceMatchOrder, type CadenceDef } from './cadences'
import { getSetting, setSetting } from './app-settings'
import { isTaskDone, isTaskGone } from './task-categories'
import { linkedSets } from './linked-units'
import { acTypeMap, equipmentMatches } from './unit-equipment'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const dOf = (v: any) => str(v).slice(0, 10)
const shift = (ymd: string, days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.parse(ymd + 'T12:00:00Z') + days * 86400000))

export type DueItem = {
  /** Stable across a day, and the same shape lib/suggestions uses, so one row can carry either. */
  id: string
  cadenceKey: string
  label: string
  dept: CadenceDef['dept']
  minutes: number
  listingId: string
  unit: string
  building: string | null
  market: string
  /** A vendor unit also answers to its geography when that geography would otherwise be empty — the
      same two-market rule the board uses, or the Miami chip would hide units Miami shows. */
  market2: string | null
  vendor: boolean
  /** null when there is no record of it ever being done. */
  lastDone: string | null
  /** The unit went live more recently than this cadence's interval and has no record: the clock
      started the day it went live (lastDone = goLive). Jon, 2026-10-13: "Salato and some with no
      record could be a new unit." */
  newUnit?: { goLive: string } | null
  /** No record and not a new unit: the clock was started on `started` (Jon, 2026-10-16: "if there's
      no task recorded, start the ticker for that unit, unless it's a brand-new property"). The first
      round is spread over one interval so 76 filter changes do not all land on the same day; after
      that, a real completion takes over and the normal interval applies. lastDone stays null. */
  clock?: { started: string; firstDue: string } | null
  /** lastDone is the date a PERSON recorded on the Upkeep page (not a finished task). */
  recorded?: boolean
  /** The day it comes due (last done + interval). For a never-recorded job, today. */
  dueOn: string
  /** Negative = not due yet; 0 = today; positive = days past due. */
  daysOver: number
  /** Already on the board or scheduled ahead — listed, never proposed twice. */
  scheduled: { taskId: string; date: string } | null
  /** Where it lands: late · due this week · later · or 'unknown' — we have no record at all. */
  band: 'late' | 'week' | 'later' | 'unknown'
}

export type DueBuilding = {
  key: string
  building: string
  market: string
  vendor: boolean
  units: number
  late: number
  week: number
  later: number
  /** Never recorded. Counted apart from the schedule, because it is a different kind of problem. */
  unknown: number
  minutes: number
  items: DueItem[]
}

export type DueCalendar = {
  ok: true
  today: string
  horizonDays: number
  /** Cadences that are switched off, or scoped to nothing yet — named, so a silent zero is impossible. */
  inert: { key: string; label: string; why: string }[]
  enabled: boolean
  totals: { late: number; week: number; later: number; unknown: number; scheduled: number; minutes: number }
  buildings: DueBuilding[]
  /** A read that stopped early — the numbers below are floors, not truths. */
  degraded: string[]
}

/**
 * Everything due within `horizonDays`, plus everything already overdue, grouped by building.
 *
 * `market` narrows it the way the board's chips do ('all' for the portfolio). Read-only: this
 * creates nothing and dismisses nothing.
 */
export async function buildDueCalendar(today: string, opts: { horizonDays?: number; market?: string } = {}): Promise<DueCalendar> {
  const horizon = Math.max(7, Math.min(400, opts.horizonDays ?? 30))
  const market = opts.market || 'all'
  const db = supabaseAdmin()
  const degraded: string[] = []
  const cfg = await resolveCadencesSafe()
  const live = cfg.cadences.filter(c => c.mode !== 'off')
  const inert: DueCalendar['inert'] = []
  for (const c of cfg.cadences) {
    if (c.mode === 'off') inert.push({ key: c.key, label: c.label, why: 'switched off' })
    else if (c.needsScope && !(c.scopeBuildings || []).length && !(c.scopeUnits || []).length) {
      inert.push({ key: c.key, label: c.label, why: 'no buildings picked yet — nothing to apply it to' })
    }
  }
  const usable = live.filter(c => !(c.needsScope && !(c.scopeBuildings || []).length && !(c.scopeUnits || []).length))
  const maxEvery = usable.reduce((m, c) => Math.max(m, c.everyDays), 365)

  // SPEED (2026-11-10: the Upkeep board took 4.4 s). Everything below that does not depend on another
  // read is STARTED here and awaited where it is used, instead of one read after another: the presets,
  // the equipment map, the listings, one read of the task mirror, and the small side reads (dates
  // recorded by hand, FF&E walks, the started clocks). Same reads, same rules, same numbers.
  const since = shift(today, -(maxEvery + 30))
  // Far enough that a job booked beyond the view still counts as handled.
  const ahead = shift(today, Math.max(horizon, maxEvery))
  // ONE read of the mirror, not two. The "history" read (since → today) was a strict subset of the
  // "open work" read (since → ahead), so every past row was fetched twice. Its pages are fetched six
  // at a time. Departure cleans and strips are left out exactly as before — they are most of the
  // volume, and a 365-day cadence depends on the oldest rows surviving.
  const tasksP = pageWaves<any>((a, b) => db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department')
    .gte('scheduled_date', since).lte('scheduled_date', ahead)
    .not('name', 'ilike', '%departure clean%')
    .not('name', 'ilike', '%strip%')
    .order('scheduled_date', { ascending: true }).order('id').range(a, b), 30)
  const ffeP: Promise<any[]> = usable.some(c => c.key === 'ffe_audit')
    ? Promise.resolve(db.from('ffe_unit_status').select('listing_id,completed_at').not('completed_at', 'is', null)).then((r: any) => (r && !r.error ? (r.data || []) : []), () => [])
    : Promise.resolve([])
  const recKeptP = readRecorded()
  const recPagedP = pageRows<any>((a, b) => db.from('pm_schedule').select('listing_id,cadence_key,last_done,note')
    .ilike('note', 'recorded %').not('last_done', 'is', null).order('listing_id').order('cadence_key').range(a, b), 8).catch(() => ({ rows: [] as any[], truncated: false }))
  const clocksP = readClocks()

  const [presets, acOf, lq] = await Promise.all([
    getOpsPresets(),
    // Equipment per unit, for cadences with a rule (central A/C only, mini-splits only).
    usable.some(c => c.equipment && c.equipment !== 'any') ? acTypeMap() : Promise.resolve({} as Awaited<ReturnType<typeof acTypeMap>>),
    // ── the units ──────────────────────────────────────────────────────────────────────────────
    db.from('guesty_listings').select('id,nickname,title,building,address_city,status,created:raw->>createdAt'),
  ])
  const VENDOR_RE = vendorRegex(presets.vendorBuildings)
  const { data: lRes, error: lErr } = lq
  if (lErr) throw new Error('could not read listings — ' + String(lErr.message).slice(0, 120))
  type Meta = { name: string; building: string | null; bucket: string; market: string; market2: string | null; vendor: boolean; created: string | null }
  const meta: Record<string, Meta> = {}
  const ids: string[] = []
  const rows = ((lRes || []) as any[]).filter(l => str(l.status).trim().toLowerCase() === 'active')
  // Which geographies can stand on their own — the board's rule, so a vendor building only keeps its
  // geography when that geography would otherwise be an empty tab.
  const geoHasOwn = new Set<string>()
  for (const l of rows) {
    const nm = str(l.nickname || l.title) || 'Unit'
    if (VENDOR_RE.test(str(l.building)) || VENDOR_RE.test(nm)) continue
    geoHasOwn.add(marketOf(l.building, l.address_city, nm))
  }
  for (const l of rows) {
    const name = str(l.nickname || l.title) || 'Unit'
    const vendor = VENDOR_RE.test(str(l.building)) || VENDOR_RE.test(name)
    const geo = marketOf(l.building, l.address_city, name)
    const mk = vendor ? 'Vendor' : geo
    const mk2 = vendor && !geoHasOwn.has(geo) ? geo : null
    if (market !== 'all' && mk !== market && mk2 !== market) continue
    const building = str(l.building) || null
    meta[String(l.id)] = { name, building, bucket: (building || buildingOf(name) || name).toLowerCase(), market: mk, market2: mk2, vendor, created: dOf(l.created) || null }
    ids.push(String(l.id))
  }
  if (!ids.length) {
    return { ok: true, today, horizonDays: horizon, inert, enabled: cfg.enabled, totals: { late: 0, week: 0, later: 0, unknown: 0, scheduled: 0, minutes: 0 }, buildings: [], degraded }
  }

  // ── history: when was each cadence last done, per unit ───────────────────────────────────────
  // One read back one full cadence plus slack, exactly as the suggestion engine does, so the two
  // never disagree about whether something has been done.
  const [histPaged, openPaged] = await (async () => {
    const all = await tasksP
    // History = the rows dated today or earlier; open work looks at all of them, earliest first.
    return [{ rows: all.rows.filter((t: any) => dOf(t.scheduled_date) <= today), truncated: all.truncated }, all] as const
  })()
  /* The two reads this replaced, kept for the record:
    // The same two exclusions lib/suggestions uses. Departure cleans and strips are the overwhelming
    // majority of task volume, and 395 days of them would blow past any page budget — with the
    // OLDEST rows dropped, which are exactly the completions a 365-day cadence depends on.
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department')
      .gte('scheduled_date', since).lte('scheduled_date', today)
      .not('name', 'ilike', '%departure clean%')
      .not('name', 'ilike', '%strip%')
      .order('scheduled_date', { ascending: false }).order('id').range(a, b), 12),
    // Anything still OPEN on the books — a job scheduled for Tuesday is not "due and forgotten", it
    // is handled. Deliberately looking BACK as well as forward: an unfinished task dated last month
    // is the most likely thing to be re-filed by mistake, and the horizon is what you are looking
    // at, never what counts as handled.
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,finished_at,type_department')
      .gte('scheduled_date', since).lte('scheduled_date', ahead)
      .not('name', 'ilike', '%departure clean%')
      .not('name', 'ilike', '%strip%')
      .order('scheduled_date', { ascending: true }).order('id').range(a, b), 12),
  ]) */
  if (histPaged.truncated) degraded.push('task history (the ledger is a floor, not a total)')
  if (openPaged.truncated) degraded.push('scheduled work')

  const res: Record<string, RegExp | null> = {}
  for (const c of usable) res[c.key] = cadenceRe(c.match)
  // FIRST MATCH WINS, exactly as lib/suggestions does. Returning every hit let one "A/C deep clean"
  // also reset the housekeeping deep-clean clock, because both patterns match the words.
  // The department is normalised, because Breezeway carries free text ('safety', 'Housekeeping')
  // and a raw comparison silently threw away real history.
  const deptOf = (v: any): string => {
    const x = String(v || '').toLowerCase()
    if (/housekeep|clean/.test(x)) return 'housekeeping'
    if (/maint/.test(x)) return 'maintenance'
    if (/inspect/.test(x)) return 'inspection'
    return ''
  }
  // A PROGRAM MADE ON THE UPKEEP PAGE IS MATCHED FIRST (2026-11-09 audit). Its pattern is its own
  // name, anchored ("^\\s*Quarterly inspection"), and its tasks are named exactly that — but the
  // shipped patterns are loose ("inspect", "filter", "deep clean") and came first in the list, so a
  // finished "Quarterly inspection — 906/6" reset the generic unit-inspection clock and the new
  // program never saw its own task: always late, never booked, proposed again every run.
  // (The rule itself now lives in lib/cadences matchOrder, shared with lib/suggestions and lib/pm-dedupe.)
  const matchOrder = cadenceMatchOrder(usable)
  const matchOf = (name: string, deptRaw: string): string[] => {
    const dept = deptOf(deptRaw)
    for (const c of matchOrder) {
      const re = res[c.key]
      if (!re || !re.test(name)) continue
      // An unrecognised department tells us nothing, so it does not veto the name match.
      if (dept && c.dept !== dept) continue
      return [c.key]
    }
    // WORK THAT RIDES THE DEPARTURE CLEAN IS OFTEN FILED UNDER HOUSEKEEPING (the A/C filter change:
    // a maintenance program done by the cleaner). The department veto above threw those away, so a
    // finished "Filter change" under Housekeeping never reset the clock and never counted as booked
    // — the unit stayed late and another task was proposed. Only for programs that ride the
    // departure, and only when nothing matched with its department.
    if (dept) {
      for (const c of matchOrder) {
        if (!c.ridesDeparture) continue
        const re = res[c.key]
        if (re && re.test(name)) return [c.key]
      }
    }
    return []
  }

  const lastDone: Record<string, Record<string, string>> = {}
  for (const t of histPaged.rows as any[]) {
    if (isTaskGone(t.status)) continue          // cancelled, even if it carries a finished_at
    if (!isTaskDone(t.status, t.finished_at)) continue
    const lid = String(t.reference_property_id)
    const day = dOf(t.finished_at || t.scheduled_date)
    if (!day) continue
    for (const key of matchOf(str(t.name), str(t.type_department).toLowerCase())) {
      const cur = (lastDone[lid] = lastDone[lid] || {})
      if (!cur[key] || day > cur[key]) cur[key] = day
    }
  }
  // FF&E AUDITS ARE RECORDED IN /ffe, not only as tasks (2026-10-03, Upkeep page): a unit marked
  // finished there counts as that cadence done on that day. A missing table reads as "no record".
  if (usable.some(c => c.key === 'ffe_audit')) {
    try {
      const ffe = await ffeP
      for (const r of ((ffe || []) as any[])) {
        const lid = String(r.listing_id), day = dOf(r.completed_at)
        if (!day) continue
        const cur = (lastDone[lid] = lastDone[lid] || {})
        if (!cur.ffe_audit || day > cur.ffe_audit) cur.ffe_audit = day
      }
    } catch { /* no FF&E table yet */ }
  }
  // RECORDED BY A PERSON (Upkeep page, 2026-10-13: "no record" was 1,033 of 1,618 rows — most of them
  // jobs that were done before the task names were sensible, or done by a vendor). A supervisor can
  // record "last done on <day>" on the Upkeep page; it lands on the ledger with a "recorded …" note
  // and counts here exactly like a completed task. The newer of the two wins.
  //
  // TWO THINGS WERE LOSING THOSE DATES (2026-11-09 audit):
  //  • the read asked for 2,000 rows in one request and PostgREST hands back 1,000 — past that, a
  //    recorded date silently read as "no record". It is paged now.
  //  • the date only counted while the ledger note still began "recorded …", and the recurrence pass,
  //    a decline and an approval all rewrite that note ("proposed …", "waiting for an empty day",
  //    "declined …"). The moment the next job was proposed, the date a person typed in was gone and
  //    the unit fell back to a started clock. So the dates are ALSO kept in their own app_settings
  //    row (RECORDED_KEY), written by the record action and backfilled here from any ledger row that
  //    still carries its note. Where both exist the settings row wins — it is what the person last typed.
  const recordedDay: Record<string, string> = {}
  {
    const kept = await recKeptP
    for (const k of Object.keys(kept || {})) { const d = dOf((kept as any)[k]); if (d) recordedDay[k] = d }
    const backfill: Record<string, string> = {}
    try {
      const recPaged = await recPagedP
      if (recPaged.truncated) degraded.push('dates recorded by hand')
      for (const r of recPaged.rows as any[]) {
        const lid = String(r.listing_id), day = dOf(r.last_done), key = String(r.cadence_key)
        if (!day || !key) continue
        const k = `${lid}|${key}`
        if (!recordedDay[k]) { recordedDay[k] = day; backfill[k] = day }
      }
    } catch { /* no ledger yet */ }
    for (const k of Object.keys(recordedDay)) {
      const i = k.indexOf('|'); if (i <= 0) continue
      const lid = k.slice(0, i), key = k.slice(i + 1), day = recordedDay[k]
      if (day > today) continue
      const cur = (lastDone[lid] = lastDone[lid] || {})
      if (!cur[key] || day > cur[key]) cur[key] = day
    }
    // Only when the settings row was READ (a failed read must never be written back as the truth).
    if (kept && Object.keys(backfill).length) {
      const cur = await readRecorded()
      if (cur) await setSetting(RECORDED_KEY, { ...backfill, ...cur }, 'upkeep-recorded').catch(() => null)
    }
  }
  // ── NEW UNITS (Jon, 2026-10-13: "Salato and some with no record could be a new unit") ─────────
  // A unit listed in September cannot owe a deep clean from "never". When a unit went live more
  // recently than a cadence's interval and nothing has been recorded, the clock starts the day it
  // went live. Go-live is the first non-cancelled check-in, else the day Guesty created the
  // listing; a unit whose listing predates the longest interval is simply not new.
  const goLive: Record<string, string> = {}
  {
    const young = ids.filter(id => meta[id].created && meta[id].created! >= since)
    for (const id of young) goLive[id] = meta[id].created!
    if (young.length) {
      try {
        const { data: rs } = await db.from('guesty_reservations').select('listing_id,check_in,status')
          .in('listing_id', young.slice(0, 200)).order('check_in', { ascending: true }).limit(2000)
        const first: Record<string, string> = {}
        for (const r of ((rs || []) as any[])) {
          const st = str(r.status).toLowerCase()
          if (st === 'canceled' || st === 'cancelled' || st === 'declined' || st === 'expired') continue
          const lid = String(r.listing_id), day = dOf(r.check_in)
          if (day && (!first[lid] || day < first[lid])) first[lid] = day
        }
        // The first stay is the truth either way: later than the listing date means it sat unlisted
        // a while; earlier means the listing was re-created and the unit is older than it looks.
        for (const id of young) if (first[id]) goLive[id] = first[id]
      } catch { /* the listing date stands */ }
    }
  }
  const scheduledAhead: Record<string, Record<string, { taskId: string; date: string }>> = {}
  for (const t of openPaged.rows as any[]) {
    if (isTaskGone(t.status) || isTaskDone(t.status, t.finished_at)) continue
    const lid = String(t.reference_property_id)
    for (const key of matchOf(str(t.name), str(t.type_department).toLowerCase())) {
      const cur = (scheduledAhead[lid] = scheduledAhead[lid] || {})
      if (!cur[key]) cur[key] = { taskId: String(t.id), date: dOf(t.scheduled_date) }
    }
  }

  // History flows down from a whole unit to its halves — the same rule the suggestion engine uses,
  // or "3316/1" reads as never-done the morning after "3316 Full" was deep cleaned.
  const links = linkedSets(ids.map(id => ({ listingId: id, unit: meta[id].name, building: meta[id].bucket })))
  const parentsOf: Record<string, string[]> = links.parentsOf || {}

  // The tickers already started (see DueItem.clock). One app_settings row, read once.
  // A failed read must never be written back as "no clocks" — that would restart every ticker.
  const stored = await clocksP
  const clocks: Record<string, { s: string; d: string }> = { ...(stored || {}) }
  let clocksDirty = false

  const weekEnd = shift(today, 7)
  const items: DueItem[] = []
  for (const lid of ids) {
    // A unit listed both whole and in halves gets ONE row, on the halves — otherwise "Add all"
    // sends three people to one front door (lib/linked-units).
    if (links.isRedundantParent[lid]) continue
    const m = meta[lid]
    for (const c of usable) {
      // Scope, when somebody has named the buildings this cadence applies to.
      const scopeB = c.scopeBuildings || [], scopeU = c.scopeUnits || []
      if (scopeB.length || scopeU.length) {
        const norm = (x: string) => String(x || '').trim().toLowerCase()
        const inScope = scopeB.some(b => norm(b) === m.bucket || norm(b) === norm(m.building || ''))
          || scopeU.some(u => u === lid || norm(u) === norm(m.name))
        if (!inScope) continue
      }
      // We do not staff vendor buildings, so their housekeeping cadences are not ours to plan.
      if (m.vendor && c.dept === 'housekeeping') continue
      // The equipment rule: a unit whose A/C type is unknown is left out of a specific rule.
      if (c.equipment && c.equipment !== 'any' && !equipmentMatches(c.equipment, acOf[lid])) continue

      let ld = lastDone[lid]?.[c.key] || null
      for (const pid of (parentsOf[lid] || [])) {
        const pld = lastDone[pid]?.[c.key] || null
        if (pld && (!ld || pld > ld)) ld = pld
      }
      // No record is never "due today" any more (2026-10-16): the ticker below gives it a real first
      // due date, spread over one interval, so nothing piles into "Add all" on day one.
      // New unit, no record: the clock starts the day it went live (see goLive above).
      let newUnit: DueItem['newUnit'] = null
      const gl = goLive[lid]
      // A BRAND-NEW unit (live within BRAND_NEW_DAYS, e.g. Salato) counts from go-live for every
      // program — a 35-day filter on a unit live 39 days really is due. An older unit counts from
      // go-live only while that is still inside one interval.
      if (!ld && gl && (daysBetween(gl, today) < c.everyDays || daysBetween(gl, today) <= BRAND_NEW_DAYS)) { ld = gl; newUnit = { goLive: gl } }
      // Still nothing: start (or keep) the ticker for this unit × program.
      let clock: DueItem['clock'] = null
      if (!ld) {
        const ck = `${lid}|${c.key}`
        const have = clocks[ck]
        if (have && have.s && have.d) clock = { started: have.s, firstDue: have.d }
        else {
          clock = { started: today, firstDue: shift(today, staggerDays(ck, c.everyDays)) }
          clocks[ck] = { s: clock.started, d: clock.firstDue }; clocksDirty = true
        }
      }
      // A never-recorded job is due today by definition — but it is stated as "no record", never as
      // "365 days overdue", because a missing record is far more often a data gap than neglect.
      // ── "NO RECORD" IS NOT "DUE TODAY" ──────────────────────────────────────────────────────
      // The first live run of this ledger reported 486 jobs due this week and 1,035 hours of work,
      // because almost no unit has an A/C deep clean or a deep clean in the task history and every
      // one of them was being dated today. That is not a schedule, it is the absence of one — and
      // mixing it into "due this week" buries the four jobs that genuinely are. A never-recorded
      // job gets its own band: counted, visible, addable one building at a time, and never swept
      // into a schedule number or into "Add all".
      const dueOn = ld ? shift(ld, c.everyDays) : clock ? clock.firstDue : today
      const timed = !!(ld || clock)
      const daysOver = timed ? daysBetween(dueOn, today) : 0
      if (timed && daysOver < -horizon) continue            // beyond the horizon: not this view's business
      const sched = scheduledAhead[lid]?.[c.key] || null
      const band: DueItem['band'] = !timed ? 'unknown' : daysOver > 0 ? 'late' : (dueOn <= weekEnd ? 'week' : 'later')
      items.push({
        id: `${today}|${lid}|${c.key}`,
        cadenceKey: c.key, label: c.label, dept: c.dept, minutes: c.minutes,
        listingId: lid, unit: m.name, building: m.building, market: m.market, vendor: m.vendor,
        market2: m.market2, lastDone: ld, newUnit, clock, dueOn, daysOver, scheduled: sched, band,
        recorded: !!ld && !newUnit && recordedDay[`${lid}|${c.key}`] === ld,
      })
    }
  }

  if (clocksDirty && stored) {
    // Merge with whatever another request wrote meanwhile — theirs stands where both have a key.
    const cur = await readClocks()
    if (cur) await setSetting(CLOCK_KEY, { ...clocks, ...cur }, 'upkeep-clock').catch(() => null)
  }

  // ── group by building ────────────────────────────────────────────────────────────────────────
  const byBuilding: Record<string, DueBuilding> = {}
  for (const it of items) {
    const key = (it.building || buildingOf(it.unit) || it.unit)
    const b = (byBuilding[key] = byBuilding[key] || {
      key, building: key, market: it.market, vendor: it.vendor,
      units: 0, late: 0, week: 0, later: 0, unknown: 0, minutes: 0, items: [],
    })
    b.items.push(it)
    if (!it.scheduled) {
      b[it.band]++
      // Minutes describe the SCHEDULE, so a job we have never recorded does not inflate it.
      if (it.band !== 'unknown') b.minutes += it.minutes
    }
  }
  for (const b of Object.values(byBuilding)) {
    b.units = new Set(b.items.map(i => i.listingId)).size
    // Late first, then soonest due, then the unit — the order somebody works a building in.
    // Booked last, no-record after the real schedule, then most overdue first.
    const rank = (i: DueItem) => (i.scheduled ? 2 : i.band === 'unknown' ? 1 : 0)
    b.items.sort((x, y) => rank(x) - rank(y) || y.daysOver - x.daysOver || x.unit.localeCompare(y.unit))
  }
  const buildings = Object.values(byBuilding)
    .filter(b => b.items.length)
    .sort((a, b) => (b.late - a.late) || (b.week - a.week) || (b.unknown - a.unknown) || a.building.localeCompare(b.building))

  const unscheduled = items.filter(i => !i.scheduled)
  return {
    ok: true, today, horizonDays: horizon, inert, enabled: cfg.enabled,
    totals: {
      late: unscheduled.filter(i => i.band === 'late').length,
      week: unscheduled.filter(i => i.band === 'week').length,
      later: unscheduled.filter(i => i.band === 'later').length,
      unknown: unscheduled.filter(i => i.band === 'unknown').length,
      scheduled: items.filter(i => !!i.scheduled).length,
      minutes: unscheduled.filter(i => i.band !== 'unknown').reduce((n, i) => n + i.minutes, 0),
    },
    buildings, degraded,
  }
}

/**
 * Page an ALREADY-ORDERED query to completion, six pages at a time (lib/db-page reads one page after
 * another — ten round trips for ten thousand rows). The first page goes alone: most reads end there.
 * A failed page is "stopped early", never "the end", exactly as pageRows reports it.
 */
async function pageWaves<T = any>(q: (from: number, to: number) => PromiseLike<any>, maxPages = 30): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = []
  const seen: Record<string, boolean> = {}
  const take = (data: any[]) => { for (const row of data) { const k = row && row.id != null ? String(row.id) : null; if (k) { if (seen[k]) continue; seen[k] = true } out.push(row as T) } }
  const one = async (p: number): Promise<any[] | null> => {
    try { const res: any = await q(p * 1000, p * 1000 + 999); if (res && res.error) return null; return (res?.data || []) as any[] } catch { return null }
  }
  const first = await one(0)
  if (!first) return { rows: out, truncated: true }
  take(first)
  if (first.length < 1000) return { rows: out, truncated: false }
  for (let p = 1; p < maxPages; p += 6) {
    const idx: number[] = []
    for (let i = p; i < Math.min(maxPages, p + 6); i++) idx.push(i)
    const pages = await Promise.all(idx.map(one))
    for (const d of pages) {            // in page order, so the rows stay in the query's order
      if (!d) return { rows: out, truncated: true }
      take(d)
      if (d.length < 1000) return { rows: out, truncated: false }
    }
  }
  return { rows: out, truncated: true }
}

/** Where the started tickers live: { "<listingId>|<cadenceKey>": { s: started, d: first due } }. */
export const CLOCK_KEY = 'upkeep_clocks'
/** The started tickers, straight from the table (no cache). null = the read failed. */
async function readClocks(): Promise<Record<string, { s: string; d: string }> | null> {
  try {
    const { data, error } = await supabaseAdmin().from('app_settings').select('value').eq('key', CLOCK_KEY).limit(1)
    if (error) return null
    const raw = (data as any[])?.[0]?.value
    if (!raw) return {}
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && typeof v === 'object' ? v : {}
  } catch { return null }
}
/** Dates recorded by hand on the Upkeep page: { "<listingId>|<cadenceKey>": "YYYY-MM-DD" }. */
export const RECORDED_KEY = 'upkeep_recorded'
/** Straight from the table (no cache). null = the read failed. */
async function readRecorded(): Promise<Record<string, string> | null> {
  try {
    const { data, error } = await supabaseAdmin().from('app_settings').select('value').eq('key', RECORDED_KEY).limit(1)
    if (error) return null
    const raw = (data as any[])?.[0]?.value
    if (!raw) return {}
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return null }
}
/**
 * Keep a hand-recorded date where no later note can lose it (see the read in buildDueCalendar).
 * Overwrites the unit × program's entry — a "Fix date" to an earlier day must stick. Best-effort:
 * the ledger row written beside it still carries the date if this fails.
 */
export async function setRecordedDay(listingId: string, cadenceKey: string, day: string, by?: string | null): Promise<boolean> {
  if (!listingId || !cadenceKey || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const cur = await readRecorded()
  if (!cur) return false
  const r = await setSetting(RECORDED_KEY, { ...cur, [`${listingId}|${cadenceKey}`]: day }, by || 'upkeep-recorded').catch(() => null)
  return !!(r && r.ok)
}
/** A unit live this recently is brand new: every program counts from its go-live, not from a ticker. */
const BRAND_NEW_DAYS = 120
/** The first round, spread: due somewhere between two weeks and one full interval out, fixed per unit × program. */
function staggerDays(key: string, every: number): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  const lo = Math.min(14, every), span = Math.max(0, every - lo)
  return lo + ((h >>> 0) % (span + 1))
}

/** The saved cadence config, with the shipped one as the floor. */
async function resolveCadencesSafe() {
  const raw = await getSetting<any>(CADENCE_KEY, null).catch(() => null)
  return resolveCadences(raw)
}
