// THE FOUR SIGNALS NOBODY WAS CATCHING.
//
// Found by reading 30 days of every ops channel (2026-08-19). Each one is something a human was
// already chasing by memory, in Slack, at some cost — so the bar is not "is this detectable" but
// "was somebody doing this by hand". All four were.
//
//   1. REPEAT OFFENDERS   Arya 2004/2 A/C was closed as fixed on the 13th, reopened the 14th,
//                         reopened the 15th. Three tickets, no link between them. It surfaced
//                         because JON remembered and asked "did we not just get this fixed?"
//   2. DOOR CODES         Arya 1705/2 and Capri 116 were both given 4519 on the same night, and
//                         Eden 2103 was published as 2507 but set to 2727 in the field.
//   3. BLOCKED + ARRIVING A guest booked into a unit that is out of service. Caught by hand hours
//                         before check-in: "we have a reservation in 512... should we just cancel?"
//   4. MARKET PRIORITIES  Jon: "a general brief in the VR ops channel, short and to the point,
//                         top priorities per market."
//
// Every detector returns PLAIN DATA. Wording lives in lib/slack-messages, routing in
// lib/slack-alerts. None of them throw — a detector that fails returns nothing and the rest run.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf, marketOf, type Market } from './segments'
import { blockedUnits, type BlockedRun } from './blocked-units'
import { isLiveStay } from './stay-status'
import { loadBehind } from './ops-behind'
import { getShifts, nameMatches, nameMatchesRoster } from './homebase'
import { getTimecards } from './homebase-labor'

const DAY = 86_400_000
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
export const addDays = (ymd: string, n: number): string => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * DAY))

const CLOSED = ['closed', 'done', 'resolved']

// ── 1. Repeat offenders ────────────────────────────────────────────────────────────────────────

export type RepeatOffender = {
  unit: string
  building: string | null
  category: string
  count: number
  firstSeen: string      // YYYY-MM-DD
  lastSeen: string
  /** how many of the earlier ones were closed — "we already fixed this" is the damning part */
  closedBefore: number
  latestIssue: string
}

/**
 * Same unit, same category, more than once inside the window. Category matters: two different
 * faults in one unit is a busy week, the SAME fault twice is a bad repair.
 *
 * Deliberately counts CLOSED tickets too — a repeat only means something if the earlier one was
 * marked done. That is the whole signal.
 */
export async function findRepeatOffenders(windowDays = 14, minCount = 2): Promise<RepeatOffender[]> {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - windowDays * DAY).toISOString()
  const { data, error } = await db.from('glitches')
    .select('id, unit, category, overview, status, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (error || !Array.isArray(data)) return []

  const buckets: Record<string, RepeatOffender> = {}
  for (const r of data as any[]) {
    const unit = String(r.unit || '').trim()
    const category = String(r.category || '').trim()
    if (!unit || !category) continue
    const key = unit.toLowerCase() + '||' + category.toLowerCase()
    const day = String(r.created_at || '').slice(0, 10)
    const closed = CLOSED.indexOf(String(r.status || '').toLowerCase()) >= 0
    if (!buckets[key]) {
      buckets[key] = {
        unit, building: buildingOf(null, unit), category,
        count: 0, firstSeen: day, lastSeen: day, closedBefore: 0,
        latestIssue: String(r.overview || category),
      }
    }
    const b = buckets[key]
    b.count++
    b.lastSeen = day
    if (closed) b.closedBefore++
    b.latestIssue = String(r.overview || b.latestIssue)
  }

  // A repeat is only interesting if an EARLIER one was closed — otherwise it is one open ticket
  // that someone commented on twice.
  return Object.keys(buckets)
    .map(k => buckets[k])
    .filter(b => b.count >= minCount && b.closedBefore >= 1)
    .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit))
}

// ── 2. Door codes ──────────────────────────────────────────────────────────────────────────────

// The standing per-listing access code, same Guesty custom field the day sheet and scheduler read.
const DOOR_CODE_FIELD = '695af1454ebbdc00137c3f41'

function codeOf(cf: any): string | null {
  const arr = Array.isArray(cf) ? cf : []
  for (const f of arr) {
    const id = f && (f.fieldId || f.field_id || (f.field && (f.field._id || f.field.id)) || f._id || f.id)
    if (String(id) === DOOR_CODE_FIELD) { const v = String((f && f.value) ?? '').trim(); return v || null }
  }
  return null
}

export type CodeProblem =
  | { kind: 'duplicate'; code: string; units: string[] }

/**
 * DUPLICATES ONLY, deliberately.
 *
 * The first version also reported "no door code on file" and immediately flagged 26 units — because
 * the Guesty listing field is simply not populated for most of the portfolio (3 of 15 arrivals had
 * one on the day this was checked). That is an empty column, not an operational problem, and
 * shipping it as an alert would have taught everyone to ignore the channel by lunchtime.
 *
 * Two live units sharing ONE code is unambiguous, and it really happened twice in the month of
 * history I read (Arya 1705/2 and Capri 116 both got 4519). That is worth saying.
 */
export async function findCodeProblems(lookaheadDays = 2): Promise<CodeProblem[]> {
  const db = supabaseAdmin()
  const today = ymdET(new Date())
  const until = addDays(today, Math.max(0, lookaheadDays))

  const [lRes, rRes] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,cf:raw->customFields'),
    db.from('guesty_reservations').select('listing_id,check_in,status').gte('check_in', today).lte('check_in', until).limit(2000),
  ])

  const listings: Record<string, { unit: string; code: string | null }> = {}
  for (const l of ((lRes.data || []) as any[])) {
    listings[String(l.id)] = { unit: String(l.nickname || l.title || 'Unit'), code: codeOf(l.cf) }
  }

  const arriving: Record<string, boolean> = {}
  for (const r of ((rRes.data || []) as any[])) {
    if (isLiveStay(r.status)) arriving[String(r.listing_id)] = true
  }

  const byCode: Record<string, string[]> = {}
  for (const id of Object.keys(arriving)) {
    const l = listings[id]
    if (!l || !l.code) continue
    if (!byCode[l.code]) byCode[l.code] = []
    byCode[l.code].push(l.unit)
  }

  const out: CodeProblem[] = []
  for (const code of Object.keys(byCode)) {
    const units = byCode[code]
    if (units.length > 1) out.push({ kind: 'duplicate', code, units: units.sort() })
  }
  return out
}

// ── 3. Someone arriving into a blocked unit ────────────────────────────────────────────────────

export type BlockedArrival = {
  unit: string
  building: string | null
  market: string | null
  checkIn: string
  daysAway: number
  blockedFrom: string
  blockedTo: string
  openEnded: boolean
  reason: string
}

/**
 * Cross-check out-of-service units against confirmed arrivals. Uses `runs` and NOT `linkedRuns`:
 * a linked run is a sibling unit auto-blocked because the other half sold, which is normal and
 * would drown the real signal.
 */
export async function findBlockedArrivals(lookaheadDays = 5): Promise<BlockedArrival[]> {
  const today = ymdET(new Date())
  const until = addDays(today, Math.max(1, lookaheadDays))

  let report: Awaited<ReturnType<typeof blockedUnits>>
  try { report = await blockedUnits(Math.max(7, lookaheadDays)) } catch { return [] }
  // An OWNER STAY block with a reservation arriving is almost always the owner's own stay — not a
  // guest walking into a dead unit. Flagged 17WEST 407 on the first live run, which is exactly the
  // kind of false positive that teaches people to ignore the alert. Keys 'o'/'ow' = Owner stay.
  const OWNER_KEYS = ['o', 'ow']
  const runs: BlockedRun[] = (Array.isArray(report.runs) ? report.runs : []).filter(r => {
    const keys = (Array.isArray(r.keys) ? r.keys : []).map(k => String(k).toLowerCase())
    if (keys.length && keys.every(k => OWNER_KEYS.indexOf(k) >= 0)) return false
    return true
  })
  if (!runs.length) return []

  const db = supabaseAdmin()
  const { data } = await db.from('guesty_reservations')
    .select('listing_id,check_in,status')
    .gte('check_in', today).lte('check_in', until).limit(2000)

  const byListing: Record<string, string[]> = {}
  for (const r of ((data || []) as any[])) {
    if (!isLiveStay(r.status)) continue
    const id = String(r.listing_id)
    if (!byListing[id]) byListing[id] = []
    byListing[id].push(String(r.check_in))
  }

  const out: BlockedArrival[] = []
  for (const run of runs) {
    const arrivals = byListing[String(run.listingId)] || []
    for (const ci of arrivals) {
      // does the arrival land inside the out-of-service window?
      if (ci < run.from) continue
      if (!run.openEnded && ci > run.to) continue
      const daysAway = Math.round((Date.parse(ci + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY)
      out.push({
        unit: run.unit,
        building: run.building || buildingOf(null, run.unit),
        market: run.market || null,
        checkIn: ci,
        daysAway,
        blockedFrom: run.from,
        blockedTo: run.to,
        openEnded: !!run.openEnded,
        reason: run.reason || 'out of service',
      })
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.unit.localeCompare(b.unit))
}

// ── 4. Top priorities per market ───────────────────────────────────────────────────────────────

export type NamedUnit = { unit: string; at: string | null; note?: string }

export type MarketPriority = {
  market: string
  cleans: number
  arrivals: number
  /** Every problem NAMES ITS UNITS. A count with no unit name cannot be acted on. */
  blocked: NamedUnit[]
  lateWithArrival: NamedUnit[]
  lateNoArrival: NamedUnit[]
  unassigned: NamedUnit[]
  overdue: NamedUnit[]
}

/** Always report every market, even the quiet ones — a missing market reads as a broken report. */
const ALL_MARKETS = ['Miami', 'Broward', 'North']

/**
 * Jon: "short and to the point, top priorities per market." The first version obeyed the "short"
 * half and failed the rest — it posted *"1 guest booked into a unit that is out of service"* with
 * no unit, no time and no name, which nobody can act on. Jon: "so bad… no clarity or detail."
 *
 * The bar is the humans in that channel. Hasan writes: "The 1418/2 guest denied PTE. He is saying
 * he does not want anyone to enter the unit and we can take care of it on Friday when they check
 * out." Unit, problem, reason, plan. So every line here names the unit and the time.
 */
export async function marketPriorities(): Promise<MarketPriority[]> {
  const today = ymdET(new Date())
  const db = supabaseAdmin()

  let sheet: any = null
  try {
    const mod = await import('./daysheet')
    sheet = await mod.buildDaySheet(today)
  } catch { /* shape is a nice-to-have; the problems below are the point */ }

  const [behind, glitchRes, blockedArrivals] = await Promise.all([
    loadBehind().catch(() => null),
    db.from('glitches').select('unit, overview, category, due_date, status')
      .not('status', 'in', '("' + CLOSED.join('","') + '")').limit(500),
    findBlockedArrivals(1).catch(() => [] as BlockedArrival[]),
  ])

  const markets: Record<string, MarketPriority> = {}
  const bucket = (m: string): MarketPriority => {
    if (!markets[m]) {
      markets[m] = { market: m, cleans: 0, arrivals: 0, blocked: [], lateWithArrival: [], lateNoArrival: [], unassigned: [], overdue: [] }
    }
    return markets[m]
  }
  for (const m of ALL_MARKETS) bucket(m)

  const marketFor = (unit: string, known?: string | null): string => {
    if (known && ALL_MARKETS.indexOf(known) >= 0) return known
    const b = buildingOf(null, unit)
    try { return marketOf(b, null, unit) as Market } catch { return 'Miami' }
  }

  // Day shape, so the numbers give the problems some context.
  if (sheet && sheet.ok) {
    for (const w of (sheet.work || [])) bucket(marketFor(String(w.unit || ''), w.market)).cleans++
    for (const a of (sheet.arrivals || [])) bucket(marketFor(String(a.unit || ''), a.market)).arrivals++
  }

  if (behind) {
    for (const u of behind.units) {
      const m = bucket(marketFor(u.unit, u.market || null))
      if (u.arrivingAt) m.lateWithArrival.push({ unit: u.unit, at: u.arrivingAt })
      else m.lateNoArrival.push({ unit: u.unit, at: null })
      if (!u.assignee) m.unassigned.push({ unit: u.unit, at: u.arrivingAt })
    }
  }

  for (const g of ((glitchRes.data || []) as any[])) {
    const unit = String(g.unit || '')
    if (!unit) continue
    if (!g.due_date || String(g.due_date) >= today) continue
    const issue = String(g.overview || g.category || 'open issue').replace(/\s+/g, ' ').trim()
    bucket(marketFor(unit)).overdue.push({ unit, at: null, note: issue.slice(0, 80) })
  }

  for (const b of blockedArrivals) {
    bucket(marketFor(b.unit, b.market)).blocked.push({
      unit: b.unit,
      at: b.checkIn === today ? 'today' : b.checkIn,
      note: b.reason,
    })
  }

  return ALL_MARKETS.map(m => markets[m]).filter(Boolean)
}

// ── 5. Tomorrow, per supervisor — the raw material for the handover ────────────────────────────

export type HandoverArea = {
  area: string
  cleans: number
  arrivals: number
  departures: number
  sameDayTurns: number
  unitsWithArrival: { unit: string; at: string | null }[]
  openIssues: number
}

/**
 * What Karla writes by hand every night. Built from the day sheet for TOMORROW so the numbers are
 * the same ones the board will show in the morning.
 */
export async function tomorrowByArea(): Promise<{ date: string; areas: HandoverArea[] }> {
  const tomorrow = addDays(ymdET(new Date()), 1)
  let sheet: any = null
  try {
    const mod = await import('./daysheet')
    sheet = await mod.buildDaySheet(tomorrow)
  } catch { return { date: tomorrow, areas: [] } }
  if (!sheet || !sheet.ok) return { date: tomorrow, areas: [] }

  const areas: Record<string, HandoverArea> = {}
  const get = (label: string): HandoverArea => {
    if (!areas[label]) {
      areas[label] = { area: label, cleans: 0, arrivals: 0, departures: 0, sameDayTurns: 0, unitsWithArrival: [], openIssues: 0 }
    }
    return areas[label]
  }
  const labelFor = (unit: string, building: any): string => buildingOf(building || null, unit) || 'Unassigned'

  for (const w of (sheet.work || [])) get(labelFor(String(w.unit || ''), null)).cleans++
  for (const a of (sheet.arrivals || [])) {
    const g = get(labelFor(String(a.unit || ''), a.building))
    g.arrivals++
    g.unitsWithArrival.push({ unit: String(a.unit || ''), at: a.checkInTime || null })
  }
  for (const d of (sheet.departures || [])) get(labelFor(String(d.unit || ''), d.building)).departures++
  for (const gl of (sheet.glitches || [])) get(labelFor(String(gl.unit || ''), null)).openIssues++

  // A same-day turn is a unit that both departs and arrives — the tightest thing on the board.
  const arriving: Record<string, boolean> = {}
  for (const a of (sheet.arrivals || [])) arriving[String(a.unit || '')] = true
  for (const d of (sheet.departures || [])) {
    if (arriving[String(d.unit || '')]) get(labelFor(String(d.unit || ''), d.building)).sameDayTurns++
  }

  return {
    date: tomorrow,
    areas: Object.keys(areas).map(k => areas[k]).sort((a, b) => a.area.localeCompare(b.area)),
  }
}

// ── 6. WALK-IN RISK — the thing that must never wait ───────────────────────────────────────────
//
// Jon, 2026-08-19: "Anything that it catches throughout the day that might be urgent or to prevent
// a walkin, it should state."
//
// A walk-in here is the failure that actually costs money and reviews: a guest turns up and cannot
// stay — the unit is out of service, or it has not been cleaned, or they cannot get through the
// door. Every one of those is knowable HOURS in advance, and every one of them was being caught by
// hand: "We have a reservation in 512... the unit is not ready. Should we just cancel?"
//
// So this runs on every pass, looks only at TODAY's arrivals, and asks one question per unit: is
// there anything that stops this guest getting in tonight?

export type WalkInRisk = {
  unit: string
  building: string | null
  market: string | null
  /** local check-in time if we know it, else null */
  at: string | null
  /** what will stop them, most severe first */
  problems: string[]
  /** true when nobody is even assigned to the clean */
  unassigned: boolean
}

export async function findWalkInRisks(): Promise<WalkInRisk[]> {
  const today = ymdET(new Date())
  const db = supabaseAdmin()

  const [behind, blocked, codes, arrRes, lRes] = await Promise.all([
    loadBehind().catch(() => null),
    findBlockedArrivals(1).catch(() => [] as BlockedArrival[]),
    findCodeProblems(0).catch(() => [] as CodeProblem[]),
    db.from('guesty_reservations').select('listing_id,check_in,status').eq('check_in', today).limit(1000),
    db.from('guesty_listings').select('id,nickname,title,checkIn:raw->>defaultCheckInTime'),
  ])

  // unit name -> arrival time, for everyone arriving today
  const nameById: Record<string, { unit: string; at: string | null }> = {}
  for (const l of ((lRes.data || []) as any[])) {
    nameById[String(l.id)] = { unit: String(l.nickname || l.title || 'Unit'), at: l.checkIn ? String(l.checkIn) : null }
  }
  const arrivingToday: Record<string, string | null> = {}
  for (const r of ((arrRes.data || []) as any[])) {
    if (!isLiveStay(r.status)) continue
    const l = nameById[String(r.listing_id)]
    if (l) arrivingToday[l.unit] = l.at
  }

  const risks: Record<string, WalkInRisk> = {}
  const add = (unit: string, at: string | null, problem: string, unassigned?: boolean) => {
    if (!unit) return
    if (!risks[unit]) {
      risks[unit] = {
        unit, building: buildingOf(null, unit), market: null,
        at: at || arrivingToday[unit] || null, problems: [], unassigned: false,
      }
    }
    if (risks[unit].problems.indexOf(problem) < 0) risks[unit].problems.push(problem)
    if (unassigned) risks[unit].unassigned = true
    if (!risks[unit].at && at) risks[unit].at = at
  }

  // 1. Out of service with someone arriving today — the worst one, they simply cannot stay.
  for (const b of blocked) {
    if (b.checkIn !== today) continue
    add(b.unit, null, 'unit is out of service (' + b.reason + ')')
    if (b.market) risks[b.unit].market = b.market
  }

  // 2. Clean not started and a guest is coming today.
  if (behind) {
    for (const u of behind.units) {
      if (!u.arrivingAt) continue
      add(u.unit, u.arrivingAt, u.assignee ? 'clean not started yet' : 'clean not started and nobody assigned', !u.assignee)
      if (u.market) risks[u.unit].market = u.market
    }
  }

  // 3. Two arriving units sharing one code — the wrong guest can open the wrong door.
  //    NOT "no code on file": that field is unpopulated for most of the portfolio, so it would
  //    flag two dozen units a day and mean nothing. See findCodeProblems.
  for (const c of codes) {
    for (const unit of c.units) {
      if (arrivingToday[unit] === undefined) continue
      add(unit, null, 'door code `' + c.code + '` is also on ' + c.units.filter(u => u !== unit).join(', '))
    }
  }

  // Sort by arrival time so the tightest one reads first.
  return Object.keys(risks).map(k => risks[k]).sort((a, b) => {
    const ta = a.at || '99:99', tb = b.at || '99:99'
    return ta.localeCompare(tb) || a.unit.localeCompare(b.unit)
  })
}


// ── 7. THE 3PM CHECK — will these units be ready for 4pm? ──────────────────────────────────────
//
// Jon, 2026-08-19: "it should just be based on status cleans at 3pm to make sure units are ready
// at 4pm."
//
// This replaces the all-day "cleans running behind" nagging with the ONE moment that matters. At
// 3pm every arrival either has a finished clean or it does not, and there is still an hour to do
// something about it. Before 3pm it is noise; after 4pm it is too late.
//
// Read off the day sheet so it agrees exactly with the board the team is already looking at.

export type ReadinessUnit = {
  unit: string
  market: string | null
  /** local check-in time if known */
  at: string | null
  status: 'done' | 'in progress' | 'not started' | 'no clean scheduled'
  assignees: string[]
  startedAt: string | null
}

export type Readiness = { date: string; units: ReadinessUnit[] }

const timeET = (iso: any): string | null => {
  if (!iso) return null
  try {
    return new Date(String(iso)).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    })
  } catch { return null }
}

/**
 * Every unit that has to BE READY for 4pm today — and whether it is.
 *
 * The first version asked "every arrival today, is there a clean?" and produced nonsense: seven
 * Botanica units reported as "0 of 7 ready … 0 still to finish", and Elser 2811 flagged for having
 * no clean on the board when the guest was arriving for 42 nights into a unit cleaned days ago.
 *
 * A unit only needs a clean TODAY if somebody checked out today. So the set is:
 *   - units with a departure clean on the board today, and
 *   - units that turn over today (checkout + check-in) but have NO clean scheduled — the real alarm.
 * An arrival into a unit nobody left today is already clean and is not this alert's business.
 */
export async function checkReadiness(): Promise<Readiness> {
  const today = ymdET(new Date())
  let sheet: any = null
  try {
    const mod = await import('./daysheet')
    sheet = await mod.buildDaySheet(today)
  } catch { return { date: today, units: [] } }
  if (!sheet || !sheet.ok) return { date: today, units: [] }

  // clean status per unit — the departure clean is what gates readiness
  const cleanByUnit: Record<string, any> = {}
  for (const w of (sheet.work || [])) {
    const unit = String(w.unit || '')
    if (!unit) continue
    const dept = String(w.dept || '').toLowerCase()
    const name = String(w.name || '').toLowerCase()
    const isClean = dept.indexOf('housekeep') >= 0 || /clean|turnover/.test(name)
    if (!isClean) continue
    // keep the least-finished task: if anything is unstarted, the unit is not ready
    const prev = cleanByUnit[unit]
    const rank = (st: string) => (st === 'not started' ? 0 : st === 'in progress' ? 1 : 2)
    if (!prev || rank(String(w.status)) < rank(String(prev.status))) cleanByUnit[unit] = w
  }

  const departedToday: Record<string, boolean> = {}
  for (const d of (sheet.departures || [])) departedToday[String(d.unit || '')] = true

  const arrivalByUnit: Record<string, any> = {}
  for (const a of (sheet.arrivals || [])) arrivalByUnit[String(a.unit || '')] = a

  const units: ReadinessUnit[] = []
  const seen: Record<string, boolean> = {}
  const push = (unit: string, w: any) => {
    if (!unit || seen[unit]) return
    seen[unit] = true
    const a = arrivalByUnit[unit]
    units.push({
      unit,
      market: (a && a.market) || (w && w.market) || null,
      at: a ? (a.checkInTime || null) : null,
      status: w ? (String(w.status) as any) : 'no clean scheduled',
      assignees: w && Array.isArray(w.assignees) ? w.assignees.filter(Boolean) : [],
      startedAt: w ? timeET(w.startedAt) : null,
    })
  }

  // 1. everything with a clean on the board today
  for (const unit of Object.keys(cleanByUnit)) push(unit, cleanByUnit[unit])
  // 2. same-day turns with NO clean scheduled — the case worth shouting about
  for (const unit of Object.keys(arrivalByUnit)) {
    if (cleanByUnit[unit]) continue
    if (!departedToday[unit]) continue
    push(unit, null)
  }

  // worst first: not started, then a missing clean, then in progress, then done
  const rank = (u: ReadinessUnit) =>
    u.status === 'not started' ? 0 : u.status === 'no clean scheduled' ? 1 : u.status === 'in progress' ? 2 : 3
  units.sort((x, y) => rank(x) - rank(y) || String(x.at || '').localeCompare(String(y.at || '')))
  return { date: today, units }
}

// ── 8. HOURS — who is on the clock, who is not, who is over ────────────────────────────────────
//
// Jon, 2026-08-19: "sending a message in leadership chat sharing hours, not clocked in, over
// hours, ect."
//
// Three questions in one message: what has today cost so far, is anyone scheduled who never
// showed, and is anyone running long. Scheduled-vs-actual is matched with the same fuzzy name
// matcher the staffing check uses, because Homebase and Breezeway spell people differently.

export type LaborSnapshot = {
  date: string
  totalHours: number
  clockedInNow: { name: string; hours: number; since: string | null }[]
  overHours: { name: string; hours: number; since: string | null }[]
  notClockedIn: { name: string; shift: string }[]
  missedClockOut: { name: string; hours: number }[]
  complete: boolean
}

export async function laborSnapshot(overtimeHours = 9): Promise<LaborSnapshot> {
  const today = ymdET(new Date())
  const empty: LaborSnapshot = {
    date: today, totalHours: 0, clockedInNow: [], overHours: [],
    notClockedIn: [], missedClockOut: [], complete: false,
  }

  let cards: Awaited<ReturnType<typeof getTimecards>> = []
  let shifts: Awaited<ReturnType<typeof getShifts>> = []
  try {
    const [c, sh] = await Promise.all([
      getTimecards(today, today),
      getShifts(today).catch(() => [] as any[]),
    ])
    cards = c
    shifts = sh
  } catch { return empty }

  const todays = cards.filter(t => t.date === today)
  const totalHours = Math.round(todays.reduce((a, t) => a + (t.hours || 0), 0) * 10) / 10

  // "On the clock NOW" needs the date guard — t.open alone also matches a card someone forgot to
  // close weeks ago, which is the bug still live in /api/ops-today/staffing.
  const open = todays.filter(t => t.open)
  const clockedInNow = open.map(t => ({
    name: t.name, hours: Math.round((t.hours || 0) * 10) / 10, since: timeET(t.clockIn),
  })).sort((a, b) => b.hours - a.hours)

  const overHours = clockedInNow.filter(t => t.hours >= overtimeHours)

  // Scheduled today but no punch at all.
  const punched = todays.map(t => t.name).filter(Boolean)
  const notClockedIn: { name: string; shift: string }[] = []
  for (const sh of shifts) {
    if (sh.open) continue                     // an unfilled shift is a staffing gap, not a no-show
    const name = String(sh.name || '').trim()
    if (!name) continue
    const matched = punched.some(p => nameMatches(p, name)) || !!nameMatchesRoster(name, punched)
    if (!matched) notClockedIn.push({ name, shift: sh.label || '' })
  }

  // Clocked in yesterday and never closed — payroll noise, worth naming.
  const missedClockOut = cards
    .filter(t => t.open && t.date !== today)
    .map(t => ({ name: t.name, hours: Math.round((t.hours || 0) * 10) / 10 }))

  return {
    date: today, totalHours, clockedInNow, overHours, notClockedIn, missedClockOut,
    complete: todays.length > 0 || shifts.length > 0,
  }
}

// ── 9. OWNER STAYS & BIG BOOKINGS — a heads-up, not a task ─────────────────────────────────────
//
// Jon, 2026-08-19: "It should also send updates for owner stays, big bookings, etc."
//
// Both are the same shape of information: an upcoming arrival that deserves a different level of
// attention than a normal one. An owner walking into their own unit and a $6k two-week stay both
// go wrong in ways an ordinary turnover does not, and both are knowable days ahead.
//
// Owner detection matches the day sheet exactly (`/^owner/i` on the reservation source) so the two
// never disagree about who is an owner.

const OWNER_SRC = /^owner/i

export type NotableArrival = {
  unit: string
  building: string | null
  guest: string
  checkIn: string
  nights: number | null
  value: number | null
  source: string
  kind: 'owner' | 'big' | 'long'
  daysAway: number
}

export async function findNotableArrivals(opts?: {
  days?: number
  bigBookingUsd?: number
  longStayNights?: number
}): Promise<NotableArrival[]> {
  const days = Math.max(1, Math.min(30, opts?.days ?? 7))
  const bigUsd = Math.max(0, opts?.bigBookingUsd ?? 3000)
  const longNights = Math.max(2, opts?.longStayNights ?? 14)

  const today = ymdET(new Date())
  const until = addDays(today, days)
  const db = supabaseAdmin()

  const [rRes, lRes] = await Promise.all([
    db.from('guesty_reservations')
      .select('id,listing_id,guest_name,check_in,nights,status,source,money_total')
      .gte('check_in', today).lte('check_in', until)
      .order('check_in', { ascending: true }).limit(1500),
    db.from('guesty_listings').select('id,nickname,title'),
  ])

  const names: Record<string, string> = {}
  for (const l of ((lRes.data || []) as any[])) {
    names[String(l.id)] = String(l.nickname || l.title || 'Unit')
  }

  const out: NotableArrival[] = []
  for (const r of ((rRes.data || []) as any[])) {
    if (!isLiveStay(r.status)) continue
    const source = String(r.source || '')
    const nights = r.nights == null ? null : Number(r.nights)
    const value = r.money_total == null ? null : Number(r.money_total)

    let kind: NotableArrival['kind'] | null = null
    if (OWNER_SRC.test(source)) kind = 'owner'
    else if (value != null && value >= bigUsd) kind = 'big'
    else if (nights != null && nights >= longNights) kind = 'long'
    if (!kind) continue

    const unit = names[String(r.listing_id)] || 'Unit'
    const ci = String(r.check_in || '').slice(0, 10)
    out.push({
      unit,
      building: buildingOf(null, unit),
      guest: String(r.guest_name || 'Guest'),
      checkIn: ci,
      nights, value, source, kind,
      daysAway: Math.round((Date.parse(ci + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY),
    })
  }
  // owners first, then by how soon
  const rank = (k: NotableArrival['kind']) => (k === 'owner' ? 0 : k === 'big' ? 1 : 2)
  return out.sort((a, b) => rank(a.kind) - rank(b.kind) || a.daysAway - b.daysAway)
}
