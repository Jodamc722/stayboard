// LABOR REPORT — one computation, two consumers (Jon, 2026-08-10).
//
//   "Send daily labor report to me every morning from the day before. It should be stand alone,
//    flag anything that's off, should be detailed, easy to read and have a live labor dashboard I
//    can click into at anytime... sort by date, week, month etc. Auto updates. For billables look
//    back 45 days and refreshes because updates can be made."
//
// The morning email and the /labor/dashboard page both call this, so an email can never disagree
// with the screen it links to. Everything here is computed for an arbitrary window; "yesterday" is
// just a one-day window.
//
// THE RULES THIS OBEYS, all learned the hard way on the other boards:
//   1. CLEANS ARE COUNTED FROM CHECKOUTS, not from closed Breezeway tasks. Newer staff do not
//      always close a task; a guest leaving is proof the unit needed cleaning. The closed-task
//      count is carried alongside so the compliance gap is visible rather than hidden.
//   2. COST PER CLEAN USES DEPARTURE CLEANS ONLY and HOUSEKEEPING WAGES ONLY. Common-area sweeps,
//      pool, trash and linen runs are housekeeping work but they are not turns, and maintenance
//      techs are not cleaners — mixing either in halves or doubles the number.
//   3. BILLABLE IS THE COST ENTERED ON THE BREEZEWAY TASK. Nothing derived (Jon, 2026-08-10:
//      "this needs to be actual cost in the Breezeway task"). An earlier version priced it as
//      logged-hours x the $40 owner rate, which read $4,312 for August against $2,345 actually
//      entered — the estimate was nearly double, because only 51 of 315 maintenance tasks carry a
//      billing entry and the time logged on them is often a single minute. The entered amount is
//      what the owner is actually charged, so it is the only number worth reporting.
//   4. BILLABLES ARE RE-READ OVER A ROLLING 45 DAYS. Billing detail gets edited after the fact, so
//      a number frozen on the day it was earned goes stale. BILLABLE_LOOKBACK_DAYS is that window.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getTimecards, type Timecard } from './homebase-labor'
import { getShifts, nameMatches, type Shift } from './homebase'
import { getLaborSettings, type LaborSettings } from './labor-settings'
import { computeYesterdayLabor, type YesterdayLabor } from './labor-daily'
import { billingRange } from './billing'
import { isDepartureCleanName } from './breezeway'
import { isLiveStay } from './stay-status'
import { marketOf } from './segments'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'

export const BILLABLE_LOOKBACK_DAYS = 45

const TZ = 'America/New_York'
const str = (v: any) => (v == null ? '' : String(v))
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
export const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
export const shiftDay = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymdET(d) }
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000)

export type Dept = 'housekeeping' | 'maintenance' | 'inspection' | 'other'
const DEPTS: Dept[] = ['housekeeping', 'maintenance', 'inspection', 'other']

/** Department from the Homebase role. The role is what payroll is actually charged against. */
export function deptOfRole(role: any): Dept {
  const s = String(role || '').toLowerCase()
  if (/inspect|audit|quality/.test(s)) return 'inspection'
  if (/clean|housekeep|turn/.test(s)) return 'housekeeping'
  if (/maint|tech|repair|handy/.test(s)) return 'maintenance'
  return 'other'
}
/** Task kind, used for the work mix and for pricing billable labor. */
export function kindOfTask(t: any): 'departure' | 'otherClean' | 'inspection' | 'maintenance' | 'other' {
  const dep = String(t.department || '').toLowerCase()
  const nm = String(t.name || '')
  const both = dep + ' ' + nm.toLowerCase()
  if (/inspect|audit|quality/.test(both)) return 'inspection'
  if (/maint|repair|handy/.test(dep)) return 'maintenance'
  if (isDepartureCleanName(nm)) return 'departure'
  if (/clean|housekeep|turn/.test(both)) return 'otherClean'
  return 'other'
}

/** Homebase rejects wide date ranges, so anything long is pulled in ≤28-day chunks and stitched. */
export async function timecardsRange(from: string, to: string): Promise<Timecard[]> {
  const out: Timecard[] = []
  let cur = from
  while (cur <= to) {
    const end = daysBetween(cur, to) > 27 ? shiftDay(cur, 27) : to
    try { out.push(...await getTimecards(cur, end)) } catch { /* that chunk is missing, rest still reports */ }
    cur = shiftDay(end, 1)
  }
  return out
}

export type PersonRow = {
  name: string; role: string | null; dept: Dept
  hours: number; overtime: number; payroll: number; days: number
  cleans: number                  // departure cleans they closed in Breezeway
  tasks: number                   // every task they closed
  taskHours: number               // time logged on those tasks
  coveragePct: number | null      // task time as a share of clocked time
  costPerClean: number | null
}

export type Flag = {
  level: 'red' | 'amber'
  kind: string
  title: string
  detail: string
  people?: string[]
}

export type LaborReport = {
  from: string; to: string; days: number
  label: string
  generatedAt: string

  // payroll, split by the department the wage is charged to
  totals: { hours: number; overtime: number; payroll: number; people: number }
  byDept: Record<Dept, { hours: number; payroll: number; people: number }>

  // the work that got done
  checkouts: number              // in-house checkouts = cleans owed
  vendorCheckouts: number
  departureClosed: number        // departure cleans closed in Breezeway
  mix: Record<string, { tasks: number; hours: number; materials: number }>

  // the money
  cleaningRevenue: number
  costPerClean: number | null
  hoursPerClean: number | null
  feePerClean: number | null
  cleaningMargin: number | null
  cleaningMarginPct: number | null
  laborPctOfRevenue: number | null
  band: 'on_target' | 'watch' | 'over' | 'no_data'

  // billables, re-read over a rolling window because they get edited after the fact
  billable: {
    from: string; to: string; days: number
    billed: number            // MEASURED: what was entered against the tasks in Breezeway
    tasks: number             // billable-department tasks in the window
    tasksWithBilling: number  // how many of them actually carry an amount
    tasksMissingDetail: number
    hours: number             // time logged on them, for context only — never priced
    maintenancePayroll: number
    margin: number
  }

  people: PersonRow[]
  yesterday: YesterdayLabor | null   // schedule-based flags, only for short windows
  flags: Flag[]
  settings: LaborSettings
}

export async function buildLaborReport(from: string, to: string): Promise<LaborReport> {
  const db = supabaseAdmin()
  const days = daysBetween(from, to) + 1
  const settings = await getLaborSettings('default')

  // ---- payroll ----------------------------------------------------------------
  const timecards = await timecardsRange(from, to)

  // ---- the work, from the billing pull so line items come with it -------------
  const tasks = (await billingRange(from, to)).tasks.filter((t: any) => {
    const d = str(t.finishedAt || t.scheduledDate).slice(0, 10)
    return !!d && d >= from && d <= to
  })

  // ---- checkouts = cleans owed ------------------------------------------------
  const presets = await getOpsPresets()
  const VEN = vendorRegex(presets.vendorBuildings)
  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000)
  const lmap: Record<string, { name: string; vendor: boolean; market: string }> = {}
  for (const l of ((lRows || []) as any[])) {
    const nm = l.nickname || l.title || String(l.id)
    lmap[String(l.id)] = {
      name: nm,
      vendor: VEN.test(str(l.building)) || VEN.test(nm),
      market: String(marketOf(l.building, l.address_city, nm) || 'Miami'),
    }
  }
  const { data: rRows } = await db.from('guesty_reservations')
    .select('listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
    .gte('check_out', from).lte('check_out', to).limit(4000)
  let checkouts = 0, vendorCheckouts = 0, cleaningRevenue = 0
  for (const r of ((rRows || []) as any[])) {
    if (!isLiveStay(r.status)) continue
    const li = lmap[String(r.listing_id)]
    if (li && li.vendor) { vendorCheckouts++; continue }
    checkouts++
    const fee = Number(r.cleaning)
    if (Number.isFinite(fee)) cleaningRevenue += fee
  }

  // ---- work mix ---------------------------------------------------------------
  const ownerItems = (t: any) => ((t.items || []) as any[])
    .reduce((a, i) => a + (String(i.bill_to || 'owner') === 'guest' ? 0 : (Number(i.amount) || 0)), 0)
  const mix: LaborReport['mix'] = {}
  for (const k of ['departure', 'otherClean', 'inspection', 'maintenance', 'other']) mix[k] = { tasks: 0, hours: 0, materials: 0 }
  for (const t of tasks as any[]) {
    const e = mix[kindOfTask(t)]
    e.tasks += 1
    e.hours += (Number(t.actualMinutes) || 0) / 60
    e.materials += ownerItems(t)
  }
  for (const k of Object.keys(mix)) { mix[k].hours = r1(mix[k].hours); mix[k].materials = r2(mix[k].materials) }
  const departureClosed = mix.departure.tasks

  // ---- payroll by department --------------------------------------------------
  const byDept = {} as LaborReport['byDept']
  for (const d of DEPTS) byDept[d] = { hours: 0, payroll: 0, people: 0 }
  const seenByDept: Record<Dept, Set<string>> = {
    housekeeping: new Set(), maintenance: new Set(), inspection: new Set(), other: new Set(),
  }
  for (const t of timecards) {
    const d = deptOfRole(t.role)
    byDept[d].hours += t.hours ?? 0
    byDept[d].payroll += t.laborCost ?? 0
    if (t.name) seenByDept[d].add(t.name)
  }
  for (const d of DEPTS) { byDept[d].hours = r1(byDept[d].hours); byDept[d].payroll = r2(byDept[d].payroll); byDept[d].people = seenByDept[d].size }

  const totals = {
    hours: r1(timecards.reduce((a, t) => a + (t.hours ?? 0), 0)),
    overtime: r1(timecards.reduce((a, t) => a + (t.overtimeHours ?? 0), 0)),
    payroll: r2(timecards.reduce((a, t) => a + (t.laborCost ?? 0), 0)),
    people: new Set(timecards.map(t => t.name).filter(Boolean)).size,
  }

  // ---- per person -------------------------------------------------------------
  const nameOfAny = (v: any): string => {
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object') return str(v.name || v.full_name || [v.first_name, v.last_name].filter(Boolean).join(' '))
    return ''
  }
  const doersOf = (t: any): string[] => Array.from(new Set(
    ([] as any[]).concat(Array.isArray(t.assignees) ? t.assignees : []).concat([t.finishedBy])
      .map(nameOfAny).filter(Boolean)))

  const byName: Record<string, PersonRow> = {}
  for (const t of timecards) {
    const n = str(t.name); if (!n) continue
    const row = byName[n] = byName[n] || {
      name: n, role: (t.role as any) ?? null, dept: deptOfRole(t.role),
      hours: 0, overtime: 0, payroll: 0, days: 0,
      cleans: 0, tasks: 0, taskHours: 0, coveragePct: null, costPerClean: null,
    }
    row.hours += t.hours ?? 0
    row.overtime += t.overtimeHours ?? 0
    row.payroll += t.laborCost ?? 0
    row.days += 1
    if (!row.role && t.role) { row.role = t.role as any; row.dept = deptOfRole(t.role) }
  }
  // Credit BOTH the assignee and whoever actually closed it — Jon, 2026-08-08: "sometimes HK is not
  // assigned to a clean in Breezeway but it's closed by another team member".
  for (const t of tasks as any[]) {
    const kind = kindOfTask(t)
    const mins = Number(t.actualMinutes) || 0
    for (const d of doersOf(t)) {
      const hit = Object.keys(byName).find(n => nameMatches(d, n))
      if (!hit) continue
      byName[hit].tasks += 1
      byName[hit].taskHours += mins / 60
      if (kind === 'departure') byName[hit].cleans += 1
    }
  }
  const people = Object.values(byName).map(p => ({
    ...p,
    hours: r1(p.hours), overtime: r1(p.overtime), payroll: r2(p.payroll), taskHours: r1(p.taskHours),
    coveragePct: p.hours > 0 ? Math.round((p.taskHours / p.hours) * 100) : null,
    costPerClean: p.cleans > 0 && p.payroll > 0 ? r2(p.payroll / p.cleans) : null,
  })).sort((a, b) => b.payroll - a.payroll)

  // ---- the cleaning money -----------------------------------------------------
  const hkPayroll = byDept.housekeeping.payroll
  const hkHours = byDept.housekeeping.hours
  const costPerClean = checkouts > 0 && hkPayroll > 0 ? r2(hkPayroll / checkouts) : null
  const hoursPerClean = checkouts > 0 && hkHours > 0 ? r1(hkHours / checkouts) : null
  const feePerClean = checkouts > 0 && cleaningRevenue > 0 ? r2(cleaningRevenue / checkouts) : null
  const cleaningMargin = hkPayroll > 0 ? r2(cleaningRevenue - hkPayroll) : null
  const cleaningMarginPct = (cleaningMargin != null && cleaningRevenue > 0)
    ? Math.round((cleaningMargin / cleaningRevenue) * 1000) / 10 : null
  const laborPctOfRevenue = (cleaningRevenue > 0 && hkPayroll > 0)
    ? Math.round((hkPayroll / cleaningRevenue) * 1000) / 10 : null
  const band: LaborReport['band'] = laborPctOfRevenue == null ? 'no_data'
    : laborPctOfRevenue <= Number(settings.pct_good) ? 'on_target'
    : laborPctOfRevenue <= Number(settings.pct_bad) ? 'watch' : 'over'

  // ---- billables over the rolling lookback ------------------------------------
  // Deliberately NOT the report window. Owner billing detail is edited days after the work, so a
  // one-day slice of it is always wrong and always low. Re-read every time, so a correction made
  // this morning to a task from five weeks ago shows up this morning.
  const bFrom = shiftDay(to, -(BILLABLE_LOOKBACK_DAYS - 1))
  let billable = {
    from: bFrom, to, days: BILLABLE_LOOKBACK_DAYS,
    billed: 0, tasks: 0, tasksWithBilling: 0, tasksMissingDetail: 0,
    hours: 0, maintenancePayroll: 0, margin: 0,
  }
  try {
    const look = await billingRange(bFrom, to)
    const lookTasks = look.tasks.filter((t: any) => {
      const d = str(t.finishedAt || t.scheduledDate).slice(0, 10)
      return !!d && d >= bFrom && d <= to
    })
    const billableTasks = lookTasks.filter((t: any) => {
      const k = kindOfTask(t); return k === 'maintenance' || k === 'inspection'
    })
    const bCards = await timecardsRange(bFrom, to)
    const billed = billableTasks.reduce((a: number, t: any) => a + ownerItems(t), 0)
    billable = {
      from: bFrom, to, days: BILLABLE_LOOKBACK_DAYS,
      billed: r2(billed),
      tasks: billableTasks.length,
      tasksWithBilling: billableTasks.filter((t: any) => ownerItems(t) > 0).length,
      tasksMissingDetail: lookTasks.filter((t: any) => !t.hasDetail).length,
      hours: r1(billableTasks.reduce((a: number, t: any) => a + (Number(t.actualMinutes) || 0), 0) / 60),
      maintenancePayroll: r2(bCards.filter(t => deptOfRole(t.role) === 'maintenance').reduce((a, t) => a + (t.laborCost ?? 0), 0)),
      margin: 0,
    }
    billable.margin = r2(billable.billed - billable.maintenancePayroll)
  } catch { /* billables absent rather than the whole report failing */ }

  // ---- schedule-based flags (short windows only — getShifts is one call per day) ----
  let yesterday: YesterdayLabor | null = null
  if (days <= 7) {
    try {
      const shifts: Shift[] = []
      for (let i = 0; i < days; i++) {
        try { shifts.push(...await getShifts(shiftDay(from, i), TZ)) } catch { /* skip that day */ }
      }
      yesterday = computeYesterdayLabor(to, shifts, timecards, settings, TZ)
    } catch { /* flags degrade, numbers stand */ }
  }

  // ---- WHAT LOOKS OFF ---------------------------------------------------------
  // Ordered by how much money or trust is at stake, not by how easy it is to compute. Every flag
  // names the people involved, because "3 people did X" is a statistic and a list is a task.
  const flags: Flag[] = []
  if (yesterday) {
    if (yesterday.noShows.length) flags.push({
      level: 'red', kind: 'no_show',
      title: yesterday.noShows.length + ' scheduled ' + (yesterday.noShows.length === 1 ? 'shift' : 'shifts') + ' with no clock-in',
      detail: 'Scheduled in Homebase but never clocked in. Either the work did not happen or it happened off the clock.',
      people: yesterday.noShows.map(n => n.name + ' (' + n.shiftStart + ')'),
    })
    if (yesterday.missedClockOuts.length) flags.push({
      level: 'red', kind: 'open_shift',
      title: yesterday.missedClockOuts.length + ' never clocked out',
      detail: 'Clocked in and no clock-out on the card. For a day that has already ended this is always a missed punch, not someone still working — and until it is corrected their hours and cost are understated, so every figure on this report is low.',
      people: yesterday.missedClockOuts,
    })
    if (yesterday.overSchedule.length) flags.push({
      level: 'amber', kind: 'over_schedule',
      title: yesterday.overSchedule.length + ' went over scheduled hours',
      detail: 'Worked materially longer than the shift they were given.',
      people: yesterday.overSchedule.map(o => o.name + ' +' + o.overByHours + 'h (' + o.scheduledHours + 'h scheduled, ' + o.actualHours + 'h worked)'),
    })
    if (yesterday.lateClockIns.length) flags.push({
      level: 'amber', kind: 'late',
      title: yesterday.lateClockIns.length + ' clocked in late',
      detail: 'Past the ' + settings.grace_min + '-minute grace window.',
      people: yesterday.lateClockIns.map(l => l.name + ' ' + l.minutesLate + ' min (shift ' + l.shiftStart + ', in ' + l.clockIn + ')'),
    })
  }
  if (totals.overtime > 0) flags.push({
    level: totals.overtime >= 8 ? 'red' : 'amber', kind: 'overtime',
    title: r1(totals.overtime) + ' hours of overtime',
    detail: 'Overtime is the most expensive hour we buy. Worth checking whether the schedule or a no-show caused it.',
    people: people.filter(p => p.overtime > 0).map(p => p.name + ' +' + p.overtime + 'h'),
  })
  // Cleaners with no timecard: either a vendor (fine) or a name mismatch between the two systems
  // (not fine — their hours are missing and every cost-per-clean here is too low).
  const clockedNames = new Set(timecards.map(t => str(t.name)).filter(Boolean))
  const noCard: string[] = []
  for (const t of tasks as any[]) {
    if (kindOfTask(t) !== 'departure') continue
    for (const d of doersOf(t)) {
      if (Array.from(clockedNames).some(n => nameMatches(d, n))) continue
      if (!noCard.includes(d)) noCard.push(d)
    }
  }
  if (noCard.length) flags.push({
    level: 'amber', kind: 'no_timecard',
    title: noCard.length + ' cleaned with no Homebase timecard',
    detail: 'Either an outside contractor (correct, no payroll of ours) or a name that does not match between Homebase and Breezeway — in which case their hours are missing and the cost per clean below is too low.',
    people: noCard.slice(0, 12),
  })
  if (checkouts > 0 && departureClosed < checkouts) flags.push({
    level: (checkouts - departureClosed) / checkouts > 0.25 ? 'red' : 'amber', kind: 'unclosed',
    title: (checkouts - departureClosed) + ' turns never closed in Breezeway',
    detail: departureClosed + ' departure cleans were closed against ' + checkouts + ' in-house checkouts. The cleans happened — a guest left — but the paperwork did not, so task-based reporting understates the work.',
  })
  if (band === 'over') flags.push({
    level: 'red', kind: 'labor_pct',
    title: 'Labor at ' + laborPctOfRevenue + '% of cleaning revenue',
    detail: 'Over the ' + settings.pct_bad + '% ceiling (goal is ' + settings.pct_good + '% or less). Housekeeping wages only, against guest cleaning fees.',
  })
  else if (band === 'watch') flags.push({
    level: 'amber', kind: 'labor_pct',
    title: 'Labor at ' + laborPctOfRevenue + '% of cleaning revenue',
    detail: 'Above the ' + settings.pct_good + '% goal but under the ' + settings.pct_bad + '% ceiling.',
  })
  // Someone clocked a full day and closed nothing at all.
  const idle = people.filter(p => p.hours >= 4 && p.tasks === 0 && p.dept !== 'other')
  if (idle.length) flags.push({
    level: 'amber', kind: 'no_tasks',
    title: idle.length + ' clocked 4h+ with no task closed',
    detail: 'They may have been on work that lives outside Breezeway, or their tasks are being closed under someone else’s name.',
    people: idle.map(p => p.name + ' ' + p.hours + 'h'),
  })
  const unbilled = billable.tasks - billable.tasksWithBilling
  if (unbilled > 0) flags.push({
    level: unbilled > billable.tasksWithBilling ? 'red' : 'amber', kind: 'unbilled',
    title: unbilled + ' billable tasks carry no cost',
    detail: 'Of ' + billable.tasks + ' maintenance and inspection tasks in the last ' + BILLABLE_LOOKBACK_DAYS
      + ' days, only ' + billable.tasksWithBilling + ' have an amount entered in Breezeway. The rest bill the owner nothing, '
      + 'which is the single biggest reason the maintenance margin reads negative.'
      + (billable.tasksMissingDetail ? ' ' + billable.tasksMissingDetail + ' of them have not had their billing detail pulled from Breezeway yet.' : ''),
  })
  flags.sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1))

  const label = days === 1
    ? new Date(from + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })
    : new Date(from + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
      + ' – ' + new Date(to + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })

  return {
    from, to, days, label, generatedAt: new Date().toISOString(),
    totals, byDept,
    checkouts, vendorCheckouts, departureClosed, mix,
    cleaningRevenue: r2(cleaningRevenue),
    costPerClean, hoursPerClean, feePerClean, cleaningMargin, cleaningMarginPct,
    laborPctOfRevenue, band,
    billable, people, yesterday, flags, settings,
  }
}
