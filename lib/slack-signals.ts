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
  | { kind: 'missing'; units: string[] }

/**
 * Two live units sharing one code is a real security and check-in problem, and it happened twice
 * in the month I read. A unit with a guest arriving and NO code on file is a 1am support call.
 *
 * Only considers units that actually matter today: someone arriving in the next `lookaheadDays`.
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
  const missing: string[] = []
  for (const id of Object.keys(arriving)) {
    const l = listings[id]
    if (!l) continue
    if (!l.code) { missing.push(l.unit); continue }
    if (!byCode[l.code]) byCode[l.code] = []
    byCode[l.code].push(l.unit)
  }

  const out: CodeProblem[] = []
  for (const code of Object.keys(byCode)) {
    const units = byCode[code]
    if (units.length > 1) out.push({ kind: 'duplicate', code, units: units.sort() })
  }
  if (missing.length) out.push({ kind: 'missing', units: missing.sort() })
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
  const runs: BlockedRun[] = Array.isArray(report.runs) ? report.runs : []
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

export type MarketPriority = {
  market: string
  lateCleans: number
  cleansWithArrival: number
  unassigned: number
  openIssues: number
  overdueIssues: number
  blockedWithArrival: number
  /** the two or three things actually worth naming, already phrased as priorities */
  headlines: string[]
}

/**
 * Jon: "should be short and to the point, top priorities per market." So this deliberately does
 * NOT return everything — it returns counts plus at most three headline lines per market, and a
 * market with nothing wrong says so in one line rather than printing zeros.
 */
export async function marketPriorities(): Promise<MarketPriority[]> {
  const today = ymdET(new Date())
  const db = supabaseAdmin()

  const [behind, glitchRes, blockedArrivals] = await Promise.all([
    loadBehind().catch(() => null),
    db.from('glitches').select('unit, due_date, status')
      .not('status', 'in', '("' + CLOSED.join('","') + '")').limit(500),
    findBlockedArrivals(3).catch(() => [] as BlockedArrival[]),
  ])

  const markets: Record<string, MarketPriority> = {}
  const bucket = (m: string): MarketPriority => {
    if (!markets[m]) {
      markets[m] = {
        market: m, lateCleans: 0, cleansWithArrival: 0, unassigned: 0,
        openIssues: 0, overdueIssues: 0, blockedWithArrival: 0, headlines: [],
      }
    }
    return markets[m]
  }
  const marketFor = (unit: string): string => {
    const b = buildingOf(null, unit)
    try { return marketOf(b, null, unit) as Market } catch { return 'Miami' }
  }

  if (behind) {
    for (const u of behind.units) {
      const m = bucket(u.market || marketFor(u.unit))
      m.lateCleans++
      if (u.arrivingAt) m.cleansWithArrival++
      if (!u.assignee) m.unassigned++
    }
  }
  for (const g of ((glitchRes.data || []) as any[])) {
    const unit = String(g.unit || '')
    if (!unit) continue
    const m = bucket(marketFor(unit))
    m.openIssues++
    if (g.due_date && String(g.due_date) < today) m.overdueIssues++
  }
  for (const b of blockedArrivals) {
    bucket(b.market || marketFor(b.unit)).blockedWithArrival++
  }

  // Headlines, most urgent first, capped at three so the brief stays short.
  for (const key of Object.keys(markets)) {
    const m = markets[key]
    const h: string[] = []
    if (m.blockedWithArrival) h.push('🚨 ' + m.blockedWithArrival + ' guest' + (m.blockedWithArrival === 1 ? '' : 's') + ' booked into a unit that is out of service')
    if (m.cleansWithArrival) h.push('⏰ ' + m.cleansWithArrival + ' clean' + (m.cleansWithArrival === 1 ? '' : 's') + ' with a guest arriving today')
    if (m.unassigned) h.push('👤 ' + m.unassigned + ' clean' + (m.unassigned === 1 ? '' : 's') + ' with nobody assigned')
    if (h.length < 3 && m.overdueIssues) h.push('🔧 ' + m.overdueIssues + ' issue' + (m.overdueIssues === 1 ? '' : 's') + ' past their date')
    m.headlines = h.slice(0, 3)
  }

  return Object.keys(markets).map(k => markets[k]).sort((a, b) => a.market.localeCompare(b.market))
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
