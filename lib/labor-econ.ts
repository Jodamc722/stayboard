// lib/labor-econ.ts — THE LABOR P&L. One calculation, every screen.
//
// Jon, 2026-08-12, on how this is supposed to read:
//   "Cleaning revenue, billable labor, their payroll, their costs, their margins — broken down by
//    each department."
//
// THE THREE MONEY FACTS, AND WHERE EACH ONE COMES FROM
//
//   CLEANING REVENUE  the guest's cleaning fee (Guesty fareCleaning), earned when a departure
//                     clean is actually done on a checkout. Attributed to whoever did that clean —
//                     including a maintenance tech, if he really did a departure clean. Vendor-
//                     cleaned buildings are counted but kept in their own bucket: we don't manage
//                     that margin.
//
//   BILLABLE REVENUE  the charge entered on a Breezeway task — its COST LINE ITEMS, nothing else.
//                     Jon: "Billable labor is not 40 times their hours. It is based solely on the
//                     cost field in Breezeway. If Ronnie completed 10 tasks and charged $25 on
//                     each, that is $250." Deriving it from hours has been wrong twice: rate_paid
//                     is 0 on every task in this account (so rate x hours = $0), and pricing
//                     logged hours at the $40 owner rate read $4,312 against $2,345 actually
//                     entered. The number a human typed on the task is the number.
//                     Departure cleans contribute nothing here — their money IS the cleaning fee,
//                     and counting both would pay us twice for one job.
//
//   PAYROLL           what Homebase actually paid: clocked hours x wage. This is the cost side for
//                     every person on every crew. Nothing here is estimated.
//
//   margin = cleaning revenue + billable revenue - payroll
//
// AND THE ONE THAT ISN'T THEIRS: MANAGEMENT FEE. Supervisors don't clean and don't bill work out,
// so measuring them against cleaning revenue makes them look like pure cost. Jon: "a supervisor is
// also part of the revenue generated through management fees." That fee (Guesty `commission` on
// the stay) is reported alongside supervision so the overhead has something real to sit against —
// but it is never mixed into a cleaner's or a tech's margin.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getTimecards, type Timecard } from './homebase-labor'
import { marketOf } from './segments'
import { getOpsPresets } from './app-settings'
import { vendorRegex, type VendorBuilding } from './ops-presets'
import { nameMatches, nameMatchesRoster } from './homebase'
import { getCrew, type Dept, DEPTS, DEPT_LABEL } from './crew'
import { resolveStaff } from './staffing'
import { laborAmount } from './billing'

const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)

async function pageAll(q: (a: number, b: number) => any, pages = 8): Promise<any[]> {
  const out: any[] = []
  for (let p = 0; p < pages; p++) {
    const { data } = await q(p * 1000, p * 1000 + 999)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// ── What kind of job was it? ────────────────────────────────────────────────
// A departure clean is the turnover the guest fee pays for, and Breezeway names it for itself.
// Matching by NAME rather than by department matters: the housekeeping department also contains
// common-area cleans, pool and fitness rooms, trash routes, office cleaning and linen refreshes —
// real work, but not a turnover, and counting them as cleans made every clean look cheap.
export const isDepartureCleanTask = (name: any) =>
  /departure clean|turnover clean|check-?out clean/i.test(String(name || ''))

export type TaskKind = 'clean' | 'inspection' | 'maintenance' | 'other'

export function kindOfTask(t: { name?: any; type_department?: any }): TaskKind {
  const s = (String(t.type_department || '') + ' ' + String(t.name || '')).toLowerCase()
  // Strips, walkthroughs and delivery errands are NOT departure cleans. A strip landing on a
  // checkout day used to collect that unit's whole cleaning fee, stealing it from the cleaner who
  // actually turned the unit.
  if (/strip|walkthrough|walk-through|deliver|mattress/.test(s)) return 'other'
  if (isDepartureCleanTask(t.name)) return 'clean'
  if (/inspect|walk/.test(s)) return 'inspection'
  if (/maint|repair|fix|hvac|plumb|electric|pest/.test(s)) return 'maintenance'
  if (/clean|housekeep|turn/.test(s)) return 'other'  // housekeeping work, but not a turnover
  return 'other'
}

/** Owner-billable total of a Breezeway line-item array. Guest-billed lines are not our revenue. */
function ownerTotal(arr: any, kind: 'cost' | 'supply'): number {
  return (Array.isArray(arr) ? arr : []).reduce((a: number, x: any) => {
    if (x && x.bill_to && String(x.bill_to) === 'guest') return a
    if (kind === 'supply' && x && x.billable === false) return a
    const v = Number(kind === 'cost' ? x?.cost : (x?.total_price != null ? x.total_price : x?.unit_cost))
    return a + (Number.isFinite(v) ? v : 0)
  }, 0)
}

export type PersonEcon = {
  name: string
  dept: Dept
  declared: boolean            // named on the roster vs inferred
  market: string
  role: string | null
  hours: number
  payroll: number
  wageRate: number | null
  cleans: number
  cleaningRevenue: number
  billableRevenue: number
  materials: number            // billable supplies — real money, but not labor
  tasks: number
  billableTasks: number        // tasks carrying a charge
  tasksNoCharge: number        // non-clean tasks with nothing entered — the coverage gap
  /** Clocked a Homebase hour in this window. False = an outside cleaner, not our labor. */
  onPayroll: boolean
  revenue: number              // cleaning + billable
  margin: number               // revenue - payroll
  costPerClean: number | null
}

export type DeptEcon = {
  key: Dept
  label: string
  people: number
  names: string[]
  hours: number
  payroll: number
  cleans: number
  cleaningRevenue: number
  billableRevenue: number
  materials: number
  revenue: number
  margin: number
  marginPct: number | null
  costPerClean: number | null
  /** Housekeeping only. How long a turn takes, alongside what it costs. */
  hoursPerClean: number | null
  billableTasks: number
  tasksNoCharge: number
  /** What this crew is measured against, in plain words — so a screen never has to guess. */
  basis: string
}

export type LaborEcon = {
  from: string
  to: string
  market: string
  people: PersonEcon[]
  departments: DeptEcon[]
  cleans: number
  /** NET of the channel's commission on the cleaning fee — what we actually keep. */
  cleaningRevenue: number
  /** What the guests were charged, before the channel's cut. */
  cleaningRevenueGross: number
  /** The channel's cut on the cleaning fees: gross - net. */
  channelCut: number
  /** Of that, the part tied to a named person via their departure clean. */
  cleaningRevenueAttributed: number
  /** The rest: a checkout whose clean we could not match to anybody. Shown, never hidden —
   *  it is the difference between the department rows and the company total. */
  cleaningRevenueUnattributed: number
  cleaningRevenueVendor: number
  billableRevenue: number
  materials: number
  managementFee: number
  payroll: number
  /** Housekeeper wages ÷ the units housekeepers turned, in-house markets only. */
  costPerClean: number | null
  /** The same denominator, in time rather than money. */
  hoursPerClean: number | null
  costPerCleanByMarket: Record<string, number | null>
  hoursPerCleanByMarket: Record<string, number | null>
  /** Miami / Broward / Vendor-cleaned, the three housekeeping categories. */
  buckets: Array<{
    key: string; label: string; inHouse: boolean; people: number
    cleans: number; cleaningRevenue: number; payroll: number; hours: number
    laborCostPerClean: number | null; hoursPerClean: number | null; feePerClean: number | null
    margin: number; marginPct: number | null
  }>
  /** The stack: housekeeping labor, maintenance billables, maintenance cleans, supervisor overhead. */
  layers: any
  /** Revenue over payroll: housekeeping, maintenance, all revenue-facing staff, supervisors apart. */
  kpi: any
  /** Maintenance charges by task vs what the maintenance crew was credited — attribution check. */
  maintAudit: any
  /** Our own crew's work inside vendor-managed buildings, plus the per-building invoice check. */
  vendorWork: any
  /** Operating margin on work we sell: cleaning + billable - all payroll. */
  margin: number
  /** With the management fee included — the whole labor line against everything labor earns. */
  marginWithFee: number
  feeAudit: any
  coverage: {
    cleansAttributed: number
    cleansUnassigned: number
    tasksWithNoCharge: number
    billableTasks: number
  }
}

const EMPTY_DEPT = (key: Dept): DeptEcon => ({
  key, label: DEPT_LABEL[key], people: 0, names: [], hours: 0, payroll: 0, cleans: 0,
  cleaningRevenue: 0, billableRevenue: 0, materials: 0, revenue: 0, margin: 0, marginPct: null,
  costPerClean: null, hoursPerClean: null, billableTasks: 0, tasksNoCharge: 0, basis: '',
})

const BASIS: Record<Dept, string> = {
  housekeeping: 'cleaning fees vs housekeeper wages',
  supervision: 'overhead — carried by management fees, not cleaning margin',
  maintenance: 'billable charges vs maintenance wages',
  inspection: 'quality control — cost only',
  other: 'cost only',
}

/**
 * The labor P&L for a window. `market` filters the WORK (tasks, checkouts) by the unit's market
 * and the PEOPLE by where their work happened, exactly as the market tabs expect.
 */
export async function laborEconomics(opts: { from: string; to: string; market?: string }): Promise<LaborEcon> {
  const from = opts.from
  const to = opts.to
  const market = String(opts.market || 'all').toLowerCase()
  const sb = supabaseAdmin()

  const [presets, crew, listingRows, timecards] = await Promise.all([
    getOpsPresets(),
    getCrew(),
    pageAll((a, b) => sb.from('guesty_listings').select('id,nickname,title,building,address_city').range(a, b)),
    getTimecards(from, to).catch(() => [] as Timecard[]),
  ])
  const VENDOR_RE = vendorRegex(presets.vendorBuildings)
  const lmap: Record<string, { market: string; name: string; vendor: boolean }> = {}
  for (const l of listingRows) {
    const name = l.nickname || l.title || 'Unit'
    const vendor = VENDOR_RE.test(String(l.building || '')) || VENDOR_RE.test(String(name))
    lmap[String(l.id)] = { market: vendor ? 'vendor' : marketOf(l.building, l.address_city, name).toLowerCase(), name, vendor }
  }
  const inMarketListing = (id: any) => market === 'all' || lmap[String(id)]?.market === market

  // ── the window's work + the money entered on it ───────────────────────────
  const taskRowsAll = await pageAll((a, b) => sb.from('breezeway_tasks_sync')
    .select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,total_minutes,rate_paid')
    .gte('finished_at', from).lte('finished_at', to + 'T23:59:59').range(a, b))
  const taskRows = taskRowsAll.filter(t => inMarketListing(t.reference_property_id))

  // THE CLEAN A FEE BELONGS TO MAY SIT OUTSIDE THIS WINDOW (Jon, 2026-08-14: "sometimes you'll see
  // a BFC block for clean in the calendar and the clean was moved").
  //
  // Measured over 14 live days before building this: of the fees the old day/day+1 rule could not
  // match, 4 had their clean 2 days early to 9 days late — and 61 had no FINISHED clean at all,
  // because 97 of 331 departure cleans in that fortnight were never closed (67 deleted, most of
  // them moved-and-recreated, 30 still open). A clean the crew genuinely did but nobody closed is
  // not a clean that never happened, and the fee it earned should not silently disappear.
  //
  // So fee matching searches a PADDED pool — pulled by scheduled date as well as finish date, two
  // days before the window to a week after — while the cost-per-clean denominator keeps using only
  // cleans actually finished inside the window. Revenue found; work not double-counted.
  const padFrom = dISO(addDays(new Date(from + 'T12:00:00Z'), -2))
  const padTo = dISO(addDays(new Date(to + 'T12:00:00Z'), 7))
  const poolCols = 'id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,scheduled_date,status,total_minutes'
  const poolByFinish = await pageAll((a, b) => sb.from('breezeway_tasks_sync')
    .select(poolCols).gte('finished_at', padFrom).lte('finished_at', padTo + 'T23:59:59').range(a, b))
  const poolBySched = await pageAll((a, b) => sb.from('breezeway_tasks_sync')
    .select(poolCols).gte('scheduled_date', padFrom).lte('scheduled_date', padTo).range(a, b))
  const poolSeen: Record<string, boolean> = {}
  const cleanPool: any[] = []
  for (const t of poolByFinish.concat(poolBySched)) {
    const id = String(t.id)
    if (poolSeen[id] || kindOfTask(t) !== 'clean') continue
    poolSeen[id] = true
    cleanPool.push(t)
  }
  // The day a clean actually landed: when it was finished, else the day it was scheduled for.
  const cleanDay = (t: any): string => String(t.finished_at || '').slice(0, 10) || String(t.scheduled_date || '').slice(0, 10)
  const isClosed = (t: any) => !!t.finished_at && String(t.status || '').toLowerCase() !== 'deleted'

  const ids = taskRows.map(t => String(t.id))
  const details: Record<string, any> = {}
  const adjs: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    if (!chunk.length) break
    try {
      const { data } = await sb.from('breezeway_billing_details').select('task_id,costs,supplies,rate_type').in('task_id', chunk)
      for (const d of (data || []) as any[]) details[String(d.task_id)] = d
    } catch { /* a task with no detail simply carries no charge */ }
    try {
      const { data } = await sb.from('billing_adjustments').select('task_id,excluded,override_amount,billed_hours').in('task_id', chunk)
      for (const a of (data || []) as any[]) adjs[String(a.task_id)] = a
    } catch { /* overlay optional */ }
  }

  // WHAT WE CHARGED FOR THIS TASK — as entered on the task. Never derived from wages or hours.
  //
  // Breezeway puts the charge in TWO places and the owner's invoice adds both (lib/billing.ts,
  // which is what actually prints on a statement):
  //   1. the task RATE — 'piece' (Breezeway's default) means the rate IS the price of the job;
  //      'hourly' means rate x hours. This is Jon's "Ronnie charged $25 on each of 10 tasks".
  //   2. owner-billable cost line items on the task.
  // This engine used to read ONLY (2), so any job priced by its rate reported as "$0 billed — no
  // charge entered" while the owner was invoiced for it. Same helper as the invoice now, so the
  // labor board and the statement can never disagree. (Measured 2026-08-17: rates are barely used
  // today — 1 of 692 maintenance tasks — so this changes almost nothing now and stops the line
  // going silently wrong the day the team starts pricing jobs by rate.)
  const rateChargeOf = (t: any): number => {
    const a = adjs[String(t.id)]
    const d = details[String(t.id)]
    return laborAmount(
      num(t.rate_paid),
      d && d.rate_type ? String(d.rate_type) : null,
      num(t.total_minutes),
      a && a.billed_hours != null ? Number(a.billed_hours) : null,
    )
  }
  const chargeOfRaw = (t: any): number => {
    const a = adjs[String(t.id)]
    if (a && a.excluded) return 0
    if (a && a.override_amount != null) return Number(a.override_amount) || 0
    const d = details[String(t.id)]
    return round2(rateChargeOf(t) + (d ? ownerTotal(d.costs, 'cost') : 0))
  }
  const chargeOf = (t: any): { billable: number; materials: number } => {
    if (kindOfTask(t) === 'clean') return { billable: 0, materials: 0 }   // paid by the guest fee
    const a = adjs[String(t.id)]
    if (a && a.excluded) return { billable: 0, materials: 0 }
    if (a && a.override_amount != null) return { billable: Number(a.override_amount) || 0, materials: 0 }
    const d = details[String(t.id)]
    return {
      billable: round2(rateChargeOf(t) + (d ? ownerTotal(d.costs, 'cost') : 0)),
      materials: round2(d ? ownerTotal(d.supplies, 'supply') : 0),
    }
  }

  // CLEANING TASKS THAT CARRY A CHARGE. Not departure cleans, but paid cleaning work all the
  // same — a linen refresh, a mid-stay, a re-clean. They earn, so they count as cleans.
  const chargedCleanTasks = taskRowsAll.filter(t => {
    if (kindOfTask(t) === 'clean') return false                 // already a departure clean
    const s2 = (String(t.type_department || '') + ' ' + String(t.name || '')).toLowerCase()
    if (!/clean|housekeep|linen|refresh|turn/.test(s2)) return false
    if (/strip|walkthrough|walk-through|deliver|mattress/.test(s2)) return false
    return chargeOfRaw(t) > 0
  })
  const chargedCleanIds: Record<string, boolean> = {}
  for (const t of chargedCleanTasks) chargedCleanIds[String(t.id)] = true

  // ── names: everything keys on the Homebase spelling ──────────────────────
  const rosterNames: string[] = []
  for (const t of timecards) if (t.name && rosterNames.indexOf(t.name) < 0) rosterNames.push(t.name)
  const aliasCache: Record<string, string | null> = {}
  const doer = (t: any): string | null => {
    const raw = t.assignee_name || t.finished_by_name || null
    if (!raw) return null
    if (!(raw in aliasCache)) aliasCache[raw] = rosterNames.length ? nameMatchesRoster(String(raw), rosterNames) : null
    return aliasCache[raw] || String(raw)
  }

  // ── cleaning fees: one checkout, one clean, one fee ──────────────────────
  const resRowsAll = await pageAll((a, b) => sb.from('guesty_reservations')
    .select('listing_id,check_out,status,source,confirmation_code,cleaning:raw->money->>fareCleaning,commission:raw->money->>commission,grossFare:raw->money->>fareAccommodationAdjusted,channelFee:raw->money->>hostServiceFee')
    .gte('check_out', from).lte('check_out', to)
    .not('status', 'in', '("canceled","cancelled","declined")').range(a, b))

  // MATCHING RUNS OVER EVERY MARKET, EVEN ON A MARKET TAB. The market filter decides what is
  // REPORTED, never what is CALCULATED. A housekeeper who works Miami and Broward has her wages
  // split by her share of cleans in each — and that split can only be computed if both markets'
  // cleans are visible. Filtering first made the Miami tab charge Miami for her whole week while
  // crediting it with only her Miami cleans: $102 a clean against a true $77.
  const cleanTasksAll = taskRowsAll.filter(t => kindOfTask(t) === 'clean')
  const cleanTasks = taskRows.filter(t => kindOfTask(t) === 'clean')
  const usedTask: Record<string, boolean> = {}
  const revBy: Record<string, number> = {}
  // THE FEE A MATCHED CHECKOUT PAID, KEYED BY THE CLEAN THAT EARNED IT. Revenue is what the
  // checkout association produces; the CLEAN COUNT comes from Breezeway (below), because Jon's
  // definition is "the number of cleans scheduled in Breezeway... Breezeway is an indication that
  // the clean was completed that day". A completed clean whose checkout we could not match still
  // took hours and still belongs in the denominator — it just earned no attributed revenue.
  const feeByTask: Record<string, number> = {}
  let cleaningInhouse = 0, cleaningVendor = 0, managementFee = 0
  // Gross guest cleaning fees before the channel's cut — kept so the brief can show what the OTAs
  // take off the top, while every margin below runs on the net figure.
  let cleaningGrossAll = 0
  let cleansAttributed = 0, vendorCleans = 0
  // Where a fee ended up, so nothing can quietly vanish: credited to a person, matched to a clean
  // nobody closed, matched to a clean with no assignee, or no clean found at all.
  let feesCleanNotClosed = 0, feesCleanNoAssignee = 0, feesNoCleanFound = 0
  let movedCleans = 0
  const movedOffsets: Record<string, number> = {}
  const pending: { listingId: string; co: string; coNext: string; fee: number; inMk: boolean; source: string; unit: string }[] = []
  // WHICH CHANNEL DID AN UNMATCHED FEE COME FROM? (Jon, 2026-08-14: "it's likely Expedia fees that
  // need to be split out in folio — Expedia bulks fees into one category.") If a channel bundles
  // its fees, a cleaning fee can land on a stay that never needed a separate clean, and chasing a
  // missing clean for it is chasing a ghost. Splitting the shortfall by source says whether this
  // is an operations problem or a folio-mapping one.
  const noCleanBySource: Record<string, { fees: number; checkouts: number }> = {}
  const notClosedBySource: Record<string, { fees: number; checkouts: number }> = {}
  const noCleanExamples: { unit: string; co: string; source: string; fee: number; code: string }[] = []
  const srcOf = (v: any) => String(v || 'unknown').toLowerCase()
  for (const r of resRowsAll) {
    const co = String(r.check_out).slice(0, 10)
    const coNext = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
    const li = lmap[String(r.listing_id)]
    const vendor = !!li?.vendor
    // WHAT WE ACTUALLY NET ON THE CLEAN, NOT WHAT THE GUEST WAS CHARGED (Jon, 2026-08-17: "the
    // clean cost should be based on what actual guests pay for a clean... or what we actually net").
    // The channel takes its host-side commission off the WHOLE payout, cleaning fee included, and
    // the rate is wildly different by channel — Airbnb ~3%, Booking/Expedia ~15%. So the cleaning
    // fee carries its share: fee - hostServiceFee x (fee / (accommodation + fee)).
    // hostServiceFee is the OTA cut and net = gross - fee is the same convention lib/owner-report.ts
    // uses on owner statements, so the labor board and the statements net the same way. (Guesty's
    // own `netIncome` is NOT used — on Airbnb rows it subtracts hostServiceFee twice.)
    // `commission` is OUR management fee, not the channel's, and is never netted off here.
    const feeGross = num(r.cleaning) ?? 0
    const chFee = Math.max(0, num(r.channelFee) ?? 0)
    const payoutBase = (num(r.grossFare) ?? 0) + feeGross
    const fee = payoutBase > 0 && chFee > 0
      ? round2(Math.max(0, feeGross - chFee * (feeGross / payoutBase)))
      : feeGross
    cleaningGrossAll = round2(cleaningGrossAll + (inMarketListing(r.listing_id) ? feeGross : 0))
    // Totals stay scoped to the tab; the fee-to-clean matching below does not.
    const inMk = inMarketListing(r.listing_id)
    if (inMk) managementFee += num(r.commission) ?? 0
    if (vendor) {
      // VENDOR-CLEANED UNITS ARE THEIR OWN BUCKET (Jon, 2026-08-12). A checkout there needed a
      // clean and earned a fee, but no in-house hour went into it — so it carries revenue and a
      // clean count, and never a cost per clean.
      if (inMk) { cleaningVendor += fee; if (fee > 0) vendorCleans++ }
      continue
    }
    if (inMk) cleaningInhouse += fee
    pending.push({ listingId: String(r.listing_id), co, coNext, fee, inMk, source: srcOf(r.source), unit: (li && li.name) || String(r.listing_id) })
  }

  // TWO PASSES, CONFIDENT ONE FIRST. A clean on the checkout day (or the morning after) is the
  // obvious owner of that fee and gets first claim on it. Only then do we look wider, and there
  // the nearest day wins — so a clean moved to Thursday is matched to Thursday's fee, not stolen
  // by a checkout a week away. Every clean is still consumed exactly once.
  const claim = (p: typeof pending[0], t: any) => {
    usedTask[String(t.id)] = true
    feeByTask[String(t.id)] = p.fee
    if (!p.inMk) return
    if (isClosed(t)) {
      const w = doer(t)
      if (w) { cleansAttributed++; revBy[w] = round2((revBy[w] || 0) + p.fee) }
      else feesCleanNoAssignee = round2(feesCleanNoAssignee + p.fee)
    } else {
      // The clean is on the board but was never closed (or was deleted when it moved). The money
      // is real and the work almost certainly happened — it just cannot be credited to a person.
      feesCleanNotClosed = round2(feesCleanNotClosed + p.fee)
      const b = notClosedBySource[p.source] = notClosedBySource[p.source] || { fees: 0, checkouts: 0 }
      b.fees = round2(b.fees + p.fee); b.checkouts++
    }
  }
  const unclaimed: typeof pending = []
  for (const p of pending) {
    const hit = cleanPool.filter(t => !usedTask[String(t.id)] &&
      String(t.reference_property_id) === p.listingId &&
      (cleanDay(t) === p.co || cleanDay(t) === p.coNext))[0]
    if (hit) claim(p, hit); else unclaimed.push(p)
  }
  for (const p of unclaimed) {
    const day0 = new Date(p.co + 'T12:00:00Z').getTime()
    let best: { off: number; t: any } | null = null
    for (const t of cleanPool) {
      if (usedTask[String(t.id)]) continue
      if (String(t.reference_property_id) !== p.listingId) continue
      const d = cleanDay(t)
      if (!d) continue
      const off = Math.round((new Date(d + 'T12:00:00Z').getTime() - day0) / 864e5)
      if (off < -2 || off > 7) continue
      if (!best || Math.abs(off) < Math.abs(best.off)) best = { off, t }
    }
    if (!best) {
      if (p.inMk) {
        feesNoCleanFound = round2(feesNoCleanFound + p.fee)
        const b = noCleanBySource[p.source] = noCleanBySource[p.source] || { fees: 0, checkouts: 0 }
        b.fees = round2(b.fees + p.fee); b.checkouts++
        if (noCleanExamples.length < 40) noCleanExamples.push({ unit: p.unit, co: p.co, source: p.source, fee: p.fee, code: '' })
      }
      continue
    }
    movedCleans++
    movedOffsets[String(best.off)] = (movedOffsets[String(best.off)] || 0) + 1
    claim(p, best.t)
  }

  // ── per person ───────────────────────────────────────────────────────────
  type Acc = PersonEcon & { _mk: Record<string, number> }
  const acc: Record<string, Acc> = {}
  const blank = (name: string): Acc => ({
    name, dept: 'other', declared: false, market: '', role: null,
    hours: 0, payroll: 0, wageRate: null, cleans: 0, cleaningRevenue: 0,
    billableRevenue: 0, materials: 0, tasks: 0, billableTasks: 0, tasksNoCharge: 0,
    onPayroll: false, revenue: 0, margin: 0, costPerClean: null, _mk: {},
  })
  const keyFor = (name: string): string => {
    const hit = Object.keys(acc).filter(n => nameMatches(n, name))[0]
    return hit || name
  }

  for (const t of taskRows) {
    const w = doer(t)
    if (!w) continue
    const k = keyFor(w)
    const p = acc[k] = acc[k] || blank(w)
    p.tasks++
    const kind = kindOfTask(t)
    if (kind === 'clean') p.cleans++
    const ch = chargeOf(t)
    // A charged CLEANING task is cleaning revenue (counted via cleanRecs below), not a billable —
    // otherwise the same $25 linen refresh would show up in both columns.
    const isChargedClean = chargedCleanIds[String(t.id)]
    if (!isChargedClean) {
      p.billableRevenue = round2(p.billableRevenue + ch.billable)
      p.materials = round2(p.materials + ch.materials)
      if (ch.billable > 0) p.billableTasks++
      else if (kind !== 'clean') p.tasksNoCharge++
    } else {
      p.cleans++          // a revenue-generating clean, even though it is not a departure clean
    }
    const li = lmap[String(t.reference_property_id)]
    if (li) { const mk = li.vendor ? 'vendor' : li.market; p._mk[mk] = (p._mk[mk] || 0) + 1 }
  }
  for (const t of timecards) {
    const k = keyFor(t.name)
    const p = acc[k] = acc[k] || blank(t.name)
    p.hours = round2(p.hours + (t.hours ?? 0))
    p.payroll = round2(p.payroll + (t.laborCost ?? 0))
    if (t.wageRate != null) p.wageRate = Math.max(p.wageRate ?? 0, t.wageRate)
    if (!p.role && t.role) p.role = t.role
  }
  for (const k of Object.keys(revBy)) {
    const kk = keyFor(k)
    const p = acc[kk] = acc[kk] || blank(k)
    p.cleaningRevenue = round2(p.cleaningRevenue + revBy[k])
  }

  // A PERSON'S CREW CANNOT DEPEND ON WHICH TAB YOU ARE LOOKING AT. The fallback used to read
  // p.cleans, which is market-scoped: on the Broward tab every Miami housekeeper showed zero
  // cleans, fell through to 'other', and Broward's whole housekeeping payroll vanished — the tab
  // reported no cost per clean at all. Counting their cleans across ALL markets fixes it.
  const cleansAllBy: Record<string, number> = {}
  for (const t of cleanTasksAll) { const w = doer(t); if (w) cleansAllBy[w] = (cleansAllBy[w] || 0) + 1 }
  // crew + market per person, then the arithmetic
  for (const k of Object.keys(acc)) {
    const p = acc[k]
    // Fallback only bites for people nobody has named: what they actually did, cleans first.
    p.onPayroll = p.hours > 0 || p.payroll > 0
    // AN OUTSIDE CLEANER IS NOT ONE OF OUR HOUSEKEEPERS. Somebody who turns units in Breezeway but
    // never clocks a Homebase hour is a vendor's cleaner, not our labor — counting them added
    // cleans to the denominator with no wages in the numerator, quietly making every clean look
    // cheaper. Only an explicit roster entry can put a non-payroll name on a crew.
    let guess: Dept | null = null
    if (p.onPayroll && (p.cleans > 0 || (cleansAllBy[p.name] || 0) > 0)) guess = 'housekeeping'
    else if (p.onPayroll && p.billableRevenue > 0) guess = 'maintenance'
    p.dept = crew.deptOf(p.name, p.role, guess)
    p.declared = crew.isDeclared(p.name)
    const rec = resolveStaff(p.name, crew.staff)
    let best = '', bn = 0
    for (const mk of Object.keys(p._mk)) if (p._mk[mk] > bn) { best = mk; bn = p._mk[mk] }
    p.market = (rec?.area ? String(rec.area).toLowerCase() : '') || best || 'unassigned'
    p.revenue = round2(p.cleaningRevenue + p.billableRevenue)
    p.margin = round2(p.revenue - p.payroll)
    p.costPerClean = p.cleans > 0 && p.payroll > 0 ? round2(p.payroll / p.cleans) : null
  }

  const peopleAll = Object.keys(acc).map(k => { const { _mk, ...rest } = acc[k]; return rest as PersonEcon })
  let people = peopleAll.slice()
  if (market !== 'all') people = people.filter(p => p.market === market || p.market === 'unassigned')
  people.sort((a, b) => b.revenue - a.revenue || b.payroll - a.payroll)

  // ── departments ──────────────────────────────────────────────────────────
  const byDept: Record<string, DeptEcon> = {}
  for (const d of DEPTS) byDept[d] = EMPTY_DEPT(d)
  for (const p of people) {
    const d = byDept[p.dept]
    d.people++
    d.names.push(p.name)
    d.hours = round2(d.hours + p.hours)
    d.payroll = round2(d.payroll + p.payroll)
    d.cleans += p.cleans
    d.cleaningRevenue = round2(d.cleaningRevenue + p.cleaningRevenue)
    d.billableRevenue = round2(d.billableRevenue + p.billableRevenue)
    d.materials = round2(d.materials + p.materials)
    d.billableTasks += p.billableTasks
    d.tasksNoCharge += p.tasksNoCharge
  }
  for (const d of DEPTS) {
    const x = byDept[d]
    x.revenue = round2(x.cleaningRevenue + x.billableRevenue)
    x.margin = round2(x.revenue - x.payroll)
    x.marginPct = x.revenue > 0 ? round2((x.margin / x.revenue) * 100) : null
    // COST PER CLEAN EXISTS FOR HOUSEKEEPING AND NOWHERE ELSE (Jon, 2026-08-12: "For the
    // maintenance section you wouldn't need to do a cost per clean... supervisors should not be
    // added in the cost per clean"). A tech who happens to turn a unit earns the fee; he is still
    // not measured on cost per clean, and neither is a supervisor.
    x.costPerClean = d === 'housekeeping' && x.cleans > 0 && x.payroll > 0 ? round2(x.payroll / x.cleans) : null
    x.hoursPerClean = d === 'housekeeping' && x.cleans > 0 && x.hours > 0 ? round2(x.hours / x.cleans) : null
    x.basis = BASIS[d]
  }

  // ── THE THREE HOUSEKEEPING BUCKETS ───────────────────────────────────────
  // Jon, 2026-08-12: "make sure their housekeepers are in three categories: Miami and Broward,
  // Vendor clean."
  //
  // Cleans are counted where the UNIT is, not where the person is filed. A housekeeper's payroll
  // is then split across the markets she actually cleaned in, in proportion to her cleans there —
  // 8 Miami and 4 Broward puts two-thirds of her wages on Miami. Assigning a whole person to one
  // market overstates one side and understates the other, and several of the crew cross daily.
  //
  // Only HOUSEKEEPER wages and HOUSEKEEPER cleans go into these buckets. Supervisors are fixed
  // overhead and stay out. Maintenance stays out too, even when a tech does a real departure
  // clean: that fee is his revenue, in his own section.
  const hkNames: Record<string, boolean> = {}
  for (const p of peopleAll) if (p.dept === 'housekeeping') hkNames[p.name] = true

  type Bucket = {
    key: string; label: string; inHouse: boolean
    cleans: number; cleaningRevenue: number; payroll: number; hours: number
    laborCostPerClean: number | null; hoursPerClean: number | null; feePerClean: number | null
    margin: number; marginPct: number | null; people: number
  }
  const mkBucket = (key: string, inHouse: boolean): Bucket => ({
    key, label: key.charAt(0).toUpperCase() + key.slice(1), inHouse,
    cleans: 0, cleaningRevenue: 0, payroll: 0, hours: 0,
    laborCostPerClean: null, hoursPerClean: null, feePerClean: null,
    margin: 0, marginPct: null, people: 0,
  })
  const buckets: Record<string, Bucket> = {}
  const bucketFor = (k: string, inHouse = true) => (buckets[k] = buckets[k] || mkBucket(k, inHouse))
  bucketFor('miami'); bucketFor('broward')

  // EVERY DEPARTURE CLEAN COMPLETED, AS A ROW: who did it, which market the unit is in, and the
  // fee if a checkout matched. Built from the Breezeway tasks — not from the matched checkouts —
  // so a clean that was genuinely done still counts in cost per clean even when the checkout
  // association fails. Counting only matched cleans made every clean look ~10% more expensive
  // than it is (94 of 103 matched in the week this was found).
  // A CLEAN COUNTS WHEN IT EARNED SOMETHING (Jon, 2026-08-13: "the goal is to track only revenue
  // generating cleans — either departure cleans or billable Breezeway tasks with cost").
  //
  // Two ways a clean earns:
  //   the guest's cleaning fee, on a departure clean matched to a checkout, or
  //   a charge typed on any cleaning task — a linen refresh, a mid-stay, a re-clean.
  // Checked against the live month before building this: departure cleans carry a cost entry on
  // ZERO of 310 tasks, so fee and charge never land on the same job and nothing double-counts.
  //
  // Everything else the housekeeping department does — strips, exterior walkthroughs, the pool,
  // common areas, trash, office cleaning — earns nothing and is deliberately outside both the
  // numerator and the denominator. It is real work, it is just not a clean we get paid for.
  const cleanRecs = (cleanTasksAll.map(t => {
    const li = lmap[String(t.reference_property_id)]
    const mk = li ? (li.vendor ? 'vendor-inhouse' : li.market) : 'unassigned'
    return { who: doer(t), market: mk, fee: feeByTask[String(t.id)] || 0, charged: false }
  }).concat(chargedCleanTasks.map(t => {
    const li = lmap[String(t.reference_property_id)]
    const mk = li ? (li.vendor ? 'vendor-inhouse' : li.market) : 'unassigned'
    return { who: doer(t), market: mk, fee: chargeOfRaw(t), charged: true }
  })))
    .filter(r => !!r.who)
    // ONLY REVENUE-GENERATING CLEANS. A departure clean whose checkout never matched earned
    // nothing measurable, so it cannot sit in a denominator that divides revenue.
    .filter(r => r.fee > 0) as { who: string; market: string; fee: number; charged: boolean }[]

  // DEPARTURE CLEANS ONLY IN COST PER CLEAN (Jon, 2026-08-17: "just departure").
  // A turnover and a linen refresh are different jobs at different prices; averaging them produced
  // a "cost per clean" that answered no question. So the headline denominator is the guest-paid
  // DEPARTURE clean and nothing else, and charged cleaning tasks — mid-stays, refreshes, re-cleans
  // — are totalled on their own line below. Both are real revenue; only one is a turnover.
  const hkCleansByPerson: Record<string, Record<string, number>> = {}
  let chargedCleanCount = 0, chargedCleanRevenue = 0
  for (const rec of cleanRecs) {
    if (!hkNames[rec.who]) continue
    if (rec.charged) {
      // Extra paid cleaning work. Counted as revenue, never as a turnover.
      chargedCleanCount++
      chargedCleanRevenue = round2(chargedCleanRevenue + rec.fee)
      continue
    }
    const b = bucketFor(rec.market)
    b.cleans++
    b.cleaningRevenue = round2(b.cleaningRevenue + rec.fee)
    hkCleansByPerson[rec.who] = hkCleansByPerson[rec.who] || {}
    hkCleansByPerson[rec.who][rec.market] = (hkCleansByPerson[rec.who][rec.market] || 0) + 1
  }
  // payroll + hours, split by each housekeeper's share of cleans per market
  const bucketNames: Record<string, Record<string, boolean>> = {}
  for (const p of peopleAll) {
    if (p.dept !== 'housekeeping') continue
    const mine = hkCleansByPerson[p.name]
    const total = mine ? Object.keys(mine).reduce((a, m) => a + mine[m], 0) : 0
    if (total > 0) {
      for (const m of Object.keys(mine)) {
        const share = mine[m] / total
        const b = bucketFor(m)
        b.payroll = round2(b.payroll + p.payroll * share)
        b.hours = round2(b.hours + p.hours * share)
        bucketNames[m] = bucketNames[m] || {}; bucketNames[m][p.name] = true
      }
    } else if (p.payroll > 0 || p.hours > 0) {
      // A housekeeper who clocked in but turned no units — common-area work, a training day, a
      // no-show unit. Still housekeeping labor, so it belongs to her market's cost per clean.
      const b = bucketFor(p.market && p.market !== 'unassigned' ? p.market : 'unassigned')
      b.payroll = round2(b.payroll + p.payroll)
      b.hours = round2(b.hours + p.hours)
      bucketNames[b.key] = bucketNames[b.key] || {}; bucketNames[b.key][p.name] = true
    }
  }
  // the vendor bucket: revenue and a clean count, never a cost per clean
  if (market === 'all' || market === 'vendor') {
    const v = bucketFor('vendor', false)
    v.label = 'Vendor-cleaned'
    v.cleans = vendorCleans
    v.cleaningRevenue = round2(cleaningVendor)
  }
  for (const k of Object.keys(buckets)) {
    const b = buckets[k]
    b.people = Object.keys(bucketNames[k] || {}).length
    b.laborCostPerClean = b.inHouse && b.cleans > 0 && b.payroll > 0 ? round2(b.payroll / b.cleans) : null
    b.hoursPerClean = b.inHouse && b.cleans > 0 && b.hours > 0 ? round2(b.hours / b.cleans) : null
    b.feePerClean = b.cleans > 0 && b.cleaningRevenue > 0 ? round2(b.cleaningRevenue / b.cleans) : null
    b.margin = round2(b.cleaningRevenue - b.payroll)
    b.marginPct = b.cleaningRevenue > 0 ? round2((b.margin / b.cleaningRevenue) * 100) : null
  }
  if (buckets['vendor-inhouse']) buckets['vendor-inhouse'].label = 'Vendor units · our crew'
  const ORDER = ['miami', 'broward', 'north', 'vendor-inhouse', 'unassigned', 'vendor']
  // A market tab shows its own bucket (plus the two catch-alls, which belong to nobody's market);
  // the All view shows every one. The MATH above was identical either way — this is presentation.
  const bucketList = Object.keys(buckets)
    .filter(k => market === 'all' || k === market || k === 'unassigned' || (market === 'vendor' && k === 'vendor-inhouse'))
    .filter(k => buckets[k].cleans > 0 || buckets[k].payroll > 0 || buckets[k].cleaningRevenue > 0)
    .sort((a, b) => (ORDER.indexOf(a) < 0 ? 8 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 8 : ORDER.indexOf(b)))
    .map(k => buckets[k])

  const hk = byDept['housekeeping']
  const sup = byDept['supervision']
  const mt = byDept['maintenance']
  const cleansTotal = people.reduce((a, p) => a + p.cleans, 0)
  // The headline cost per clean: housekeeper wages over the units housekeepers actually turned,
  // in-house markets only. Supervisors are not in it. Maintenance is not in it. Vendor is not in
  // it — nobody on our payroll cleaned those.
  // On a market tab the headline tile must be that market's own number. Blending in the
  // catch-all buckets (a housekeeper with hours but no cleans) made the Miami tile read $75
  // while Miami's own row read $73 — two different answers to one question on one screen.
  const inHouseB = market === 'all'
    ? bucketList.filter(b => b.inHouse)
    : bucketList.filter(b => b.inHouse && b.key === market)
  const hkPayrollInHouse = round2(inHouseB.reduce((a, b) => a + b.payroll, 0))
  const hkHoursInHouse = round2(inHouseB.reduce((a, b) => a + b.hours, 0))
  const hkCleansInHouse = inHouseB.reduce((a, b) => a + b.cleans, 0)
  const costPerClean = hkCleansInHouse > 0 && hkPayrollInHouse > 0 ? round2(hkPayrollInHouse / hkCleansInHouse) : null
  const hoursPerClean = hkCleansInHouse > 0 && hkHoursInHouse > 0 ? round2(hkHoursInHouse / hkCleansInHouse) : null
  const costPerCleanByMarket: Record<string, number | null> = {}
  const hoursPerCleanByMarket: Record<string, number | null> = {}
  for (const b of bucketList) {
    costPerCleanByMarket[b.key] = b.laborCostPerClean
    hoursPerCleanByMarket[b.key] = b.hoursPerClean
  }

  // What the crews between them actually earned. The gap to `cleaningRevenue` is fees on
  // checkouts where no clean task could be matched to a person — a real hole in attribution,
  // so it gets its own line rather than being quietly absorbed into somebody's margin.
  const attributedRev = round2(people.reduce((a, p) => a + p.cleaningRevenue, 0))
  const payroll = round2(people.reduce((a, p) => a + p.payroll, 0))
  const billableRevenue = round2(people.reduce((a, p) => a + p.billableRevenue, 0))
  const materials = round2(people.reduce((a, p) => a + p.materials, 0))
  const cleaningRevenue = round2(cleaningInhouse)

  // ── THE DAILY KPI: REVENUE OVER PAYROLL, THREE WAYS ──────────────────────
  // Jon, 2026-08-13: "total rev for cleans / payroll to get an understanding of profit margins,
  // same for maintenance rev / payroll, then total rev / total payroll for actual staff, below
  // supervisor as they are static — we need them regardless of rev to manage."
  //
  // So three ratios that each answer one question, and a fourth line that is not a ratio at all:
  //   HOUSEKEEPING   what cleaning earned (guest fees + charged cleaning tasks) over what the
  //                  housekeepers cost. This is the cost-per-clean engine's own numbers.
  //   MAINTENANCE    what the techs billed out over what the techs cost.
  //   STAFF          both of those together — every person whose pay should move with revenue.
  //                  Supervisors are NOT in it.
  //   SUPERVISORS    a fixed cost shown underneath, never divided into revenue. You carry them to
  //                  run the operation whether or not a single unit turns.
  const pct = (a: number, b: number) => (b > 0 ? round2((a / b) * 100) : null)

  // ── MAINTENANCE BILLING RECONCILIATION ───────────────────────────────────
  // Jon, 2026-08-17: "we have an issue with calculating maintenance labor — check to make sure you
  // are adding this properly."
  //
  // He was right, and the hole is not arithmetic — it is attribution. Maintenance revenue below is
  // what the maintenance CREW billed, because revenue follows the person who did the work. But a
  // charged maintenance job does not care whose name is on it: supervisors, the office and people
  // nobody has put on a crew close them too, and every dollar they billed used to vanish from this
  // line (measured 30d to 2026-08-16: $6,855 of maintenance charges existed, the crew was credited
  // with $4,350 — Oscar Arciniegas alone had billed $1,240 while belonging to no crew).
  //
  // So we total the charges on every maintenance-DEPARTMENT task in the window and name who earned
  // the difference. Either those people belong on the maintenance roster — one line in the
  // crew_roles setting fixes it — or maintenance margin is understating what the department earned.
  // Shown, not silently absorbed.
  const maintTaskCharge: Record<string, number> = {}
  const maintTaskCount: Record<string, number> = {}
  let maintTaskBillables = 0
  for (const t of taskRows) {
    if (kindOfTask(t) !== 'maintenance') continue
    const amt = chargeOfRaw(t)
    if (!(amt > 0)) continue
    maintTaskBillables = round2(maintTaskBillables + amt)
    const w = doer(t) || '— nobody assigned —'
    const k = keyFor(w)
    maintTaskCharge[k] = round2((maintTaskCharge[k] || 0) + amt)
    maintTaskCount[k] = (maintTaskCount[k] || 0) + 1
  }
  const maintCrew: Record<string, boolean> = {}
  for (const p of people) if (p.dept === 'maintenance') maintCrew[p.name] = true
  const billedOutsideCrew = Object.keys(maintTaskCharge)
    .filter(n => !maintCrew[n])
    .map(n => ({ name: n, amount: maintTaskCharge[n], tasks: maintTaskCount[n], dept: (people.filter(p => p.name === n)[0] || { dept: 'unrostered' as any }).dept }))
    .sort((a, b) => b.amount - a.amount)
  const outsideTotal = round2(billedOutsideCrew.reduce((a, x) => a + x.amount, 0))
  const maintAudit = {
    taskBillables: maintTaskBillables,          // every charge on a maintenance task, whoever closed it
    creditedToCrew: round2(maintTaskBillables - outsideTotal),
    billedOutsideCrew: outsideTotal,
    outsideDetail: billedOutsideCrew.slice(0, 8),
    note: 'maintenance-department tasks with a charge, split by whether the person is on the maintenance crew',
  }

  // hkRevenue is DEPARTURE-clean revenue, net of the channel's cut. Charged cleaning tasks are a
  // separate line (hkCharged) so they never move cost per clean, but they ARE added back into the
  // staff/all-in totals — the money is real, it just is not a turnover.
  const hkRevenue = round2(inHouseB.reduce((a, b) => a + b.cleaningRevenue, 0))
  const insp = byDept['inspection']
  const hkCharged = chargedCleanRevenue
  const staffRevenue = round2(hkRevenue + hkCharged + mt.cleaningRevenue + mt.billableRevenue + insp.billableRevenue)
  const staffPayroll = round2(hkPayrollInHouse + mt.payroll + insp.payroll)
  const hkAllRevenue = round2(hkRevenue + hkCharged)
  const kpi = {
    housekeeping: {
      cleans: hkCleansInHouse,                       // departure cleans only
      revenue: hkRevenue,                            // net departure-clean fees
      cleaningFees: hkRevenue,
      basisNote: 'departure cleans, net of the channel commission on the cleaning fee',
      // Gross guest cleaning fees before the OTA cut, so the difference is visible.
      revenueGross: cleaningGrossAll,
      channelCut: round2(Math.max(0, cleaningGrossAll - cleaningInhouse)),
      // Paid cleaning work that is NOT a turnover — mid-stays, linen refreshes, re-cleans.
      chargedCleans: hkCharged,
      chargedCleanCount,
      revenueWithCharged: hkAllRevenue,
      payroll: hkPayrollInHouse,
      hours: hkHoursInHouse,
      margin: round2(hkAllRevenue - hkPayrollInHouse),
      marginPct: pct(hkAllRevenue - hkPayrollInHouse, hkAllRevenue),
      laborPct: pct(hkPayrollInHouse, hkAllRevenue),
      costPerClean, hoursPerClean,
      revPerClean: hkCleansInHouse > 0 ? round2(hkRevenue / hkCleansInHouse) : null,
    },
    maintenance: {
      revenue: round2(mt.billableRevenue + mt.cleaningRevenue),
      billable: mt.billableRevenue,
      cleaningRevenue: mt.cleaningRevenue,
      payroll: mt.payroll,
      hours: mt.hours,
      margin: round2(mt.billableRevenue + mt.cleaningRevenue - mt.payroll),
      marginPct: pct(mt.billableRevenue + mt.cleaningRevenue - mt.payroll, mt.billableRevenue + mt.cleaningRevenue),
      laborPct: pct(mt.payroll, mt.billableRevenue + mt.cleaningRevenue),
      tasksBilled: mt.billableTasks,
      tasksNoCharge: mt.tasksNoCharge,
      // What maintenance WORK billed vs what the maintenance CREW was credited with. See maintAudit.
      taskBillables: maintAudit.taskBillables,
      billedOutsideCrew: maintAudit.billedOutsideCrew,
      outsideDetail: maintAudit.outsideDetail,
    },
    // Everyone whose pay should move with the work. Supervisors excluded on purpose.
    staff: {
      revenue: staffRevenue,
      payroll: staffPayroll,
      hours: round2(hkHoursInHouse + mt.hours + insp.hours),
      margin: round2(staffRevenue - staffPayroll),
      marginPct: pct(staffRevenue - staffPayroll, staffRevenue),
      laborPct: pct(staffPayroll, staffRevenue),
    },
    supervisors: {
      payroll: sup.payroll,
      hours: sup.hours,
      people: sup.people,
      names: sup.names,
      managementFee: round2(managementFee),
      pctOfManagementFee: pct(sup.payroll, managementFee),
      note: 'fixed cost — carried regardless of revenue',
    },
    // The whole labor line including the fixed layer, for the one number that hides nothing.
    allIn: {
      revenue: staffRevenue,
      payroll: round2(staffPayroll + sup.payroll),
      margin: round2(staffRevenue - staffPayroll - sup.payroll),
      marginPct: pct(staffRevenue - staffPayroll - sup.payroll, staffRevenue),
    },
  }

  // ── VENDOR UNITS WE TOUCHED OURSELVES ────────────────────────────────────
  // Jon, 2026-08-13: "identify when we clean a unit for vendors — need to know so we can allocate
  // those costs to us properly... and for invoice management, making sure vendors are charging
  // cleans properly."
  //
  // Two questions, one table:
  //   COST US    every job our own crew did inside a vendor-managed building. That is our wage
  //              bill on somebody else's unit, and it is invisible everywhere else because the
  //              vendor bucket carries no labor by design.
  //   OWED THEM  per building: how many checkouts actually needed a clean, and how many cleans
  //              the vendor logged against them. An invoice claiming more cleans than there were
  //              checkouts is the thing this is meant to catch.
  const buildingOf = (name: string): string | null => {
    for (const v of (presets.vendorBuildings || []) as VendorBuilding[]) {
      if (!v || !v.enabled) continue
      const terms = (v.terms || []).concat(v.wordTerms || [])
      for (const t of terms) {
        if (!t) continue
        const re = (v.wordTerms || []).indexOf(t) >= 0
          ? new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
          : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i')
        if (re.test(name)) return v.label
      }
    }
    return null
  }
  const onPayrollNames: Record<string, boolean> = {}
  for (const p of peopleAll) if (p.onPayroll) onPayrollNames[p.name] = true
  const deptByName: Record<string, Dept> = {}
  for (const p of peopleAll) deptByName[p.name] = p.dept

  const ourTasks: Array<{ date: string; unit: string; building: string; person: string; dept: string; task: string; kind: TaskKind; minutes: number | null; billed: number }> = []
  const vb: Record<string, { building: string; checkouts: number; cleaningRevenue: number; vendorCleansLogged: number; ourTasks: number; ourCleans: number; ourBilled: number }> = {}
  const vbFor = (b: string) => (vb[b] = vb[b] || { building: b, checkouts: 0, cleaningRevenue: 0, vendorCleansLogged: 0, ourTasks: 0, ourCleans: 0, ourBilled: 0 })

  for (const r of resRowsAll) {
    const li = lmap[String(r.listing_id)]
    if (!li || !li.vendor) continue
    const b = buildingOf(li.name) || 'Other vendor'
    const row = vbFor(b)
    row.checkouts++
    row.cleaningRevenue = round2(row.cleaningRevenue + (num(r.cleaning) ?? 0))
  }
  for (const t of taskRowsAll) {
    const li = lmap[String(t.reference_property_id)]
    if (!li || !li.vendor) continue
    const b = buildingOf(li.name) || 'Other vendor'
    const row = vbFor(b)
    const w = doer(t)
    const kind = kindOfTask(t)
    if (kind === 'clean') row.vendorCleansLogged++
    if (!w || !onPayrollNames[w]) continue     // the vendor's own crew — not our cost
    const ch = chargeOf(t)
    row.ourTasks++
    if (kind === 'clean') { row.ourCleans++; row.vendorCleansLogged-- }
    row.ourBilled = round2(row.ourBilled + ch.billable)
    ourTasks.push({
      date: String(t.finished_at || '').slice(0, 10),
      unit: li.name, building: b, person: w, dept: deptByName[w] || 'other',
      task: String(t.name || t.type_department || 'Task'), kind,
      minutes: num(t.total_minutes), billed: ch.billable,
    })
  }
  ourTasks.sort((a, b2) => String(b2.date).localeCompare(String(a.date)))
  const vendorWork = {
    ourTasks: ourTasks.slice(0, 200),
    ourTaskCount: ourTasks.length,
    ourCleanCount: ourTasks.filter(t => t.kind === 'clean').length,
    ourBilled: round2(ourTasks.reduce((a, t) => a + t.billed, 0)),
    // Time logged on these jobs is usually 0 in Breezeway, so an hours-based cost would be a
    // fiction. The count and what we charged are the facts; the wage cost is flagged, not guessed.
    ourMinutes: ourTasks.reduce((a, t) => a + (t.minutes || 0), 0),
    unbilled: ourTasks.filter(t => t.billed === 0).length,
    byBuilding: Object.keys(vb).map(b => vb[b]).sort((a, b2) => b2.checkouts - a.checkouts),
  }

  // ── THE LAYERS ───────────────────────────────────────────────────────────
  // Jon, 2026-08-12: "There are three layers: housekeeping labor; maintenance labor, that's just
  // Breezeway task cost; and maintenance can do cleans, so that would be in the cleaning revenue."
  // Each layer earns its own way, and they stack into the profit picture. Supervisors sit beside
  // them as fixed overhead — never inside the housekeeping layer.
  const layers = {
    housekeeping: {
      cleans: hkCleansInHouse,
      revenue: round2(inHouseB.reduce((a, b) => a + b.cleaningRevenue, 0)),
      payroll: hkPayrollInHouse,
      hours: hkHoursInHouse,
      margin: round2(inHouseB.reduce((a, b) => a + b.cleaningRevenue, 0) - hkPayrollInHouse),
      costPerClean, hoursPerClean,
    },
    maintenance: {
      // No cost per clean here, by design. Revenue is what they billed plus any real departure
      // clean they turned; the margin is that against their wages.
      cleaningRevenue: mt.cleaningRevenue,
      billableRevenue: mt.billableRevenue,
      revenue: round2(mt.cleaningRevenue + mt.billableRevenue),
      payroll: mt.payroll,
      hours: mt.hours,
      margin: mt.margin,
      marginPct: mt.marginPct,
      billableTasks: mt.billableTasks,
      tasksNoCharge: mt.tasksNoCharge,
    },
    supervision: {
      // Fixed overhead. Revenue still shows under their name when they turn a unit themselves,
      // it simply never enters the housekeeping bucket.
      people: sup.people, names: sup.names,
      payroll: sup.payroll, hours: sup.hours,
      cleaningRevenue: sup.cleaningRevenue, cleans: sup.cleans,
      managementFee: round2(managementFee),
      coveragePct: managementFee > 0 ? round2((sup.payroll / managementFee) * 100) : null,
    },
    vendor: {
      cleans: vendorCleans,
      revenue: round2(cleaningVendor),
      feePerClean: vendorCleans > 0 && cleaningVendor > 0 ? round2(cleaningVendor / vendorCleans) : null,
    },
  }

  return {
    from, to, market,
    people,
    departments: DEPTS.map(d => byDept[d]),
    buckets: bucketList,
    layers,
    kpi,
    maintAudit,
    vendorWork,
    cleans: cleansTotal,
    cleaningRevenue,
    // Gross guest cleaning fees before the channel took its cut, and the cut itself. Every margin
    // above runs on the NET number; these two exist so the difference is never invisible.
    cleaningRevenueGross: cleaningGrossAll,
    channelCut: round2(Math.max(0, cleaningGrossAll - cleaningInhouse)),
    cleaningRevenueAttributed: attributedRev,
    cleaningRevenueUnattributed: round2(cleaningRevenue - attributedRev),
    cleaningRevenueVendor: round2(cleaningVendor),
    billableRevenue,
    materials,
    managementFee: round2(managementFee),
    payroll,
    costPerClean,
    hoursPerClean,
    costPerCleanByMarket,
    hoursPerCleanByMarket,
    margin: round2(cleaningRevenue + billableRevenue - payroll),
    marginWithFee: round2(cleaningRevenue + billableRevenue + managementFee - payroll),
    // What the fee-to-clean window is missing, and by how many days.
    // EVERY CLEANING FEE, ACCOUNTED FOR. These four add up to the in-house total, so a number
    // that looks low can always be explained rather than argued about.
    feeAudit: {
      credited: round2(attributedRev),
      cleanNotClosed: round2(feesCleanNotClosed),
      cleanNoAssignee: round2(feesCleanNoAssignee),
      noCleanFound: round2(feesNoCleanFound),
      movedCleansMatched: movedCleans,
      movedOffsets,
      // The shortfall, split by booking channel — so a folio problem is never mistaken for a
      // missed clean. A channel that bundles its fees shows up here and nowhere else.
      noCleanBySource,
      notClosedBySource,
      noCleanExamples,
      window: 'checkout day or day+1 first, then nearest clean from 2 days early to 7 days late',
    },
    coverage: {
      cleansAttributed,
      cleansUnassigned: cleanTasks.filter(t => !doer(t)).length,
      tasksWithNoCharge: people.reduce((a, p) => a + p.tasksNoCharge, 0),
      billableTasks: people.reduce((a, p) => a + p.billableTasks, 0),
    },
  }
}
