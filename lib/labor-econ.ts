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
import { vendorRegex } from './ops-presets'
import { nameMatches, nameMatchesRoster } from './homebase'
import { getCrew, type Dept, DEPTS, DEPT_LABEL } from './crew'
import { resolveStaff } from './staffing'

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
  cleaningRevenue: number
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
  /** Operating margin on work we sell: cleaning + billable - all payroll. */
  margin: number
  /** With the management fee included — the whole labor line against everything labor earns. */
  marginWithFee: number
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
    .select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,total_minutes')
    .gte('finished_at', from).lte('finished_at', to + 'T23:59:59').range(a, b))
  const taskRows = taskRowsAll.filter(t => inMarketListing(t.reference_property_id))

  const ids = taskRows.map(t => String(t.id))
  const details: Record<string, any> = {}
  const adjs: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    if (!chunk.length) break
    try {
      const { data } = await sb.from('breezeway_billing_details').select('task_id,costs,supplies').in('task_id', chunk)
      for (const d of (data || []) as any[]) details[String(d.task_id)] = d
    } catch { /* a task with no detail simply carries no charge */ }
    try {
      const { data } = await sb.from('billing_adjustments').select('task_id,excluded,override_amount').in('task_id', chunk)
      for (const a of (data || []) as any[]) adjs[String(a.task_id)] = a
    } catch { /* overlay optional */ }
  }

  // WHAT WE CHARGED FOR THIS TASK — the cost field, as entered. Never derived from hours.
  const chargeOf = (t: any): { billable: number; materials: number } => {
    if (kindOfTask(t) === 'clean') return { billable: 0, materials: 0 }   // paid by the guest fee
    const a = adjs[String(t.id)]
    if (a && a.excluded) return { billable: 0, materials: 0 }
    if (a && a.override_amount != null) return { billable: Number(a.override_amount) || 0, materials: 0 }
    const d = details[String(t.id)]
    if (!d) return { billable: 0, materials: 0 }
    return { billable: round2(ownerTotal(d.costs, 'cost')), materials: round2(ownerTotal(d.supplies, 'supply')) }
  }

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
  const resRows = (await pageAll((a, b) => sb.from('guesty_reservations')
    .select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning,commission:raw->money->>commission')
    .gte('check_out', from).lte('check_out', to)
    .not('status', 'in', '("canceled","cancelled","declined")').range(a, b)))
    .filter(r => inMarketListing(r.listing_id))

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
  let cleansAttributed = 0, vendorCleans = 0
  for (const r of resRows) {
    const co = String(r.check_out).slice(0, 10)
    const coNext = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
    const li = lmap[String(r.listing_id)]
    const vendor = !!li?.vendor
    const fee = num(r.cleaning) ?? 0
    managementFee += num(r.commission) ?? 0
    if (vendor) {
      // VENDOR-CLEANED UNITS ARE THEIR OWN BUCKET (Jon, 2026-08-12). A checkout there needed a
      // clean and earned a fee, but no in-house hour went into it — so it carries revenue and a
      // clean count, and never a cost per clean.
      cleaningVendor += fee
      if (fee > 0) vendorCleans++
      continue
    }
    cleaningInhouse += fee
    const match = cleanTasks.filter(t => !usedTask[String(t.id)] &&
      String(t.reference_property_id) === String(r.listing_id) &&
      (String(t.finished_at).slice(0, 10) === co || String(t.finished_at).slice(0, 10) === coNext))[0]
    if (!match) continue
    usedTask[String(match.id)] = true
    const w = doer(match)
    if (!w) continue
    cleansAttributed++
    revBy[w] = round2((revBy[w] || 0) + fee)
    feeByTask[String(match.id)] = fee
  }

  // ── per person ───────────────────────────────────────────────────────────
  type Acc = PersonEcon & { _mk: Record<string, number> }
  const acc: Record<string, Acc> = {}
  const blank = (name: string): Acc => ({
    name, dept: 'other', declared: false, market: '', role: null,
    hours: 0, payroll: 0, wageRate: null, cleans: 0, cleaningRevenue: 0,
    billableRevenue: 0, materials: 0, tasks: 0, billableTasks: 0, tasksNoCharge: 0,
    revenue: 0, margin: 0, costPerClean: null, _mk: {},
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
    p.billableRevenue = round2(p.billableRevenue + ch.billable)
    p.materials = round2(p.materials + ch.materials)
    if (ch.billable > 0) p.billableTasks++
    else if (kind !== 'clean') p.tasksNoCharge++
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

  // crew + market per person, then the arithmetic
  for (const k of Object.keys(acc)) {
    const p = acc[k]
    // Fallback only bites for people nobody has named: what they actually did, cleans first.
    let guess: Dept | null = null
    if (p.cleans > 0) guess = 'housekeeping'
    else if (p.billableRevenue > 0) guess = 'maintenance'
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

  let people = Object.keys(acc).map(k => { const { _mk, ...rest } = acc[k]; return rest as PersonEcon })
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
  for (const p of people) if (p.dept === 'housekeeping') hkNames[p.name] = true

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
  if (market === 'all' || market === 'miami') bucketFor('miami')
  if (market === 'all' || market === 'broward') bucketFor('broward')

  // EVERY DEPARTURE CLEAN COMPLETED, AS A ROW: who did it, which market the unit is in, and the
  // fee if a checkout matched. Built from the Breezeway tasks — not from the matched checkouts —
  // so a clean that was genuinely done still counts in cost per clean even when the checkout
  // association fails. Counting only matched cleans made every clean look ~10% more expensive
  // than it is (94 of 103 matched in the week this was found).
  const cleanRecs = cleanTasks.map(t => {
    const li = lmap[String(t.reference_property_id)]
    const mk = li ? (li.vendor ? 'vendor-inhouse' : li.market) : 'unassigned'
    return { who: doer(t), market: mk, fee: feeByTask[String(t.id)] || 0 }
  }).filter(r => !!r.who) as { who: string; market: string; fee: number }[]

  // cleans + revenue, from the clean rows, housekeepers only
  const hkCleansByPerson: Record<string, Record<string, number>> = {}
  for (const rec of cleanRecs) {
    if (!hkNames[rec.who]) continue
    const b = bucketFor(rec.market)
    b.cleans++
    b.cleaningRevenue = round2(b.cleaningRevenue + rec.fee)
    hkCleansByPerson[rec.who] = hkCleansByPerson[rec.who] || {}
    hkCleansByPerson[rec.who][rec.market] = (hkCleansByPerson[rec.who][rec.market] || 0) + 1
  }
  // payroll + hours, split by each housekeeper's share of cleans per market
  const bucketNames: Record<string, Record<string, boolean>> = {}
  for (const p of people) {
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
  const bucketList = Object.keys(buckets)
    .sort((a, b) => (ORDER.indexOf(a) < 0 ? 8 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 8 : ORDER.indexOf(b)))
    .map(k => buckets[k])

  const hk = byDept['housekeeping']
  const sup = byDept['supervision']
  const mt = byDept['maintenance']
  const cleansTotal = people.reduce((a, p) => a + p.cleans, 0)
  // The headline cost per clean: housekeeper wages over the units housekeepers actually turned,
  // in-house markets only. Supervisors are not in it. Maintenance is not in it. Vendor is not in
  // it — nobody on our payroll cleaned those.
  const inHouseB = bucketList.filter(b => b.inHouse)
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
    cleans: cleansTotal,
    cleaningRevenue,
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
    coverage: {
      cleansAttributed,
      cleansUnassigned: cleanTasks.filter(t => !doer(t)).length,
      tasksWithNoCharge: people.reduce((a, p) => a + p.tasksNoCharge, 0),
      billableTasks: people.reduce((a, p) => a + p.billableTasks, 0),
    },
  }
}
