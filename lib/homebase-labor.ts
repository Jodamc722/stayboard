// lib/homebase-labor.ts
// Timecards + labor KPIs on top of lib/homebase.ts.
// Reads HOMEBASE_API_KEY / HOMEBASE_LOCATION_UUID from env (set in Vercel).
//
// Everything is written defensively against field-name drift — run the
// /api/homebase/probe route once and we tighten the pickers to your account's
// actual schema.

import { getLocationUuid, getShifts, nameMatches, type Shift } from '@/lib/homebase'

const BASE = process.env.HOMEBASE_BASE_URL || 'https://app.joinhomebase.com/api/public'
const OT_WEEKLY_HOURS = 40 // FL: overtime is federal FLSA — over 40h/workweek

type Json = any
const pick = (o: Json, ...ks: string[]) => {
  for (const k of ks) if (o?.[k] != null && o[k] !== '') return o[k]
  return null
}
const arr = (d: Json): Json[] => {
  if (Array.isArray(d)) return d
  for (const k of ['data', 'timecards', 'results']) if (Array.isArray(d?.[k])) return d[k]
  return []
}

async function hb(path: string): Promise<Json> {
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.HOMEBASE_API_KEY || process.env['Homebase_Secret_id']}`,
      Accept: 'application/vnd.homebase-v1+json',
    },
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`Homebase ${r.status} on ${path}`)
  return r.json()
}

export type Timecard = {
  name: string
  role: string | null
  date: string | null        // YYYY-MM-DD
  clockIn: string | null
  clockOut: string | null
  hours: number | null       // actual worked hours (net of breaks when the API nets them)
  regularHours: number | null
  overtimeHours: number | null
  wageRate: number | null    // $/hr if exposed
  laborCost: number | null   // regular + OT cost if exposed, else rate*hours, else null
  open: boolean              // clocked in, not yet out
}

// HOMEBASE CAPS ONE TIMECARD RESPONSE, SILENTLY.
//
// A single call for a 30-day range came back with a fraction of the punches: the 30-day board
// reported FEWER hours than the 7-day one, only 7 of 30 people had any payroll at all, and the
// 30-day true-up priced a clean at $25 against a real $70-plus. Nothing errored — the array was
// just short, and every downstream number inherited the hole.
//
// So the range is fetched a week at a time and merged. One punch can only appear once (same
// person, same day, same clock-in), so overlapping edges are harmless.
const WEEK_MS = 7 * 864e5

// A FAILED WEEK MUST BE LOUD, NOT EMPTY.
//
// The old code fetched all weeks in parallel and swallowed every failure into an empty array.
// Under Homebase rate-limiting (429s are routine here) that meant two-thirds of payroll could
// silently vanish and cost per clean printed $24 against a true $75 — a number that was 3x wrong
// and LOOKED completely normal. Jon, 2026-08-17: "I just want this to be so accurate."
//
// So now: weeks fetch SEQUENTIALLY (parallel bursts are what tripped the limiter), each week
// retries 3x with backoff, and a week that still fails is RECORDED in failedWeeks. Callers get
// the audit alongside the cards and must refuse to print payroll-derived numbers when any week
// is missing. A visible gap beats a quiet lie.
export type TimecardAudit = { cards: Timecard[]; weeks: number; failedWeeks: string[]; complete: boolean }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function getTimecardsAudited(startDate: string, endDate: string): Promise<TimecardAudit> {
  const loc = await getLocationUuid()
  const spans: Array<[string, string]> = []
  const s0 = new Date(startDate + 'T12:00:00Z').getTime()
  const e0 = new Date(endDate + 'T12:00:00Z').getTime()
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  for (let a = s0; a <= e0; a += WEEK_MS) {
    const b = Math.min(a + WEEK_MS - 864e5, e0)
    spans.push([iso(a), iso(b)])
  }
  if (!spans.length) spans.push([startDate, endDate])
  const pages: Json[][] = []
  const failedWeeks: string[] = []
  for (const [a, b] of spans) {
    let got: Json[] | null = null
    for (let attempt = 0; attempt < 3 && got == null; attempt++) {
      try {
        got = arr(await hb(`/locations/${loc}/timecards?start_date=${a}&end_date=${b}`))
      } catch {
        // Back off harder each attempt — 429 means "slow down", so we do.
        await sleep(800 * (attempt + 1) * (attempt + 1))
      }
    }
    if (got == null) { failedWeeks.push(`${a}..${b}`); pages.push([]) }
    else pages.push(got)
    await sleep(150)   // breathe between weeks; sequential + spaced is what keeps 429s away
  }
  const cards = mergeTimecards(pages)
  return { cards, weeks: spans.length, failedWeeks, complete: failedWeeks.length === 0 }
}

// Back-compat: everything that only wants the cards. New code should use getTimecardsAudited and
// honour `complete`.
export async function getTimecards(startDate: string, endDate: string): Promise<Timecard[]> {
  return (await getTimecardsAudited(startDate, endDate)).cards
}

function mergeTimecards(pages: Json[][]): Timecard[] {
  const seen: Record<string, boolean> = {}
  const raw: Json[] = []
  for (const page of pages) {
    for (const t of page) {
      const nested = (t && (t.employee || t.user)) || {}
      const key = [
        [t?.first_name, t?.last_name].filter(Boolean).join(' ') || nested?.name || nested?.full_name || '',
        t?.date || t?.shift_date || '',
        t?.clock_in || t?.clock_in_at || t?.start_at || '',
      ].join('|')
      if (seen[key]) continue
      seen[key] = true
      raw.push(t)
    }
  }
  return raw.map((t: Json): Timecard => {
    const nested = pick(t, 'employee', 'user') || {}
    const name =
      [pick(t, 'first_name'), pick(t, 'last_name')].filter(Boolean).join(' ') ||
      pick(nested, 'name', 'full_name') ||
      [pick(nested, 'first_name'), pick(nested, 'last_name')].filter(Boolean).join(' ') || 'Unknown'
    const clockIn = pick(t, 'clock_in', 'clock_in_at', 'start_at', 'clockIn')
    const clockOut = pick(t, 'clock_out', 'clock_out_at', 'end_at', 'clockOut')
    // Homebase nests the money under labor: costs, wage_rate, paid_hours, OT splits
    const lab: Json = (t.labor && typeof t.labor === 'object') ? t.labor : {}
    let hours = num(pick(lab, 'paid_hours')) ?? num(pick(t, 'hours', 'total_hours', 'worked_hours', 'duration_hours'))
    if (hours == null && clockIn && clockOut)
      hours = round2((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 36e5)
    const regularHours = num(pick(lab, 'regular_hours')) ?? num(pick(t, 'regular_hours', 'regularHours'))
    const otSum = (num(pick(lab, 'weekly_overtime')) ?? 0) + (num(pick(lab, 'daily_overtime')) ?? 0) + (num(pick(lab, 'double_overtime')) ?? 0)
    const overtimeHours = otSum > 0 ? round2(otSum) : num(pick(t, 'overtime_hours', 'overtimeHours'))
    const wageRate = num(pick(lab, 'wage_rate')) ?? num(pick(t, 'wage_rate', 'wage', 'hourly_wage', 'rate'))
    let laborCost = num(pick(lab, 'costs')) ?? num(pick(t, 'labor_cost', 'estimated_wages', 'total_wages', 'cost'))
    if (laborCost == null && wageRate != null && hours != null)
      laborCost = round2(wageRate * hours)
    return {
      name,
      role: pick(t, 'role', 'position', 'department'),
      date: (pick(t, 'date', 'shift_date') || clockIn || '').slice(0, 10) || null,
      clockIn, clockOut, hours, regularHours, overtimeHours, wageRate, laborCost,
      open: !!clockIn && !clockOut,
    }
  })
}

const num = (v: Json): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

export type PersonLabor = {
  name: string
  scheduledHours: number
  actualHours: number
  varianceHours: number       // actual - scheduled; + = worked past schedule
  overtimeHours: number
  wageRate: number | null      // $/hr from Homebase (highest seen on their cards)
  laborCost: number | null
  weekToDateHours: number
  remainingScheduledThisWeek: number
  projectedWeekHours: number
  overtimeRisk: boolean       // projected ≥ 40h this workweek
  // ON SHIFT RIGHT NOW vs A CARD NOBODY CLOSED — two different problems, and conflating them made
  // the board useless (Jon, 2026-08-10: "can you make sure if clocked out?"). This used to be
  // `myTc.some(t => t.open)` across the WHOLE selected range, so one un-closed card from three
  // weeks ago painted a permanent green "clocked in" badge on someone who was at home. Twelve
  // people read as on shift at once.
  openTimecard: boolean       // an open card that started TODAY — genuinely on the clock now
  missedClockOuts: string[]   // dates of open cards from earlier days — a payroll data problem
  noShow: boolean             // had a shift, no timecard that day
}

export type LaborKpis = {
  range: { start: string; end: string }
  totalScheduledHours: number
  totalActualHours: number
  totalOvertimeHours: number
  totalLaborCost: number | null      // null when no wage data on any card
  costDataCoverage: number           // 0..1 share of timecards carrying cost
  cleansCompleted: number | null
  hoursPerClean: number | null       // housekeeping hours ÷ completed cleans
  laborCostPerOccupiedNight: number | null
  people: PersonLabor[]
  flags: {
    overtimeRisk: string[]
    noShows: { name: string; date: string }[]
    stillClockedIn: string[]         // on the clock RIGHT NOW (open card dated today)
    missedClockOuts: string[]        // open card from an earlier day = missed punch, hours too low
  }
}

const shiftHours = (s: Shift): number =>
  s.startAt && s.endAt
    ? Math.max(0, (new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 36e5)
    : 0

/**
 * Aggregate shifts + timecards into per-person and portfolio KPIs.
 * `cleans` and `occupiedNights` come from your existing Supabase data
 * (breezeway_tasks_sync / guesty_reservations) — pass null to skip those KPIs.
 */
export function computeLaborKpis(opts: {
  start: string; end: string
  shifts: (Shift & { date?: string })[]
  timecards: Timecard[]
  weekShifts: (Shift & { date?: string })[]   // rest of the current workweek, for OT projection
  otWeeklyHours?: number
  weekStartDate?: string   // YYYY-MM-DD start of current workweek; wtd/OT projection align to it
  cleansCompleted: number | null
  occupiedNights: number | null
  todayISO: string
}): LaborKpis {
  const { start, end, shifts, timecards, weekShifts, cleansCompleted, occupiedNights, todayISO } = opts
  const OT = opts.otWeeklyHours ?? OT_WEEKLY_HOURS

  const names = new Set<string>()
  shifts.forEach(s => !s.open && names.add(s.name))
  timecards.forEach(t => names.add(t.name))

  const people: PersonLabor[] = Array.from(names).map(name => {
    const mySh = shifts.filter(s => !s.open && nameMatches(s.name, name))
    const myTc = timecards.filter(t => nameMatches(t.name, name))
    const scheduled = round1(mySh.reduce((a, s) => a + shiftHours(s), 0))
    const actual = round1(myTc.reduce((a, t) => a + (t.hours ?? 0), 0))
    const ot = round1(myTc.reduce((a, t) => a + (t.overtimeHours ?? 0), 0))
    const costs = myTc.map(t => t.laborCost).filter((c): c is number => c != null)
    const wtd = opts.weekStartDate
      ? round1(myTc.filter(t => t.date && t.date >= (opts.weekStartDate as string)).reduce((a, t) => a + (t.hours ?? 0), 0))
      : actual
    const remaining = round1(
      weekShifts
        .filter(s => !s.open && nameMatches(s.name, name) && String(s.startAt) > todayISO)
        .reduce((a, s) => a + shiftHours(s), 0)
    )
    const shiftDates = new Set(mySh.map(s => (s.date || String(s.startAt)).slice(0, 10)))
    const tcDates = new Set(myTc.map(t => t.date))
    const missed = Array.from(shiftDates).filter(d => d < todayISO.slice(0, 10) && !tcDates.has(d))
    return {
      name,
      scheduledHours: scheduled,
      actualHours: actual,
      varianceHours: round1(actual - scheduled),
      overtimeHours: ot,
      wageRate: myTc.reduce((a: number | null, t) => (t.wageRate != null && (a == null || t.wageRate > a) ? t.wageRate : a), null as number | null),
      laborCost: costs.length ? round2(costs.reduce((a, c) => a + c, 0)) : null,
      weekToDateHours: wtd,
      remainingScheduledThisWeek: remaining,
      projectedWeekHours: round1(wtd + remaining),
      overtimeRisk: wtd + remaining >= OT,
      openTimecard: myTc.some(t => t.open && t.date === todayISO.slice(0, 10)),
      missedClockOuts: myTc.filter(t => t.open && t.date && t.date < todayISO.slice(0, 10)).map(t => t.date as string).sort(),
      noShow: missed.length > 0,
    }
  }).sort((a, b) => b.actualHours - a.actualHours)

  const withCost = timecards.filter(t => t.laborCost != null)
  const totalCost = withCost.length
    ? round2(withCost.reduce((a, t) => a + (t.laborCost as number), 0))
    : null
  const totalActual = round1(timecards.reduce((a, t) => a + (t.hours ?? 0), 0))

  const cleaningHours = round1(
    timecards
      .filter(t => !t.role || /clean|housekeep|turn/i.test(t.role))
      .reduce((a, t) => a + (t.hours ?? 0), 0)
  )

  const noShows = people.filter(p => p.noShow).flatMap(p => {
    const myShiftDates = shifts
      .filter(s => !s.open && nameMatches(s.name, p.name))
      .map(s => (s.date || String(s.startAt)).slice(0, 10))
    const myTcDates = new Set(timecards.filter(t => nameMatches(t.name, p.name)).map(t => t.date))
    return myShiftDates
      .filter(d => d < todayISO.slice(0, 10) && !myTcDates.has(d))
      .map(date => ({ name: p.name, date }))
  })

  return {
    range: { start, end },
    totalScheduledHours: round1(shifts.filter(s => !s.open).reduce((a, s) => a + shiftHours(s), 0)),
    totalActualHours: totalActual,
    totalOvertimeHours: round1(timecards.reduce((a, t) => a + (t.overtimeHours ?? 0), 0)),
    totalLaborCost: totalCost,
    costDataCoverage: timecards.length ? round2(withCost.length / timecards.length) : 0,
    cleansCompleted,
    hoursPerClean: cleansCompleted ? round2(cleaningHours / cleansCompleted) : null,
    laborCostPerOccupiedNight:
      totalCost != null && occupiedNights ? round2(totalCost / occupiedNights) : null,
    people,
    flags: {
      overtimeRisk: people.filter(p => p.overtimeRisk).map(p => p.name),
      noShows,
      // On the clock right now.
      stillClockedIn: people
        .filter(p => p.openTimecard)
        .map(p => p.name),
      // Clocked in on an earlier day and never clocked out. Their hours and cost are understated
      // until someone closes the card, so every figure that includes them is too low.
      missedClockOuts: people
        .filter(p => p.missedClockOuts.length)
        .map(p => p.name + ' (' + p.missedClockOuts.join(', ') + ')'),
    },
  }
}
