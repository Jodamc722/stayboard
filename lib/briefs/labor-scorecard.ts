// LABOR, INSIDE THE GM MORNING (Jon, 2026-11-05: one brief per role — "more effective, more clear
// and useful"). The Labor Scorecard was its own 7:58 email to the same reader as the GM Brief; it is
// now the Labor block of the GM morning, built here:
//   • What moved — last 7 days against the last 30 days (settled), capped at five lines
//   • Missing from the numbers — people with cleans and no wage, cleaners with no timecard, wage
//     outliers, yesterday's clock
//   • Checks failing — the labor integrity checks (lib/labor-integrity), one line each
// The four headline numbers moved up into the GM morning's tiles; the three-tier matrix and the
// Labor KPI tables live on the Labor board behind the link.
//
// ONE BUILDER, ONE ENGINE (lib/labor-econ, same windows as before: yesterday · 7 · 30). The GM
// morning reuses the 7- and 30-day results for its tiles, so the engine runs once a morning for
// the brief. The labor-trueup cron (7:58) keeps the ledger — the 30-day snapshot and the forward
// bookings — and emails the integrity failures only on a morning this section was not delivered.
//
// PARTIAL PAYROLL IS ONE LINE, NOT A MISSING EMAIL. When a Homebase week did not come back, the
// block says so and withholds the numbers; the rest of the GM morning still goes.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { laborEconomics } from '@/lib/labor-econ'
import { getShifts } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { computeYesterdayLabor } from '@/lib/labor-daily'
import { integrityChecks, integrityIgnoreNames, engineFailedCheck, type IntegrityCheck } from '@/lib/labor-integrity'
import { ACCENTS, APP_URL, T, esc, block, lineRows, type Line } from './ui'

export type Tier = {
  cleans: number; cleansHk: number; cleansOthers: number
  hkHours: number; hkPay: number; cpc: number | null; hpc: number | null; cpcOwn: number | null
  hkFees: number; byMk: Record<string, number | null>
  sup: { n: number; names: string[]; hours: number; pay: number; cleans: number; fees: number; bill: number; rev: number }
  mt: { n: number; names: string[]; hours: number; pay: number; fees: number; bill: number; rev: number; billed: number; noCharge: number }
  ccsPay: number; allRev: number; allPay: number; profit: number; marginPct: number | null
  midStayNoCharge?: number
}

/** One laborEconomics window, read the way the labor emails have read it since 2026-09-07. */
export function tierOf(ec: any): Tier {
  const deptOf = (key: string): any => ((ec?.departments || []) as any[]).find(x => x.key === key) || {}
  const K: any = ec?.kpi || {}
  const hk: any = K.housekeeping || {}
  const sup = deptOf('supervision'), mt = deptOf('maintenance'), ccs = deptOf('ccs')
  return {
    cleans: Number(hk.cleans) || 0,
    midStayNoCharge: Number((ec?.cleanAudit || {}).midStayNoCharge) || 0,
    cleansHk: Number(hk.cleansByHousekeepers ?? hk.cleans) || 0,
    cleansOthers: Number(hk.cleansByOtherCrews) || 0,
    hkHours: Number(hk.hours) || 0, hkPay: Number(hk.payroll) || 0,
    cpc: hk.costPerClean ?? null, hpc: hk.hoursPerClean ?? null, cpcOwn: hk.costPerCleanHkOnly ?? null,
    hkFees: Number(hk.revenue) || 0,
    byMk: (ec?.costPerCleanByMarket || {}) as Record<string, number | null>,
    sup: { n: Number(sup.people) || 0, names: sup.names || [], hours: Number(sup.hours) || 0, pay: Number(sup.payroll) || 0,
      cleans: Number(sup.depCleans) || 0, fees: Number(sup.cleanFeesToHk) || 0, bill: Number(sup.billableRevenue) || 0, rev: Number(sup.billableRevenue || 0) },
    mt: { n: Number(mt.people) || 0, names: mt.names || [], hours: Number(mt.hours) || 0, pay: Number(mt.payroll) || 0,
      fees: Number(mt.cleanFeesToHk) || 0, bill: Number(mt.billableRevenue) || 0, rev: Number(mt.billableRevenue || 0),
      billed: Number(mt.billableTasks) || 0, noCharge: Number(mt.tasksNoCharge) || 0 },
    ccsPay: Number(ccs.payroll) || 0,
    allRev: Number(K.allIn?.revenue) || 0, allPay: Number(K.allIn?.payroll) || 0,
    profit: Number(K.allIn?.margin) || 0, marginPct: K.allIn?.marginPct ?? null,
  }
}

export type LaborInput = {
  T7: Tier; T30: Tier
  chargeRate: number                         // $/h the owner is charged for maintenance
  kpi7: { expected: number | null; actual: number | null } | null
  kpi30: { expected: number | null; actual: number | null } | null
  clock: { worked: number; scheduled: number; headcount: number; late: { name: string; minutesLate: number }[]; over: { name: string; overByHours: number }[]; noShows: { name: string }[]; openCards: number } | null
  checks: IntegrityCheck[]
  noPay: { name: string; cleans: number }[]; outliers: { name: string; impliedRate: number }[]
  unmatched: string[]                        // cleaned with no Homebase timecard (7d)
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const rate = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '—' : '$' + Number(n).toFixed(2))
const first = (n: string) => String(n || '').trim().split(/\s+/)[0]

/** What moved, what is missing from the numbers, and the failing checks — as lines. */
export function laborLines(x: LaborInput): { moved: Line[]; missing: Line[]; failing: Line[]; checksPassed: number } {
  const { T7, T30 } = x
  // ---- what moved: last 7 days against the last 30 (settled) ---------------------------------
  const moved: Line[] = []
  // THE LABOR KPI (Jon, 2026-11-02) — the P&L's expected cost per clean against what the turns
  // actually cost, now one line here; the per-market and per-cleaner tables are on the Labor board.
  if (x.kpi7 && x.kpi7.expected != null && x.kpi7.actual != null && x.kpi7.expected > 0) {
    const d = (x.kpi7.actual - x.kpi7.expected) / x.kpi7.expected
    moved.push({ tone: d <= 0 ? 'green' : d <= 0.1 ? 'amber' : 'red', html: `<b>Labor KPI</b> — ${rate(x.kpi7.actual)} actual vs ${rate(x.kpi7.expected)} expected per clean (${d <= 0 ? '−' : '+'}${Math.abs(Math.round(d * 100))}%)${x.kpi30 && x.kpi30.actual != null ? ` <span style="${T.muted}">· last 30 days ${rate(x.kpi30.actual)} vs ${rate(x.kpi30.expected)}</span>` : ''}` })
  }
  const dCpc = T7.cpc != null && T30.cpc != null ? T7.cpc - T30.cpc : null
  if (dCpc != null) moved.push({ tone: dCpc <= 0 ? 'green' : dCpc > 3 ? 'red' : 'amber', html: `<b>Cost per turn ${rate(T7.cpc)}</b> — ${Math.abs(dCpc) < 0.5 ? 'flat on' : dCpc < 0 ? `<b>${rate(Math.abs(dCpc))} better</b> than` : `<b>${rate(dCpc)} worse</b> than`} the last 30 days' ${rate(T30.cpc)}${T7.hpc ? ` · ${Number(T7.hpc).toFixed(1)}h per turn` : ''}` })
  const mtNet = T30.mt.rev - T30.mt.pay
  moved.push({ tone: mtNet < 0 ? 'amber' : 'green', html: `<b>Maintenance</b> billed ${money(T30.mt.bill)} against ${money(T30.mt.pay)} of wages in the last 30 days → <b style="${mtNet < 0 ? T.red : T.green}">${mtNet < 0 ? '−' : ''}${money(Math.abs(mtNet))}</b>`, sub: T30.mt.noCharge ? `<b>${T30.mt.noCharge} tasks closed with no charge</b> (${T7.mt.noCharge} in the last 7 days). Each one bills $0.` : undefined })
  if (T7.midStayNoCharge) moved.push({ tone: 'amber', html: `<b>${T7.midStayNoCharge} mid-stay clean${T7.midStayNoCharge === 1 ? '' : 's'} with no charge entered</b> in the last 7 days — revenue cleans that invoiced nothing` })
  const mk = ['miami', 'broward'].filter(k => T30.byMk[k] != null)
  if (mk.length) moved.push({ tone: 'none', html: `<b>By market</b> — ${mk.map(k => `${k === 'miami' ? 'Miami' : 'Broward'} ${rate(T30.byMk[k])}`).join(' · ')} per turn (last 30 days)${mk.length === 2 && T30.byMk.miami != null && T30.byMk.broward != null && Math.abs(T30.byMk.miami - T30.byMk.broward) > 8 ? ` · <span style="${T.amber}">${rate(Math.abs(T30.byMk.miami - T30.byMk.broward))} apart — scheduling, not wages</span>` : ''}` })
  const supPct = T30.sup.hours > 0 && x.chargeRate > 0 ? Math.round(((T30.sup.bill / x.chargeRate) / T30.sup.hours) * 100) : null
  if (T30.sup.n) moved.push({ tone: 'none', html: `<b>Supervisors</b> cost ${money(T30.sup.pay)} in the last 30 days and covered ${T30.sup.cleans} turn${T30.sup.cleans === 1 ? '' : 's'}${supPct != null ? ` · ${supPct}% of their hours billed` : ''}` })

  // ---- missing from the numbers ---------------------------------------------------------------
  const missing: Line[] = []
  const noPayCleans = x.noPay.reduce((a, p) => a + p.cleans, 0)
  if (x.noPay.length) missing.push({ tone: 'red', html: `<b>${x.noPay.map(p => esc(p.name)).join(', ')}</b> — ${noPayCleans} clean${noPayCleans === 1 ? '' : 's'} with <b>$0 of payroll</b>`, sub: 'No wage on the Homebase profile, so cost per turn reads low. Homebase → the person → wage.' })
  if (x.unmatched.length) missing.push({ tone: 'amber', html: `<b>${x.unmatched.length} cleaned with no Homebase timecard</b> (last 7 days) — ${x.unmatched.slice(0, 4).map(esc).join(', ')}${x.unmatched.length > 4 ? ` +${x.unmatched.length - 4}` : ''}`, sub: 'Vendor crews are expected here; a Stay cleaner on this line is a name mismatch to fix.' })
  if (x.outliers.length) missing.push({ tone: 'amber', html: `<b>${x.outliers.map(o => esc(o.name)).join(', ')}</b> paid far under the median (${x.outliers.slice(0, 3).map(o => rate(o.impliedRate)).join(', ')}/h)`, sub: 'Check the Homebase wage before trusting their cost per turn.' })
  if (x.clock) {
    const c = x.clock
    const bits: string[] = []
    if (c.noShows.length) bits.push(`<span style="${T.red}">${c.noShows.length} never clocked in</span> (${c.noShows.slice(0, 3).map(n => esc(first(n.name))).join(', ')})`)
    if (c.late.length) bits.push(`${c.late.length} late (${c.late.slice(0, 3).map(l => esc(first(l.name)) + ' +' + l.minutesLate + 'm').join(', ')})`)
    if (c.over.length) bits.push(`${c.over.length} past schedule (${c.over.slice(0, 3).map(l => esc(first(l.name)) + ' +' + l.overByHours + 'h').join(', ')})`)
    if (c.openCards) bits.push(`${c.openCards} timecard${c.openCards === 1 ? '' : 's'} left open`)
    if (bits.length) missing.push({ tone: 'amber', html: `<b>Yesterday's clock</b> — ${c.worked}h worked by ${c.headcount} (${c.scheduled}h scheduled) · ${bits.join(' · ')}` })
  }

  // ---- checks failing, one line each (a check already named above is not repeated) ---------
  const failingChecks = x.checks.filter(c => !c.ok && !(x.noPay.length && /\$0 (of )?payroll/i.test(c.what)))
  const failing: Line[] = failingChecks.map(c => ({ tone: c.level, html: `<b>${esc(c.what)}</b> <span style="${T.muted}">— ${esc(c.fix)}</span>` }))
  return { moved, missing, failing, checksPassed: x.checks.filter(c => c.ok).length }
}

export type LaborSection = {
  /** ok = numbers shown · partial = payroll incomplete, said in one line · failed = engine did not run */
  status: 'ok' | 'partial' | 'failed'
  html: string
  why?: string
  ec7: any | null
  ec30: any | null
  checks: IntegrityCheck[]
}

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)

/**
 * THE LABOR BLOCK OF THE GM MORNING (Jon, 2026-11-05). Runs the engine's three windows
 * (sequential on purpose — parallel runs double up on Homebase and trip its rate limiting; the
 * engine caches its weeks so runs 2 and 3 ride run 1), the integrity checks on the 30-day window,
 * yesterday's clock and the wage-quality lists, and returns the block plus the 7- and 30-day
 * results the GM morning's tiles read. Never throws: a failure is a block that says so.
 */
export async function buildLaborSection(opts: { unmatched?: string[] | null } = {}): Promise<LaborSection> {
  const A = ACCENTS.labor
  const title = 'Labor · last 7 days vs last 30 days (settled)'
  const link = `<a href="${APP_URL}/labor" style="color:${A.ink}">Labor board</a>`
  const now = new Date()
  const yd = dISO(addDays(now, -1)), d7 = dISO(addDays(now, -7)), d30 = dISO(addDays(now, -30))
  let ecY: any, ec7: any, ec30: any
  try {
    ecY = await laborEconomics({ from: yd, to: yd, market: 'all' })
    ec7 = await laborEconomics({ from: d7, to: yd, market: 'all' })
    ec30 = await laborEconomics({ from: d30, to: yd, market: 'all' })
  } catch (e: any) {
    const why = String(e?.message || e).slice(0, 160)
    return { status: 'failed', why, ec7: null, ec30: null, checks: [engineFailedCheck(e)],
      html: block(title, `<p style="margin:6px 0 0;font-size:13px"><span style="${T.red}">The labor engine did not run this morning</span> <span style="${T.muted}">— ${esc(why)}. The 7:58 labor check emails the details; the ${link} has the live picture.</span></p>`, A) }
  }
  const checks = integrityChecks(ec30, { ignoreNames: await integrityIgnoreNames().catch(() => []) })
  // Kept for the 7:58 labor ledger, so it does not run the same 30 days through Homebase again.
  await storeLabor30(d30, yd, ec30, checks)
  const badAudit = [ecY?.payrollAudit, ec7?.payrollAudit, ec30?.payrollAudit].find(a => a && !a.complete)
  if (badAudit) {
    const why = 'Homebase did not return timecards for ' + (badAudit.failedWeeks || []).join(', ')
    const others = checks.filter(c => !c.ok && c.key !== 'punches-complete')
    return { status: 'partial', why, ec7, ec30, checks,
      html: block(title, `<p style="margin:6px 0 0;font-size:13px"><span style="${T.amber}">Payroll is partial this morning</span> <span style="${T.muted}">— ${esc(why)}, so the labor numbers are withheld rather than printed low. The ${link} has the live picture.</span></p>` +
        (others.length ? lineRows(others.map(c => ({ tone: c.level, html: `<b>${esc(c.what)}</b> <span style="${T.muted}">— ${esc(c.fix)}</span>` })), { cap: 6, more: `on the ${link}` }) : ''), A) }
  }

  // Additive reads — a hiccup in any of these never costs the block.
  const chargeRate = Number((await getSetting<{ rate?: number }>('billing_default_rate', { rate: 40 }).catch(() => ({ rate: 40 }))).rate) || 40
  let clock: LaborInput['clock'] = null
  try {
    const [ySh, yTc, lset] = await Promise.all([getShifts(yd, TZ), getTimecards(yd, yd), getLaborSettings('default')])
    const fl = computeYesterdayLabor(yd, ySh, yTc, lset)
    clock = { worked: fl.totalHoursWorked, scheduled: fl.totalScheduledHours, headcount: fl.headcount, late: fl.lateClockIns, over: fl.overSchedule, noShows: fl.noShows, openCards: fl.missedClockOuts.length }
  } catch { clock = null }
  let unmatched = opts.unmatched || null
  if (!unmatched) {
    try { const { weekCompliance } = await import('@/lib/ops-brief'); unmatched = (await weekCompliance()).cleanersNoTimecard } catch { unmatched = [] }
  }
  const q30: any = ec30?.pnl?.quality || {}
  const kpiOf = (ec: any) => ec?.laborKpi ? { expected: ec.laborKpi.expectedCostPerClean ?? null, actual: ec.laborKpi.actualCostPerClean ?? null } : null
  const L = laborLines({
    T7: tierOf(ec7), T30: tierOf(ec30), chargeRate,
    kpi7: kpiOf(ec7), kpi30: kpiOf(ec30),
    clock, checks,
    noPay: (Array.isArray(q30.workedNoPay) ? q30.workedNoPay : []).map((x: any) => ({ name: String(x.name || ''), cleans: Number(x.cleans) || 0 })),
    outliers: (Array.isArray(q30.rateOutliers) ? q30.rateOutliers : []).map((x: any) => ({ name: String(x.name || ''), impliedRate: Number(x.impliedRate) || 0 })),
    unmatched: unmatched || [],
  })
  const sub = (t: string) => `<p style="margin:10px 0 0;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280">${esc(t)}</p>`
  const inner =
    sub('What moved') + lineRows(L.moved, { cap: 5, more: `on the ${link}` }) +
    (L.missing.length ? sub('Missing from the numbers') + lineRows(L.missing, { cap: 4, more: `on the ${link}` }) : '') +
    (L.failing.length
      ? sub(`Checks failing · ${L.checksPassed} of ${checks.length} pass`) + lineRows(L.failing, { cap: 6, more: `on the ${link}` })
      : `<p style="margin:8px 0 0;font-size:12px"><span style="${T.green}">✓ All ${checks.length} labor checks pass</span> <span style="${T.muted}">— every Homebase week answered, every clean has a wage behind it, fees match cleans.</span></p>`)
  return { status: 'ok', ec7, ec30, checks, html: block(title, inner, A) }
}

// ---- the settled 30 days, handed to the 7:58 labor ledger ----------------------------------------
// (2026-11-09) The GM morning (7:01) and the labor ledger (7:58) each ran laborEconomics over the same
// 30 days — the slowest read of the morning, three Homebase windows — within the hour. The GM morning
// now leaves the part of its result the ledger reads (app_settings `labor_ec30_handoff`): the payroll
// audit, the KPI figures and market buckets the snapshot is built from, and the integrity checks. The
// ledger uses it when it is under 90 minutes old AND for the same window; otherwise it runs the engine
// itself, exactly as before. Only what the ledger reads is kept — never the per-person detail.
const HANDOFF_KEY = 'labor_ec30_handoff'
export const LABOR30_FRESH_MS = 90 * 60_000
export type Labor30 = { at: string; from: string; to: string; ec30: any; checks: IntegrityCheck[] }
async function storeLabor30(from: string, to: string, ec30: any, checks: IntegrityCheck[]): Promise<void> {
  try {
    const K: any = ec30?.kpi || {}
    const slim = {
      payrollAudit: ec30?.payrollAudit ? { complete: !!ec30.payrollAudit.complete, failedWeeks: ec30.payrollAudit.failedWeeks || [] } : null,
      kpi: {
        housekeeping: { cleans: K.housekeeping?.cleans, revenue: K.housekeeping?.revenue, costPerClean: K.housekeeping?.costPerClean, payroll: K.housekeeping?.payroll },
        maintenance: { billable: K.maintenance?.billable },
        allIn: { payroll: K.allIn?.payroll, margin: K.allIn?.margin },
      },
      cleaningRevenue: ec30?.cleaningRevenue,
      feeAudit: ec30?.feeAudit ? { credited: ec30.feeAudit.credited } : null,
      buckets: ((ec30?.buckets || []) as any[]).map(b => ({ key: b.key, label: b.label, inHouse: b.inHouse, cleans: b.cleans, cleaningRevenue: b.cleaningRevenue, payroll: b.payroll, laborCostPerClean: b.laborCostPerClean, hoursPerClean: b.hoursPerClean, margin: b.margin, marginPct: b.marginPct })),
    }
    // Without the figures the snapshot needs, leave nothing: the ledger then runs the engine itself.
    if (!K.housekeeping || !K.maintenance || !K.allIn) return
    const v: Labor30 = { at: new Date().toISOString(), from, to, ec30: slim, checks }
    await setSetting(HANDOFF_KEY, v, 'gm-morning')
  } catch { /* the ledger recomputes */ }
}
/** This morning's 30-day result for exactly this window, if the GM morning left one under 90 minutes ago. */
export async function freshLabor30(from: string, to: string): Promise<Labor30 | null> {
  try {
    const { getSettingFresh } = await import('@/lib/app-settings')
    const v = await getSettingFresh<Labor30 | null>(HANDOFF_KEY, null)
    if (!v || v.from !== from || v.to !== to || !v.ec30 || !Array.isArray(v.checks)) return null
    const age = Date.now() - Date.parse(String(v.at || ''))
    return Number.isFinite(age) && age >= 0 && age < LABOR30_FRESH_MS ? v : null
  } catch { return null }
}

// ---- did this morning's GM morning carry the section? -------------------------------------------
// The 7:58 labor job reads this: on a morning the GM morning delivered the Labor block, its failing
// checks were in front of the owner already and the separate ⚠️ integrity email stays quiet.
const DELIVERED_KEY = 'labor_section_delivered'
export async function markLaborDelivered(today: string, status: LaborSection['status']): Promise<void> {
  await setSetting(DELIVERED_KEY, { on: today, status }, 'gm-morning').catch(() => null)
}
export async function laborDeliveredToday(today: string): Promise<boolean> {
  const v = await getSetting<{ on?: string; status?: string }>(DELIVERED_KEY, {}).catch(() => ({} as any))
  return !!v && v.on === today && v.status !== 'failed'
}
