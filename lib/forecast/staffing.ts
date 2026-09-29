// THE 14-DAY STAFFING FORECAST — which days will be short, while there is still time to fix them.
//
// Jon's brief for the app: "make predictions, look into the future, schedule and operate the
// business better." Every morning surface already says who is on TODAY. None said, on Monday, that
// Thursday in Broward has eleven checkouts and two people.
//
// THE MODEL, ALL OF IT RULES AND RATIOS — no AI in the numbers:
//   1. BOOKED    confirmed checkouts on the books now, per market per day, one clean per unit per
//                day, vendor buildings out (their crews, their cost). North is vendor-run: out.
//                Same read as the labor planner (lib/labor-plan forwardCheckoutUnits).
//   2. EXPECTED  booked × the PICKUP learned for that lead time — how much a day's count grows
//                between N days out and the day itself, from the labor planner's daily snapshots.
//                1.0 until it has five samples at that lead, so a new install understates, never
//                invents.
//   3. MINUTES   each booked unit priced the way lib/capacity prices it on the board: the measured
//                clean minutes for its bedrooms in its market (60-minute floor), prep and wrap,
//                plus the day's route between those units (the capacity model's travel — assumed,
//                there is no GPS), plus Broward's separate strip task where the strips are timed
//                (measured over the last 28 days, never assumed). Averaged per clean, × expected.
//   4. NEEDED    ⌈minutes ÷ 414⌉ — 414 is an 8-hour shift less the 30-minute break and 8%
//                contingency, the same day the suggester fills.
//   5. ROSTERED  housekeepers Working or On Call that day: the Turnover Schedule roster's calls
//                over Homebase's shifts (lib/team-roster, the human always wins). A day past the
//                last date Homebase has published says "roster not out yet" — never "short" for
//                a schedule nobody has written.
//   VERDICT     short: needs more than rostered · over: two or more spare · ok · unknown · none.
//
// EVERY FORECAST IS GRADED. The EOD recap (8:15pm ET) records tomorrow's 14 days in the ledger
// (lib/forecast/ledger) and grades every day that has passed against the departure cleans that
// actually finished — so the strip can one day say how far to trust it.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '../supabase-admin'
import { pageRows } from '../db-page'
import { getOpsPresets } from '../app-settings'
import { vendorRegex } from '../ops-presets'
import { marketOf } from '../segments'
import { isDepartureCleanName } from '../breezeway'
import { isTaskDone, isTaskGone } from '../task-categories'
import { cleanMinutes, cleanTableFor, routeStops, PERFORMED_FLOOR_MIN, UNIT_OVERHEAD, type Stop } from '../capacity'
import { DEFAULT_CAPACITY_MIN } from '../schedule-suggest'
import { forwardCheckoutUnits, pickupFactors, type CheckoutUnit } from '../labor-plan'
import { weekRoster, type WeekRoster } from '../team-roster'
import { recordPredictions, ungradedBefore, gradePredictions, type PredictionInput } from './ledger'

/** The in-house markets. North is cleaned by a vendor company — not our roster, not our forecast. */
export const FORECAST_MARKETS = ['Miami', 'Broward'] as const
/** One person-day, in minutes: 8h less the 30-minute break and 8% contingency (lib/schedule-suggest). */
export const PERSON_DAY_MIN = DEFAULT_CAPACITY_MIN

export type StaffVerdict = 'short' | 'ok' | 'over' | 'unknown' | 'none'
export type StaffDay = {
  date: string
  /** "Thu Oct 2" */
  label: string
  /** "Thu" */
  dow: string
  /** Days from today (0 = today). */
  lead: number
  market: string
  /** Confirmed checkouts on the books now. */
  booked: number
  /** The learned pickup factor applied at this lead (1 = none yet). */
  pickup: number
  /** booked × pickup, one decimal. */
  expected: number
  /** Priced minutes per clean (clean + prep/wrap + route + strips); null with nothing booked. */
  minutesPerClean: number | null
  minutes: number
  /** ⌈minutes ÷ 414⌉ on the expected cleans. */
  needed: number
  /** The same on what is booked alone — the floor, before any pickup. */
  neededBooked: number
  working: number
  onCall: number
  rostered: number
  /** False past the last day Homebase has published — the roster is not written yet. */
  rosterKnown: boolean
  /** On-call people it takes to cover the day when those Working are not enough (0 = none). */
  callIn: number
  verdict: StaffVerdict
  /** "Thu Oct 2 · Broward · 11 checkouts · needs 3 · 2 rostered — short" */
  line: string
}
export type StripRate = { perCheckout: number; minutes: number; timed: number }
export type StaffingForecast = {
  ok: true
  generatedAt: string
  today: string
  from: string
  to: string
  markets: string[]
  capacityMin: number
  /** Every market × day, date order. */
  days: StaffDay[]
  /** Just the short days, soonest first. */
  short: StaffDay[]
  pickup: { learning: boolean; samples: number[] }
  /** Broward's strip stop, per checkout, where it is measured. */
  strips: Record<string, StripRate | null>
  rosterPublishedThrough: string | null
  /** One line on what the numbers are based on — for a tooltip or a footnote. */
  basis: string
  /** Reads that came back short or failed; the numbers above are floors when this is not empty. */
  notes: string[]
}

const TZ = 'America/New_York'
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (ymd: string, n: number) => ymdET(new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000))
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
const sunOf = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10) }
const round1 = (n: number) => Math.round(n * 10) / 10
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const labelOf = (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ymd + 'T12:00:00Z')).replace(',', '')
const dowOf = (ymd: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(ymd + 'T12:00:00Z'))
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

export const STAFFING_BASIS = 'Confirmed checkouts on the books × the booking pickup learned by lead time, priced at the measured clean minutes by bedrooms and market plus prep, wrap and the day\'s route (travel assumed — no GPS), ÷ 414 minutes per person-day; rostered = housekeepers (not supervisors) Working or On Call on the Turnover Schedule roster over Homebase shifts. Vendor buildings and North are out.'

// ── listings → market / vendor, shared by the strip rate and the grader ──────────────────────────
type ListingMeta = Record<string, { market: string; vendor: boolean }>
async function listingMetaRead(): Promise<{ meta: ListingMeta; truncated: boolean }> {
  const VENDOR = vendorRegex((await getOpsPresets()).vendorBuildings)
  const { rows, truncated } = await pageRows<any>((a, b) => supabaseAdmin().from('guesty_listings')
    .select('id,nickname,title,building,address_city').order('id').range(a, b), 4)
  const out: ListingMeta = {}
  for (const l of rows) {
    const name = str(l.nickname || l.title) || 'Unit'
    const building = str(l.building)
    out[str(l.id)] = { market: String(marketOf(building, l.address_city, name) || 'Miami'), vendor: VENDOR.test(building) || VENDOR.test(name) }
  }
  return { meta: out, truncated }
}
async function listingMeta(): Promise<ListingMeta> { return (await listingMetaRead()).meta }

/** A standard clean in a market — mid-size, floor, prep and wrap, no route — for a day nothing priced. */
function standardPerClean(market: string): number {
  return Math.max(PERFORMED_FLOOR_MIN, cleanMinutes(null, cleanTableFor(market))) + UNIT_OVERHEAD.prepMin + UNIT_OVERHEAD.wrapMin
}

/** Departure cleans and strips scheduled in [from, to] — one read for the strip rate and the grader. */
async function cleanTasks(from: string, to: string): Promise<{ rows: any[]; truncated: boolean }> {
  return pageRows<any>((a, b) => supabaseAdmin().from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,finished_at,total_minutes,assignees')
    .gte('scheduled_date', from).lte('scheduled_date', to)
    .or('name.ilike.%clean%,name.ilike.%limpieza%,name.ilike.%strip%')
    .order('scheduled_date').order('id').range(a, b), 10)
}

/**
 * BROWARD'S STRIP, MEASURED (lib/capacity: the linen work is a separate "Strip & Walkthrough" task
 * outside the clean's timer). Per market over the last 28 days: strips per departure clean × the
 * median timed strip. Needs five timed strips to count — otherwise 0 and the note says so, rather
 * than inventing a number for a task nobody has timed.
 */
function stripRates(rows: any[], meta: Record<string, { market: string; vendor: boolean }>): Record<string, StripRate | null> {
  const acc: Record<string, { cleans: number; strips: number; timed: number[] }> = {}
  for (const t of rows) {
    const m = meta[str(t.reference_property_id)]
    if (!m || m.vendor || isTaskGone(t.status)) continue
    const a = (acc[m.market] = acc[m.market] || { cleans: 0, strips: 0, timed: [] })
    const nm = str(t.name)
    if (isDepartureCleanName(nm)) { a.cleans++; continue }
    if (!/\bstrip/i.test(nm)) continue
    a.strips++
    const mins = Number(t.total_minutes)
    if (isTaskDone(t.status, t.finished_at) && Number.isFinite(mins) && mins >= 10 && mins <= 180) a.timed.push(mins)
  }
  const out: Record<string, StripRate | null> = {}
  for (const mk of FORECAST_MARKETS) {
    const a = acc[mk]
    out[mk] = a && a.cleans > 0 && a.strips > 0 && a.timed.length >= 5
      ? { perCheckout: Math.round(Math.min(1.5, a.strips / a.cleans) * 100) / 100, minutes: Math.round(median(a.timed)), timed: a.timed.length }
      : null
  }
  return out
}

// ── the roster, 14 days of it ─────────────────────────────────────────────────────────────────────
type RosterDay = { working: number; onCall: number }
async function rosterWindow(from: string, to: string, notes: string[]): Promise<{ byKey: Record<string, RosterDay>; publishedThrough: string | null }> {
  const weeks: string[] = []
  for (let w = sunOf(from); w <= to; w = shift(w, 7)) weeks.push(w)
  const docs: Record<string, any> = {}
  const { data, error } = await supabaseAdmin().from('team_schedule').select('week_start,market,doc')
    .in('week_start', weeks).in('market', FORECAST_MARKETS as unknown as string[]).limit(60)
  if (error) notes.push('roster overrides could not be read — Homebase shifts only')
  for (const r of ((data || []) as any[])) docs[str(r.week_start).slice(0, 10) + '|' + str(r.market)] = r.doc || null
  const byKey: Record<string, RosterDay> = {}
  let publishedThrough: string | null = null
  // WHO COUNTS AS A HOUSEKEEPER. A name somebody listed on the market's Turnover Schedule tab is on
  // the cleaning roster by construction, unless their crew record says otherwise; somebody Homebase
  // placed in the market by their staff area counts only when their crew or shift role is cleaning.
  // Supervisors are left out on purpose — they clean only when nobody else can.
  const isHk = (p: { dept: string; manual: boolean }, role: string | null) =>
    p.dept === 'housekeeping'
    || (p.manual ? !/maintenance|supervision|ccs|inspection/.test(p.dept) : (p.dept === 'other' && /clean|housekeep|\bhk\b|turnover/i.test(str(role))))
  // Sequential by week and market: the second market's Homebase days come out of getShifts' cache.
  for (const w of weeks) {
    for (const mk of FORECAST_MARKETS) {
      let r: WeekRoster | null = null
      try { r = await weekRoster(w, mk, docs[w + '|' + mk] || null) } catch (e: any) { notes.push(`${mk} roster for the week of ${w} could not be built`) }
      if (!r) continue
      if (!r.homebaseOk) notes.push(`Homebase did not answer for the week of ${w} — roster overrides only`)
      for (const d of r.dates) {
        if (d < from || d > to) continue
        const k = mk + '|' + d
        const acc = (byKey[k] = byKey[k] || { working: 0, onCall: 0 })
        for (const p of r.people) {
          const cell = p.days[d]
          if (!cell) continue
          if (cell.shift && (!publishedThrough || d > publishedThrough)) publishedThrough = d
          if (!isHk(p, cell.role)) continue
          if (cell.status === 'Working') acc.working++
          else if (cell.status === 'On Call') acc.onCall++
        }
      }
      for (const u of r.unplaced) for (const d of u.dates) if (d >= from && d <= to && (!publishedThrough || d > publishedThrough)) publishedThrough = d
    }
  }
  return { byKey, publishedThrough }
}

// ── one market-day, priced ────────────────────────────────────────────────────────────────────────
function priceDay(units: CheckoutUnit[], market: string, strip: StripRate | null): number | null {
  if (!units.length) return null
  const table = cleanTableFor(market)
  const work = units.reduce((a, u) => a + Math.max(PERFORMED_FLOOR_MIN, cleanMinutes(u.bedrooms, table)) + UNIT_OVERHEAD.prepMin + UNIT_OVERHEAD.wrapMin, 0)
  const stops: Stop[] = units.map(u => ({ id: u.listingId, unit: u.name, building: u.building, lat: u.lat, lng: u.lng, bedrooms: u.bedrooms, market }))
  const travel = routeStops(stops).travelMinutes
  const perClean = (work + travel) / units.length + (strip ? strip.perCheckout * strip.minutes : 0)
  return Math.round(perClean)
}

function lineOf(d: Omit<StaffDay, 'line'>): string {
  if (d.verdict === 'none') return `${d.label} · ${d.market} · nothing booked yet`
  const co = d.pickup > 1.001 && d.lead > 0
    ? `${d.booked} checkout${d.booked === 1 ? '' : 's'} (~${Math.round(d.expected)} with pickup)`
    : `${d.booked} checkout${d.booked === 1 ? '' : 's'}`
  if (d.verdict === 'unknown') return `${d.label} · ${d.market} · ${co} · needs ${d.needed} — roster not out yet`
  const ros = `${d.rostered} rostered${d.onCall ? ` (${d.onCall} on call)` : ''}`
  const tail = d.verdict === 'short' ? 'short' : d.verdict === 'over' ? 'over' : d.callIn ? `ok if ${d.callIn} on call ${d.callIn === 1 ? 'comes' : 'come'} in` : 'ok'
  return `${d.label} · ${d.market} · ${co} · needs ${d.needed} · ${ros} — ${tail}`
}

async function compute(from: string, days: number): Promise<StaffingForecast> {
  const today = ymdET()
  const to = shift(from, days - 1)
  const notes: string[] = []
  const [units, pk, meta, roster] = await Promise.all([
    forwardCheckoutUnits(from, to),
    pickupFactors().catch(() => ({ factors: [1], samples: [0] })),
    listingMeta().catch(() => ({} as Record<string, { market: string; vendor: boolean }>)),
    rosterWindow(from, to, notes),
  ])
  const stripRead = await cleanTasks(shift(today, -28), shift(today, -1)).catch(() => ({ rows: [] as any[], truncated: true }))
  if (stripRead.truncated) notes.push('strip history read stopped early — strips may be under-priced')
  const strips = stripRates(stripRead.rows, meta)
  const byKey: Record<string, CheckoutUnit[]> = {}
  for (const u of units) { const k = u.market + '|' + u.date; (byKey[k] = byKey[k] || []).push(u) }

  const out: StaffDay[] = []
  for (let i = 0; i < days; i++) {
    const date = shift(from, i)
    const lead = Math.max(0, daysBetween(today, date))
    const factor = Number(pk.factors[Math.min(lead, pk.factors.length - 1)]) || 1
    for (const market of FORECAST_MARKETS) {
      const mine = byKey[market + '|' + date] || []
      const booked = mine.length
      const perClean = priceDay(mine, market, strips[market] || null)
      const expected = round1(booked * factor)
      const minutes = perClean != null ? Math.round(expected * perClean) : 0
      const needed = minutes > 0 ? Math.ceil(minutes / PERSON_DAY_MIN) : 0
      const neededBooked = perClean != null && booked ? Math.ceil((booked * perClean) / PERSON_DAY_MIN) : 0
      const r = roster.byKey[market + '|' + date] || { working: 0, onCall: 0 }
      const rostered = r.working + r.onCall
      const rosterKnown = !!roster.publishedThrough && date <= roster.publishedThrough
      const verdict: StaffVerdict = !booked ? 'none'
        : !rosterKnown ? 'unknown'
          : needed > rostered ? 'short'
            : rostered >= needed + 2 ? 'over' : 'ok'
      const callIn = verdict === 'ok' && needed > r.working ? needed - r.working : 0
      const base = {
        date, label: labelOf(date), dow: dowOf(date), lead, market, booked, pickup: factor, expected,
        minutesPerClean: perClean, minutes, needed, neededBooked, working: r.working, onCall: r.onCall, rostered,
        rosterKnown, callIn, verdict,
      }
      out.push({ ...base, line: lineOf(base) })
    }
  }
  if (!roster.publishedThrough) notes.push('Homebase has no shifts published in this window — every day reads "roster not out yet"')
  const strip = strips.Broward
  return {
    ok: true, generatedAt: new Date().toISOString(), today, from, to,
    markets: FORECAST_MARKETS.slice(), capacityMin: PERSON_DAY_MIN,
    days: out,
    short: out.filter(d => d.verdict === 'short'),
    pickup: { learning: pk.samples.slice(1).every(n => n < 5), samples: pk.samples },
    strips,
    rosterPublishedThrough: roster.publishedThrough,
    basis: STAFFING_BASIS + (strip ? ` Broward strips: ${strip.perCheckout} per checkout × ${strip.minutes} min (median of ${strip.timed} timed, 28 days).` : ' Strips are not priced (too few timed strips to measure).'),
    notes,
  }
}

const cached = unstable_cache(compute, ['forecast-staffing-v1'], { revalidate: 600, tags: ['forecast'] })

/**
 * The forecast from `from` (default today, ET) for `days` days (default 14, at most 21), cached ten
 * minutes. `fresh` skips the cache — the nightly ledger snapshot uses it.
 */
export async function buildStaffingForecast(opts: { from?: string; days?: number; fresh?: boolean } = {}): Promise<StaffingForecast> {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(opts.from)) ? str(opts.from) : ymdET()
  const days = Math.max(1, Math.min(21, Math.round(Number(opts.days) || 14)))
  return opts.fresh ? compute(from, days) : cached(from, days)
}

/** The forecast for one date, one line per market — "tomorrow" in the EOD recap. */
export function linesFor(fc: StaffingForecast, date: string): string[] {
  return fc.days.filter(d => d.date === date).map(d => d.line)
}

// ── the ledger ────────────────────────────────────────────────────────────────────────────────────

/**
 * RECORD TONIGHT'S FORECAST: tomorrow and the thirteen days after it, per market, as two kinds —
 * 'cleans' (expected; low = booked) and 'people_needed' (needed; low = on the books alone). Pass
 * the forecast when the caller already built it; it must start tomorrow to be a forecast at all.
 */
export async function snapshotForecasts(opts: { forecast?: StaffingForecast } = {}): Promise<{ ok: boolean; written: number; missing?: boolean; error?: string }> {
  const today = ymdET()
  const fc = opts.forecast && opts.forecast.from > today ? opts.forecast : await buildStaffingForecast({ from: shift(today, 1), days: 14, fresh: true })
  const rows: PredictionInput[] = []
  for (const d of fc.days) {
    if (d.date <= today) continue
    const meta = {
      booked: d.booked, pickup: d.pickup, minutesPerClean: d.minutesPerClean, working: d.working, onCall: d.onCall,
      rostered: d.rostered, rosterKnown: d.rosterKnown, verdict: d.verdict, capacityMin: fc.capacityMin, model: 'staffing-v1',
    }
    rows.push({ kind: 'cleans', subject: d.market, madeOn: today, forDate: d.date, predicted: d.expected, low: d.booked, meta })
    rows.push({ kind: 'people_needed', subject: d.market, madeOn: today, forDate: d.date, predicted: d.needed, low: d.neededBooked, meta })
  }
  return recordPredictions(rows)
}

/**
 * GRADE WHAT HAS HAPPENED: every ungraded 'cleans' / 'people_needed' forecast for a day before
 * today (ET, last 30 days) against the departure cleans that day actually finished.
 *   cleans         actual = departure cleans finished for that market and day (one per unit)
 *   people_needed  actual = the people on those finished cleans (their assignees) — how many it
 *                  really took (2026-09-29 review, nb-6). A day with cleans but no names on them
 *                  cannot say, so that kind is left ungraded. The need the day implied on the
 *                  forecast's own yardstick (⌈cleans × minutes per clean ÷ 414⌉, the standard
 *                  minutes per clean when the forecast priced nothing) is kept in meta.impliedNeed.
 * A day on which the task mirror shows NO in-house departure clean at all is almost always a sync
 * gap, not a quiet day: it is left ungraded for a week before being graded as it stands. Nothing is
 * graded from a short read — a day cut off mid-read would be graded low for good.
 */
export async function gradeForecasts(opts: { today?: string } = {}): Promise<{ ok: boolean; graded: number; held: number; skipped?: number; missing?: boolean; error?: string }> {
  const today = opts.today || ymdET()
  const open = await ungradedBefore(today, ['cleans', 'people_needed'], { sinceDays: 30 })
  if (!open.ok) return { ok: false, graded: 0, held: 0, missing: open.missing, error: open.error }
  if (!open.rows.length) return { ok: true, graded: 0, held: 0 }
  const dates = Array.from(new Set(open.rows.map(r => str(r.for_date).slice(0, 10)))).sort()
  const [lm, read] = await Promise.all([listingMetaRead(), cleanTasks(dates[0], dates[dates.length - 1])])
  if (read.truncated) return { ok: false, graded: 0, held: open.rows.length, error: 'the finished-cleans read came back short — nothing graded, the next run tries again' }
  if (lm.truncated) return { ok: false, graded: 0, held: open.rows.length, error: 'the listings read came back short — nothing graded, the next run tries again' }
  const meta = lm.meta
  // market|date → finished cleans (one per unit) and the people on them
  const acc: Record<string, { units: Record<string, true>; people: Record<string, true> }> = {}
  const dayTotal: Record<string, number> = {}
  for (const t of read.rows) {
    if (!isDepartureCleanName(t.name) || isTaskGone(t.status) || !isTaskDone(t.status, t.finished_at)) continue
    const m = meta[str(t.reference_property_id)]
    if (!m || m.vendor) continue
    const date = str(t.scheduled_date).slice(0, 10)
    const k = m.market + '|' + date
    const a = (acc[k] = acc[k] || { units: {}, people: {} })
    if (!a.units[str(t.reference_property_id)]) { a.units[str(t.reference_property_id)] = true; dayTotal[date] = (dayTotal[date] || 0) + 1 }
    for (const p of (Array.isArray(t.assignees) ? t.assignees : [])) {
      const n = str(p && typeof p === 'object' ? p.name : p).replace(/\s+/g, ' ').trim().toLowerCase()
      if (n) a.people[n] = true
    }
  }
  const grades: { id: number; predicted: number; actual: number; meta?: Record<string, any> }[] = []
  let held = 0
  let skipped = 0
  for (const r of open.rows) {
    const date = str(r.for_date).slice(0, 10)
    if (!dayTotal[date] && daysBetween(date, today) < 7) { held++; continue }
    const a = acc[str(r.subject) + '|' + date]
    const cleans = a ? Object.keys(a.units).length : 0
    const people = a ? Object.keys(a.people).length : 0
    if (r.kind === 'cleans') {
      grades.push({ id: r.id, predicted: Number(r.predicted), actual: cleans })
    } else {
      if (cleans > 0 && people === 0) { skipped++; continue }
      // A forecast made for a day with nothing booked priced nothing (minutesPerClean null): the
      // standard clean for the market is the yardstick, not zero.
      const mpc = Number(r.meta && r.meta.minutesPerClean) || standardPerClean(str(r.subject))
      const impliedNeed = cleans > 0 ? Math.ceil((cleans * mpc) / (Number(r.meta && r.meta.capacityMin) || PERSON_DAY_MIN)) : 0
      grades.push({ id: r.id, predicted: Number(r.predicted), actual: people, meta: { ...(r.meta || {}), actualCleans: cleans, peopleWorked: people, impliedNeed } })
    }
  }
  const g = await gradePredictions(grades)
  return { ok: g.ok, graded: g.written, held, skipped: skipped || undefined, missing: g.missing, error: g.error }
}
