// lib/labor-plan.ts — MARGIN-FIRST STAFFING PLANNER.
//
// Jon, 2026-08-18: "help us come up with the amount of payroll hours we should use, based more
// on margins than cost per clean... need this to be as accurate [as possible], scan, learn and
// understand."
//
// THE IDEA. Checkouts are known days in advance from Guesty bookings, and every clean pays a
// knowable net fee. So for each coming day the planner answers one question: how many
// housekeeping hours can be scheduled while keeping the margin we want on that day's cleans?
// Two numbers bound the answer:
//   FLOOR  — the hours the work physically takes: cleans x settled hours-per-clean, plus the
//            overhead share of HK hours that never match a clean (walk time, helping, tasks
//            never closed). Schedule less than this and cleans don't get done.
//   BUDGET — the most hours the target margin allows: net revenue x (1 - target) / wage.
// FLOOR <= scheduled <= BUDGET is a good day. FLOOR > BUDGET means the target is not achievable
// at current efficiency — the planner says so instead of pretending, and shows the margin the
// floor actually yields.
//
// WHERE THE NUMBERS COME FROM — all settled, none invented:
//   - Calibration (fee/clean, hours/clean, wage, overhead share) reads the daily labor true-up
//     snapshot: the same engine-settled 30-day window the briefs print, already gated against
//     partial Homebase payroll. Per market where the snapshot has it.
//   - Demand is confirmed Guesty checkouts (same status filter and unit/day dedupe as
//     /api/schedule/forecast), vendor buildings excluded — their crews, their cost.
//   - Scheduled hours are the actual forward Homebase shifts for the housekeeping crew.
//
// THE LEARNING PART. Bookings keep arriving after the plan is made, so a count taken N days out
// undershoots the final number. Every day (from the labor-trueup cron) the planner records how
// many checkouts are on the books for each of the next 14 days. Once the same dates have been
// seen both N days ahead and on the day itself, it learns the median pickup factor per lead
// time and applies it to projections. Until enough history exists the factor is 1.0 — the plan
// runs on confirmed bookings only, which only ever understates revenue (recommendations stay
// conservative).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting, setSetting, getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { marketOf } from './segments'
import { getShifts } from './homebase'
import { getCrew } from './crew'

const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const LIVE = /confirm|checked/i
const DAYLABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Conservative portfolio fallbacks, used only when the true-up snapshot is missing a market.
// Values are the settled August 2026 figures at the time this shipped; the snapshot supersedes
// them the moment it exists.
const FALLBACK = { feePerClean: 135, hoursPerClean: 4.0, wage: 18 }

export type MarketCal = {
  key: string; label: string
  feePerClean: number      // net revenue per departure clean, settled 30d
  hoursPerClean: number    // housekeeper hours per clean, settled 30d
  wage: number             // blended housekeeper $/hour = costPerClean / hoursPerClean
  cleans30: number         // sample size, so thin markets are visibly thin
}
export type Calibration = {
  markets: Record<string, MarketCal>
  overheadShare: number    // HK payroll with no matched clean ÷ HK payroll with one — extra hours reality demands
  settledMarginPct: number | null   // what HK actually kept over the settled window
  snapshotFrom: string | null; snapshotTo: string | null; takenAt: string | null
  usingFallback: boolean
}

/** Read the settled 30-day true-up snapshot and turn it into planning rates. */
export async function getCalibration(): Promise<Calibration> {
  const snap = await getSetting<any>('labor_trueup_snapshot', null).catch(() => null)
  const markets: Record<string, MarketCal> = {}
  let overheadShare = 0
  let settledMarginPct: number | null = null
  if (snap && Array.isArray(snap.markets)) {
    let matchedPay = 0, unmatchedPay = 0
    for (const m of snap.markets) {
      const key = String(m.key || '').toLowerCase()
      if (/unassigned/.test(key)) { unmatchedPay += Number(m.payroll) || 0; continue }
      if (!m.inHouse) continue
      matchedPay += Number(m.payroll) || 0
      const cleans = Number(m.cleans) || 0
      if (cleans < 5) continue                          // too thin to calibrate on
      const fee = cleans > 0 ? (Number(m.revenue) || 0) / cleans : 0
      const hpc = Number(m.hoursPerClean) || 0
      const cpc = Number(m.costPerClean) || 0
      if (fee <= 0 || hpc <= 0 || cpc <= 0) continue
      markets[key] = {
        key, label: String(m.label || key),
        feePerClean: round2(fee),
        hoursPerClean: round2(hpc),
        wage: round2(cpc / hpc),
        cleans30: cleans,
      }
    }
    if (matchedPay > 0) overheadShare = round2(unmatchedPay / matchedPay)
    // Settled HK margin over the window: net revenue vs housekeeping payroll.
    const rev = Number(snap.cleaningRevenue) || 0
    const hkPay = Number(snap.hkPayroll) || 0
    if (rev > 0 && hkPay > 0) settledMarginPct = Math.round(((rev - hkPay) / rev) * 100)
  }
  return {
    markets, overheadShare, settledMarginPct,
    snapshotFrom: snap?.from || null, snapshotTo: snap?.to || null, takenAt: snap?.takenAt || null,
    usingFallback: Object.keys(markets).length === 0,
  }
}

function calFor(cal: Calibration, marketKey: string): MarketCal {
  return cal.markets[marketKey] || {
    key: marketKey, label: marketKey,
    feePerClean: FALLBACK.feePerClean, hoursPerClean: FALLBACK.hoursPerClean, wage: FALLBACK.wage,
    cleans30: 0,
  }
}

// ---------------------------------------------------------------------------
// Demand: confirmed in-house checkouts per day and market for a date range.
// Same rules as /api/schedule/forecast: LIVE statuses, one clean per unit/day.
// ---------------------------------------------------------------------------
export async function forwardCheckouts(from: string, to: string): Promise<Record<string, Record<string, number>>> {
  const db = supabaseAdmin()
  const VENDOR = vendorRegex((await getOpsPresets()).vendorBuildings)
  const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(5000)
  const meta: Record<string, { market: string; vendor: boolean }> = {}
  for (const l of (listings || []) as any[]) {
    const name = l.nickname || l.title || 'Unit'
    const building = String(l.building || '')
    meta[String(l.id)] = {
      market: String(marketOf(building, l.address_city, name) || 'Miami').toLowerCase(),
      vendor: VENDOR.test(building) || VENDOR.test(String(name)),
    }
  }
  const rows: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await db.from('guesty_reservations')
      .select('listing_id,check_out,status')
      .gte('check_out', from).lte('check_out', to)
      .order('id', { ascending: true })
      .range(off, off + 999)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  const seen = new Set<string>()
  const byDay: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (!LIVE.test(String(r.status || ''))) continue
    const id = String(r.listing_id)
    const date = String(r.check_out || '').slice(0, 10)
    if (!date) continue
    const key = id + '__' + date
    if (seen.has(key)) continue
    seen.add(key)
    const m = meta[id]
    if (!m || m.vendor) continue                 // vendor buildings: their crews, their cost
    if (!byDay[date]) byDay[date] = {}
    byDay[date][m.market] = (byDay[date][m.market] || 0) + 1
  }
  return byDay
}

// ---------------------------------------------------------------------------
// Learning: daily forward-booking snapshots -> pickup factor per lead time.
// ---------------------------------------------------------------------------
const HISTORY_KEY = 'labor_plan_forward_history'
type FwdEntry = { taken: string; counts: Record<string, number> }   // date -> in-house checkouts booked

/** Record how many checkouts are on the books for each of the next 14 days. Runs daily via cron. */
export async function storeForwardSnapshot(): Promise<{ stored: boolean; days: number }> {
  const today = ymd(new Date())
  const hist = await getSetting<FwdEntry[]>(HISTORY_KEY, []).catch(() => [] as FwdEntry[])
  if (Array.isArray(hist) && hist.some(h => h.taken === today)) return { stored: false, days: 0 }  // once a day
  const byDay = await forwardCheckouts(today, addDays(today, 13))
  const counts: Record<string, number> = {}
  for (let i = 0; i <= 13; i++) {
    const d = addDays(today, i)
    counts[d] = Object.values(byDay[d] || {}).reduce((a, b) => a + b, 0)
  }
  const next = (Array.isArray(hist) ? hist : []).concat([{ taken: today, counts }]).slice(-120)
  await setSetting(HISTORY_KEY, next, 'cron')
  return { stored: true, days: Object.keys(counts).length }
}

/**
 * Pickup factor per lead time: how much the final day-of count exceeds what was booked N days
 * out, learned from the snapshot history. Clamped to [1.0, 1.6]; 1.0 until >= 5 samples exist.
 */
export async function pickupFactors(): Promise<{ factors: number[]; samples: number[] }> {
  const hist = await getSetting<FwdEntry[]>(HISTORY_KEY, []).catch(() => [] as FwdEntry[])
  const finals: Record<string, number> = {}
  for (const h of (Array.isArray(hist) ? hist : [])) {
    if (h.counts && h.counts[h.taken] != null) finals[h.taken] = Number(h.counts[h.taken]) || 0
  }
  const factors: number[] = [1]                     // lead 0 = the day itself
  const samples: number[] = [Object.keys(finals).length]
  for (let lead = 1; lead <= 13; lead++) {
    const ratios: number[] = []
    for (const h of (Array.isArray(hist) ? hist : [])) {
      const target = addDays(h.taken, lead)
      const booked = h.counts ? Number(h.counts[target]) : NaN
      const final = finals[target]
      if (!Number.isFinite(booked) || booked <= 0 || final == null || final <= 0) continue
      ratios.push(final / booked)
    }
    ratios.sort((a, b) => a - b)
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1
    factors[lead] = ratios.length >= 5 ? Math.min(1.6, Math.max(1, round2(med))) : 1
    samples[lead] = ratios.length
  }
  return { factors, samples }
}

// ---------------------------------------------------------------------------
// The plan itself.
// ---------------------------------------------------------------------------
export type DayPlan = {
  date: string; day: string; daysAhead: number; isPast: boolean
  bookedCleans: number
  projectedCleans: number          // booked x learned pickup factor
  byMarket: { key: string; label: string; cleans: number; revenue: number; floorHours: number; budgetHours: number | null }[]
  revenue: number                  // expected net cleaning revenue
  floorHours: number               // hours the work takes (incl. overhead share)
  budgetHours: number | null       // most hours the target margin allows (null when no revenue)
  scheduledHours: number | null    // forward Homebase HK shifts (null when none fetched)
  scheduledPayroll: number | null
  marginAtFloorPct: number | null  // margin if exactly floor hours are worked
  marginAtScheduledPct: number | null
  verdict: 'lean' | 'on_budget' | 'over_budget' | 'under_floor' | 'no_data'
}
export type WeekPlan = {
  ok: true
  weekStart: string; weekEnd: string; today: string
  targetMarginPct: number; targetSource: 'setting' | 'derived'
  calibration: Calibration
  pickup: { factors: number[]; samples: number[]; learning: boolean }
  days: DayPlan[]
  totals: {
    cleans: number; revenue: number; floorHours: number; budgetHours: number
    scheduledHours: number; scheduledPayroll: number
    marginAtScheduledPct: number | null; marginAtFloorPct: number | null
  }
}

/**
 * Target margin: operator-set app_settings 'labor_plan'.targetMarginPct wins; otherwise derived
 * as the settled margin + 3 points — hold what you actually make, plus a modest stretch — never
 * derived below 30 or above 60.
 */
async function targetMargin(cal: Calibration): Promise<{ pct: number; source: 'setting' | 'derived' }> {
  const cfg = await getSetting<{ targetMarginPct?: number }>('labor_plan', {}).catch(() => ({} as any))
  const set = Number(cfg?.targetMarginPct)
  if (Number.isFinite(set) && set > 0 && set < 90) return { pct: Math.round(set), source: 'setting' }
  const base = cal.settledMarginPct != null ? cal.settledMarginPct + 3 : 45
  return { pct: Math.min(60, Math.max(30, base)), source: 'derived' }
}

/** Scheduled HOUSEKEEPING hours from forward Homebase shifts, per date. Sequential and gentle. */
async function scheduledHK(dates: string[]): Promise<Record<string, { hours: number; payroll: number } | null>> {
  const crew = await getCrew().catch(() => null)
  const out: Record<string, { hours: number; payroll: number } | null> = {}
  for (const d of dates) {
    try {
      const shifts = await getShifts(d, TZ)
      let hours = 0, payroll = 0
      for (const s of shifts) {
        if (s.open || !s.name) continue
        if (crew && crew.deptOf(s.name, s.role) !== 'housekeeping') continue
        const a = s.startAt ? new Date(s.startAt).getTime() : NaN
        const b = s.endAt ? new Date(s.endAt).getTime() : NaN
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) hours += Math.min(12, (b - a) / 3600000)
        if (s.scheduledCost != null) payroll += s.scheduledCost
      }
      out[d] = { hours: round1(hours), payroll: round2(payroll) }
      await new Promise(r => setTimeout(r, 120))
    } catch { out[d] = null }
  }
  return out
}

export async function buildWeekPlan(weekStartInput?: string): Promise<WeekPlan> {
  const today = ymd(new Date())
  const anchor = weekStartInput && /^\d{4}-\d{2}-\d{2}$/.test(weekStartInput) ? weekStartInput : today
  // Sunday on or before the anchor — the workweek is Sunday-start (Jon's standing rule).
  const dow = new Date(anchor + 'T12:00:00').getDay()
  const weekStart = addDays(anchor, -dow)
  const weekEnd = addDays(weekStart, 6)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) dates.push(addDays(weekStart, i))

  const [cal, byDay, pk] = await Promise.all([
    getCalibration(),
    forwardCheckouts(weekStart, weekEnd),
    pickupFactors(),
  ])
  const target = await targetMargin(cal)
  const futureDates = dates.filter(d => d >= today)
  const sched = await scheduledHK(futureDates)

  const days: DayPlan[] = dates.map(date => {
    const daysAhead = Math.max(0, Math.round((new Date(date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 864e5))
    const isPast = date < today
    const mkts = byDay[date] || {}
    const uplift = pk.factors[Math.min(daysAhead, pk.factors.length - 1)] || 1
    let revenue = 0, floorHours = 0, budgetHours = 0, booked = 0, projected = 0
    const byMarket: DayPlan['byMarket'] = []
    for (const mk of Object.keys(mkts).sort()) {
      const c = calFor(cal, mk)
      const n = mkts[mk]
      const proj = round1(n * uplift)
      const rev = round2(proj * c.feePerClean)
      const floor = round1(proj * c.hoursPerClean * (1 + cal.overheadShare))
      const budget = c.wage > 0 ? round1((rev * (1 - target.pct / 100)) / c.wage) : null
      booked += n; projected += proj; revenue += rev; floorHours += floor; budgetHours += budget ?? 0
      byMarket.push({ key: mk, label: c.label, cleans: proj, revenue: rev, floorHours: floor, budgetHours: budget })
    }
    revenue = round2(revenue); floorHours = round1(floorHours); budgetHours = round1(budgetHours)
    const s = sched[date] ?? null
    // Margin math uses each day's blended wage implied by its own market mix.
    const blendedWage = floorHours > 0 ? (byMarket.reduce((a, m) => a + m.floorHours * calFor(cal, m.key).wage, 0) / floorHours) : FALLBACK.wage
    const marginAtFloorPct = revenue > 0 ? Math.round((1 - (floorHours * blendedWage) / revenue) * 100) : null
    const schedPay = s ? (s.payroll > 0 ? s.payroll : round2(s.hours * blendedWage)) : null
    const marginAtScheduledPct = revenue > 0 && schedPay != null ? Math.round((1 - schedPay / revenue) * 100) : null
    let verdict: DayPlan['verdict'] = 'no_data'
    if (revenue > 0) {
      if (s == null) verdict = 'no_data'
      else if (s.hours < floorHours * 0.9) verdict = 'under_floor'
      else if (budgetHours > 0 && s.hours <= budgetHours) verdict = 'on_budget'
      else if (budgetHours > 0) verdict = 'over_budget'
      else verdict = 'no_data'
    }
    // When the target margin is impossible at current efficiency, the budget sits below the
    // floor. Never recommend fewer hours than the work takes — surface the floor as the plan
    // and let marginAtFloorPct tell the truth about what that day can yield.
    if (budgetHours > 0 && budgetHours < floorHours) budgetHours = floorHours
    return {
      date, day: DAYLABEL[new Date(date + 'T12:00:00').getDay()], daysAhead, isPast,
      bookedCleans: booked, projectedCleans: round1(projected), byMarket,
      revenue, floorHours, budgetHours: budgetHours || null,
      scheduledHours: s ? s.hours : null, scheduledPayroll: schedPay,
      marginAtFloorPct, marginAtScheduledPct, verdict,
    }
  })

  const fut = days.filter(d => !d.isPast)
  const tRev = round2(fut.reduce((a, d) => a + d.revenue, 0))
  const tFloor = round1(fut.reduce((a, d) => a + d.floorHours, 0))
  const tBudget = round1(fut.reduce((a, d) => a + (d.budgetHours ?? 0), 0))
  const tSched = round1(fut.reduce((a, d) => a + (d.scheduledHours ?? 0), 0))
  const tSchedPay = round2(fut.reduce((a, d) => a + (d.scheduledPayroll ?? 0), 0))
  const tCleans = round1(fut.reduce((a, d) => a + d.projectedCleans, 0))
  return {
    ok: true, weekStart, weekEnd, today,
    targetMarginPct: target.pct, targetSource: target.source,
    calibration: cal,
    pickup: { ...pk, learning: pk.samples.slice(1).every(n => n < 5) },
    days,
    totals: {
      cleans: tCleans, revenue: tRev, floorHours: tFloor, budgetHours: tBudget,
      scheduledHours: tSched, scheduledPayroll: tSchedPay,
      marginAtScheduledPct: tRev > 0 && tSchedPay > 0 ? Math.round((1 - tSchedPay / tRev) * 100) : null,
      marginAtFloorPct: tRev > 0 && tFloor > 0 ? Math.round((1 - (tFloor * (tSchedPay > 0 && tSched > 0 ? tSchedPay / tSched : FALLBACK.wage)) / tRev) * 100) : null,
    },
  }
}
