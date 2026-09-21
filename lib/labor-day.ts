// ── LABOR BY DAY, BY CREW ─────────────────────────────────────────────────────
//
// Jon, 2026-09-21: "track labor hours per turn, and margins of rev vs labor cost. This needs to be
// the most accurate KPI we track… HK alone, Supervisor alone, Maintenance alone vs billable labor
// recorded for the day."
//
// One row per ET day. Every number is derived from ONE engine run (lib/labor-econ.ts) over the
// window, so a day can never disagree with the week it sits in, and every surface that prints a
// labor number — the board, the weekly trend, the Daily Labor email, the GM brief — reads these
// rows instead of re-deriving its own version (the 2026-09-21 audit found five).
//
// THE RULES (feedback-labor-truth-source + the audit decisions):
//   • Hours and wages: Homebase punches. Salaried people carry salary ÷ days, punches shown beside.
//   • Volume: departure cleans, on the ET day they landed. Cost and hours per turn come TWO ways:
//     HK wages ÷ every turn (a supervisor covering one is a saving — the number that matters) and
//     HK wages ÷ housekeepers' own turns (the scheduling check). Both always shown.
//   • Revenue: net cleaning fees on confirmed checkouts only. Owner / F&F stays earn $0.
//   • Billable: what the team ENTERED on Breezeway tasks (a manual process, never task clock
//     time), on the ET day the task was finished, credited by the same person→crew rule as wages.
//     Billed hours = billed $ ÷ the charge rate (app_settings billing_default_rate, $40).
//   • Breezeway colours, never decides.

import 'server-only'
import { laborEconomics, type LaborEcon, type PersonEcon } from './labor-econ'
import { getSetting } from './app-settings'

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)

export type CrewKey = 'housekeeping' | 'supervision' | 'maintenance' | 'other'
export const CREW_KEYS: CrewKey[] = ['housekeeping', 'supervision', 'maintenance', 'other']
export const CREW_LABEL: Record<CrewKey, string> = {
  housekeeping: 'Housekeeping', supervision: 'Supervisors', maintenance: 'Maintenance', other: 'Other / office / vendor',
}

export type CrewDay = {
  /** People who punched or did work that day. */
  people: number
  /** Homebase punched hours. */
  hours: number
  /** Wages for the day: punches, agency-loaded; salaried people carry salary ÷ window days. */
  payroll: number
  /** The punch-only part, kept so salary vs clock is visible. */
  punchPayroll: number
  /** Departure turns this crew's people did. */
  cleans: number
  /** Charges entered on this crew's tasks (never for departure cleans — those carry the guest fee). */
  billable: number
  /** billable ÷ charge rate. What the paperwork says the crew billed, in hours. */
  billedHours: number | null
  /** billedHours ÷ hours, %. How much of the paid day has a charge behind it. */
  billedPct: number | null
  names: string[]
}

export type LaborDayRow = {
  d: string
  dow: string
  crews: Record<CrewKey, CrewDay>
  /** Housekeeping's KPI, two ways (Jon 2026-09-21): wages ÷ EVERY turn (a supervisor covering a
   *  turn is a saving — the number that matters) and wages ÷ the turns housekeepers themselves did
   *  (is the controllable team scheduled well). */
  hk: {
    /** Turns housekeepers did. */
    cleans: number
    /** Turns a supervisor / tech / vendor cleaner covered. */
    coveredByOthers: number
    /** cleans + coveredByOthers. */
    cleansTotal: number
    /** Net cleaning fees on every in-house departure turn that landed today (any crew). */
    fees: number
    /** HK wages ÷ every turn — THE number. */
    hoursPerClean: number | null
    costPerClean: number | null
    /** HK wages ÷ housekeepers' own turns — the scheduling check. */
    hoursPerCleanHkOnly: number | null
    costPerCleanHkOnly: number | null
    margin: number
    marginPct: number | null
  }
  /** Every crew together. */
  total: { hours: number; payroll: number; cleans: number; fees: number; billable: number; billedHours: number | null; margin: number }
}

export type LaborDays = {
  from: string
  to: string
  market: string
  chargeRate: number
  rows: LaborDayRow[]
  /** The same shape, summed over the window. */
  sum: LaborDayRow
  /** Window-level checks the day rows cannot show — named, never hidden. */
  health: {
    payrollComplete: boolean
    failedWeeks: string[]
    timecardsOutsideWindow: number
    /** Fees on confirmed checkouts with no departure clean found within 9 days. */
    feesNoCleanFound: number
    /** Fees on inquiries / expired / pending rows the engine now refuses to count. */
    excludedNonLive: { reservations: number; grossFees: number }
    excludedOwnerFF: { reservations: number; grossFees: number }
    /** Departure cleans in the window that were deleted / cancelled in Breezeway (moved, not done). */
    movedCleans: number
    unrostered: { people: number; payroll: number; names: string[] }
    unassignedMarket: { people: number; payroll: number; names: string[] }
    /** Maintenance tasks closed with no charge entered (17WEST excluded by design). */
    tasksNoCharge: number
    salaried: string[]
  }
  basis: string
}

const crewOf = (p: PersonEcon): CrewKey =>
  p.dept === 'housekeeping' ? 'housekeeping' : p.dept === 'supervision' ? 'supervision' : p.dept === 'maintenance' ? 'maintenance' : 'other'

const blankCrew = (): CrewDay => ({ people: 0, hours: 0, payroll: 0, punchPayroll: 0, cleans: 0, billable: 0, billedHours: null, billedPct: null, names: [] })
const blankRow = (d: string): LaborDayRow => ({
  d, dow: d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : '',
  crews: { housekeeping: blankCrew(), supervision: blankCrew(), maintenance: blankCrew(), other: blankCrew() },
  hk: { cleans: 0, coveredByOthers: 0, cleansTotal: 0, fees: 0, hoursPerClean: null, costPerClean: null, hoursPerCleanHkOnly: null, costPerCleanHkOnly: null, margin: 0, marginPct: null },
  total: { hours: 0, payroll: 0, cleans: 0, fees: 0, billable: 0, billedHours: null, margin: 0 },
})

function finish(row: LaborDayRow, rate: number) {
  for (const k of CREW_KEYS) {
    const c = row.crews[k]
    c.hours = round1(c.hours); c.payroll = round2(c.payroll); c.punchPayroll = round2(c.punchPayroll); c.billable = round2(c.billable)
    c.billedHours = rate > 0 && c.billable > 0 ? round1(c.billable / rate) : (c.billable > 0 ? null : 0)
    c.billedPct = c.hours > 0 && c.billedHours != null ? Math.round((c.billedHours / c.hours) * 100) : null
    c.people = c.names.length
  }
  const hk = row.crews.housekeeping
  row.hk.fees = round2(row.hk.fees)
  row.hk.cleansTotal = row.hk.cleans + row.hk.coveredByOthers
  row.hk.hoursPerClean = row.hk.cleansTotal > 0 && hk.hours > 0 ? round2(hk.hours / row.hk.cleansTotal) : null
  row.hk.costPerClean = row.hk.cleansTotal > 0 && hk.payroll > 0 ? round2(hk.payroll / row.hk.cleansTotal) : null
  row.hk.hoursPerCleanHkOnly = row.hk.cleans > 0 && hk.hours > 0 ? round2(hk.hours / row.hk.cleans) : null
  row.hk.costPerCleanHkOnly = row.hk.cleans > 0 && hk.payroll > 0 ? round2(hk.payroll / row.hk.cleans) : null
  row.hk.margin = round2(row.hk.fees - hk.payroll)
  row.hk.marginPct = row.hk.fees > 0 ? Math.round((row.hk.margin / row.hk.fees) * 100) : null
  const t = row.total
  t.hours = round1(CREW_KEYS.reduce((a, k) => a + row.crews[k].hours, 0))
  t.payroll = round2(CREW_KEYS.reduce((a, k) => a + row.crews[k].payroll, 0))
  t.cleans = CREW_KEYS.reduce((a, k) => a + row.crews[k].cleans, 0)
  t.fees = row.hk.fees
  t.billable = round2(CREW_KEYS.reduce((a, k) => a + row.crews[k].billable, 0))
  t.billedHours = rate > 0 ? round1(t.billable / rate) : null
  t.margin = round2(t.fees + t.billable - t.payroll)
}

/**
 * Per-day, per-crew labor for [from, to], both inclusive ET days. One engine run.
 * Pass `econ` to reuse a run the caller already has (the weekly route and the emails do).
 */
export async function laborDays(opts: { from: string; to: string; market?: string; econ?: LaborEcon }): Promise<LaborDays> {
  const from = opts.from, to = opts.to
  const market = String(opts.market || 'all').toLowerCase()
  const [econ, rateSetting] = await Promise.all([
    opts.econ ? Promise.resolve(opts.econ) : laborEconomics({ from, to, market }),
    getSetting<{ rate?: number }>('billing_default_rate', { rate: 40 }),
  ])
  const rate = Number(rateSetting && rateSetting.rate) > 0 ? Number(rateSetting!.rate) : 40

  const days: string[] = []
  for (let d = new Date(from + 'T12:00:00Z'); dISO(d) <= to && days.length < 400; d = addDays(d, 1)) days.push(dISO(d))
  const nDays = Math.max(1, days.length)
  const rows: Record<string, LaborDayRow> = {}
  for (const d of days) rows[d] = blankRow(d)

  // Only people whose Staffing area is on this tab, exactly like the engine's own tiles — the
  // engine already dropped the rest into unassignedMarket.
  const people = econ.people
  const pd = econ.personDays || {}
  const salariedNames: string[] = []
  for (const p of people) {
    const crew = crewOf(p)
    const dayRows = pd[p.name] || []
    // Salary: the window cost spread evenly over the days — a fixed cost does not punch a clock.
    const salaryPerDay = p.salaried ? round2((p.salaryWindow != null ? p.salaryWindow : p.payroll) / nDays) : 0
    if (p.salaried) salariedNames.push(p.name)
    const byDay: Record<string, (typeof dayRows)[number]> = {}
    for (const r of dayRows) byDay[r.d] = r
    for (const d of days) {
      const r = byDay[d]
      const c = rows[d].crews[crew]
      const hours = r ? r.hours : 0
      const punch = r ? r.wages : 0
      const wages = p.salaried ? salaryPerDay : punch
      const worked = hours > 0 || (r && (r.depCleans > 0 || r.billable > 0)) || (p.salaried && salaryPerDay > 0)
      if (!worked) continue
      c.hours += hours
      c.payroll += wages
      c.punchPayroll += punch
      // Head-count = people who actually punched or did work today; a salary lands on every day
      // (it is a fixed cost) but does not make someone "on" a day they never clocked.
      if ((hours > 0 || (r && (r.depCleans > 0 || r.billable > 0))) && c.names.indexOf(p.name) < 0) c.names.push(p.name)
      if (r) {
        c.cleans += r.depCleans
        // A charged cleaning task (mid-stay, linen refresh) is revenue for housekeeping; for every
        // other crew `billable` is the charge on their maintenance / inspection work.
        c.billable += r.billable
        // Cleaning fees follow the TURN, not the person: a supervisor's covered turn is HK revenue.
        rows[d].hk.fees += r.feeAll
        if (crew === 'housekeeping') rows[d].hk.cleans += r.depCleans
        else rows[d].hk.coveredByOthers += r.depCleans
      }
    }
  }
  for (const d of days) finish(rows[d], rate)

  // The window sum, built from the finished rows so it is the same arithmetic.
  const sum = blankRow('')
  sum.dow = 'Σ'
  for (const d of days) {
    const r = rows[d]
    for (const k of CREW_KEYS) {
      const a = sum.crews[k], b = r.crews[k]
      a.hours += b.hours; a.payroll += b.payroll; a.punchPayroll += b.punchPayroll; a.cleans += b.cleans; a.billable += b.billable
      for (const n of b.names) if (a.names.indexOf(n) < 0) a.names.push(n)
    }
    sum.hk.cleans += r.hk.cleans; sum.hk.coveredByOthers += r.hk.coveredByOthers; sum.hk.fees += r.hk.fees
  }
  finish(sum, rate)

  const fa: any = econ.feeAudit || {}
  const ca: any = (econ as any).cleanAudit || {}
  const mt = econ.departments.filter(x => x.key === 'maintenance')[0]
  return {
    from, to, market, chargeRate: rate,
    rows: days.map(d => rows[d]),
    sum,
    health: {
      payrollComplete: !!econ.payrollAudit.complete,
      failedWeeks: econ.payrollAudit.failedWeeks || [],
      timecardsOutsideWindow: Number((econ.payrollAudit as any).outsideWindowCards || 0),
      feesNoCleanFound: round2(Number(fa.noCleanFound || 0)),
      excludedNonLive: fa.excludedNonLive || { reservations: 0, grossFees: 0 },
      excludedOwnerFF: fa.excludedOwnerFF || { reservations: 0, grossFees: 0 },
      movedCleans: Number(ca.movedExcluded || 0),
      unrostered: { people: econ.unrostered.people, payroll: econ.unrostered.payroll, names: econ.unrostered.names },
      unassignedMarket: { people: econ.unassignedMarket.people, payroll: econ.unassignedMarket.payroll, names: econ.unassignedMarket.names },
      tasksNoCharge: mt ? Number((mt as any).tasksNoCharge || 0) : 0,
      salaried: salariedNames,
    },
    basis: 'Homebase punches for hours and wages (salaries by the day) \u00b7 departure turns on the day they landed \u2014 HK wages over every turn (the number) and over housekeepers\u2019 own turns (the scheduling check) \u00b7 net cleaning fees on confirmed checkouts \u00b7 charges the team entered on tasks, \u00f7 $' + rate + '/h for billed hours. Breezeway colours, never decides.',
  }
}
