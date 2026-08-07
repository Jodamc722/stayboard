// app/api/labor/kpi/route.ts  (v5)
//
//   GET /api/labor/kpi?days=7&market=all|miami|broward|north
//   GET /api/labor/kpi?from=2026-08-01&to=2026-08-07&market=miami
//   (from=to=YYYY-MM-DD gives a single-day view)
//
// v5 adds:
//   - custom from/to range (overrides days)
//   - parallel Homebase day fetches (was serial — ~28s, now a few seconds)
//   - payroll block: actual payroll (timecards labor.costs) + scheduled payroll
//     (shifts labor.scheduled_costs) vs revenue, with labor % banding
//   - today block for in-day decisions: clocked-in-now, payroll accrued today,
//     scheduled payroll today, cleaning revenue today
//   - personTasks: every person's Breezeway tasks in the window (unit, task,
//     dept, date, minutes, pay) for the drill-down

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getShifts, nameMatches, type Shift } from '@/lib/homebase'
import { getTimecards, computeLaborKpis } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { laborAmount } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5)
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function currentWorkweek(now: Date, weekStart: 'sunday' | 'monday') {
  const localDow = new Date(now.toLocaleString('en-US', { timeZone: TZ })).getDay()
  const offset = weekStart === 'sunday' ? localDow : (localDow + 6) % 7
  return { start: dISO(addDays(now, -offset)), end: dISO(addDays(now, 6 - offset)) }
}

async function pageAll(q: (a: number, b: number) => any, pages = 5): Promise<any[]> {
  const out: any[] = []
  for (let p = 0; p < pages; p++) {
    const { data } = await q(p * 1000, p * 1000 + 999)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function shiftsForRange(start: string, end: string): Promise<(Shift & { date: string })[]> {
  const dates: string[] = []
  for (let d = new Date(start + 'T12:00:00Z'); dISO(d) <= end; d = addDays(d, 1)) dates.push(dISO(d))
  const perDay = await Promise.all(dates.map(async date => {
    try { return (await getShifts(date, TZ)).map(x => ({ ...x, date })) } catch { return [] }
  }))
  const all: (Shift & { date: string })[] = []
  for (const day of perDay) all.push(...day)
  return all
}

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const now = new Date()
  const today = dISO(now)
  const marketParam = String(url.searchParams.get('market') || 'all').toLowerCase()
  const fromQ = url.searchParams.get('from') || ''
  const toQ = url.searchParams.get('to') || ''
  let start: string, end: string
  if (DATE_RE.test(fromQ) && DATE_RE.test(toQ) && fromQ <= toQ) {
    start = fromQ; end = toQ > today ? today : toQ
    if (start > end) start = end
  } else {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7))
    start = dISO(addDays(now, -(days - 1))); end = today
  }

  try {
    const settings = await getLaborSettings(marketParam === 'all' ? 'default' : marketParam)
    const weekStart = ((settings as any).week_start === 'monday' ? 'monday' : 'sunday') as 'sunday' | 'monday'
    const week = currentWorkweek(now, weekStart)
    const sb = supabaseAdmin()
    // Same rule as the ops board: vendor-cleaned buildings (operator-editable in /users -> Ops presets)
    // live in the vendor bucket, not inside their geographic market's numbers.
    const presets = await getOpsPresets()
    const VENDOR_RE = vendorRegex(presets.vendorBuildings)
    // Supervisors / hybrid roles (Jon 2026-08-07): excluded from the per-cleaner
    // rankings; still counted in dept payroll so cost-per-clean stays fully loaded.
    // Override by adding a `supervisors` text column to labor_settings (comma-separated).
    const SUP_NAMES = String((settings as any).supervisors || 'Ernesto Torres,Yoslenis Rodriguez,Roberto Chiriboga,Guillermo Hernandez')
      .split(',').map(s => s.trim()).filter(Boolean)
    const isSupervisor = (n: string) => SUP_NAMES.some(s => nameMatches(s, n))

    const [dayShifts, timecards, weekShifts, listingRows] = await Promise.all([
      shiftsForRange(start, end),
      getTimecards(start, end),
      shiftsForRange(week.start, week.end),
      pageAll((a, b) => sb.from('guesty_listings')
        .select('id,nickname,title,building,address_city').range(a, b)),
    ])

    const lmap: Record<string, { market: string; name: string; vendor: boolean }> = {}
    for (const l of listingRows) {
      const name = l.nickname || l.title || 'Unit'
      const vendor = VENDOR_RE.test(String(l.building || '')) || VENDOR_RE.test(String(name))
      lmap[String(l.id)] = { market: vendor ? 'vendor' : marketOf(l.building, l.address_city, name).toLowerCase(), name, vendor }
    }
    const marketFilter = (listingId: any) =>
      marketParam === 'all' || (lmap[String(listingId)]?.market === marketParam)

    // ---- Tasks in window ---------------------------------------------------
    const taskRows = (await pageAll((a, b) => sb.from('breezeway_tasks_sync')
      .select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,rate_paid,total_minutes')
      .gte('finished_at', start).lte('finished_at', end + 'T23:59:59')
      .range(a, b)))
      .filter(t => marketFilter(t.reference_property_id))

    const classify = (t: any): 'clean' | 'inspection' | 'maintenance' | 'other' => {
      const s = `${t.type_department || ''} ${t.name || ''}`.toLowerCase()
      if (/clean|housekeep|turn/.test(s)) return 'clean'
      if (/inspect|walk/.test(s)) return 'inspection'
      if (/maint|repair|fix|hvac|plumb|electric|pest/.test(s)) return 'maintenance'
      return 'other'
    }
    const doer = (t: any): string | null => t.assignee_name || t.finished_by_name || null

    const tasks = { clean: 0, inspection: 0, maintenance: 0, other: 0, total: 0 }
    const cleanTasks: any[] = []
    for (const t of taskRows) {
      const c = classify(t)
      ;(tasks as any)[c]++; tasks.total++
      if (c === 'clean') cleanTasks.push(t)
    }
    const cleaningTaskPay = round2(cleanTasks.reduce((a, t) => a + (num(t.rate_paid) ?? 0), 0))

    // ---- Checkouts + cleaning fees ----------------------------------------
    const resRows = (await pageAll((a, b) => sb.from('guesty_reservations')
      .select('id,listing_id,check_out,status,cleaning:raw->money->>fareCleaning')
      .gte('check_out', start).lte('check_out', end)
      .not('status', 'in', '("canceled","cancelled","declined")')
      .range(a, b)))
      .filter(r => marketFilter(r.listing_id))

    // ---- Attribution join --------------------------------------------------
    const usedTask = new Set<string>()
    type Attr = { fee: number | null; assignee: string | null; checkOut: string; vendor: boolean }
    const attributions: Attr[] = []
    for (const r of resRows) {
      const co = String(r.check_out).slice(0, 10)
      const coNext = dISO(addDays(new Date(co + 'T12:00:00Z'), 1))
      const match = cleanTasks.find(t =>
        !usedTask.has(String(t.id)) &&
        String(t.reference_property_id) === String(r.listing_id) &&
        [co, coNext].includes(String(t.finished_at).slice(0, 10))
      )
      if (match) usedTask.add(String(match.id))
      attributions.push({ fee: num(r.cleaning), assignee: match ? doer(match) : null, checkOut: co, vendor: !!lmap[String(r.listing_id)]?.vendor })
    }

    const totalFees = round2(attributions.reduce((a, x) => a + (x.fee ?? 0), 0))
    // In-house vs vendor cleaning revenue — in-house margins are what we manage.
    const inhouseFees = round2(attributions.filter(x => !x.vendor).reduce((a, x) => a + (x.fee ?? 0), 0))
    const vendorFees = round2(totalFees - inhouseFees)
    const attributed = attributions.filter(x => x.assignee && x.fee != null)
    const attributedFees = round2(attributed.reduce((a, x) => a + (x.fee as number), 0))

    // ---- Per-cleaner + person task detail ---------------------------------
    const personNames = new Set<string>()
    taskRows.forEach(t => { const d = doer(t); if (d) personNames.add(d) })
    timecards.forEach(t => personNames.add(t.name))

    const personTasks: Record<string, any[]> = {}
    for (const name of Array.from(personNames)) {
      const mine = taskRows.filter(t => doer(t) && nameMatches(doer(t) as string, name))
      if (mine.length) personTasks[name] = mine
        .sort((a, b) => String(a.finished_at).localeCompare(String(b.finished_at)))
        .map(t => ({
          date: String(t.finished_at).slice(0, 10),
          unit: lmap[String(t.reference_property_id)]?.name || String(t.reference_property_id || 'Unknown'),
          task: t.name || t.type_department || 'Task',
          kind: classify(t),
          minutes: num(t.total_minutes),
          pay: num(t.rate_paid),
        }))
    }

    const cleanerNames = (Array.from(new Set(cleanTasks.map(t => doer(t)).filter(Boolean))) as string[])
      .filter(n => !isSupervisor(n))   // supervisors/hybrids are not ranked as cleaners
    const perCleaner = cleanerNames.map(name => {
      const myTasks = cleanTasks.filter(t => doer(t) && nameMatches(doer(t) as string, name))
      const myPay = round2(myTasks.reduce((a, t) => a + (num(t.rate_paid) ?? 0), 0))
      const mine = attributed.filter(x => nameMatches(x.assignee as string, name))
      const revenue = round2(mine.reduce((a, x) => a + (x.fee as number), 0))
      const myCards = timecards.filter(t => nameMatches(t.name, name))
      const payroll = round2(myCards.reduce((a, t) => a + (t.laborCost ?? 0), 0))
      const hours = round2(myCards.reduce((a, t) => a + (t.hours ?? 0), 0))
      const cost = payroll > 0 ? payroll : myPay
      return {
        name, cleans: myTasks.length, checkoutsAttributed: mine.length,
        revenueGenerated: revenue, taskPay: myPay, payroll, hours,
        margin: round2(revenue - cost),
        revenuePerLaborDollar: cost > 0 ? round2(revenue / cost) : null,
        avgFeePerClean: mine.length ? round2(revenue / mine.length) : null,
      }
    }).sort((a, b) => (b.revenuePerLaborDollar ?? -1) - (a.revenuePerLaborDollar ?? -1))

    // ---- Reconciliation ----------------------------------------------------
    const unattributed = {
      feesWithNoMatchedClean: round2(
        attributions.filter(x => x.fee != null && !x.assignee).reduce((a, x) => a + (x.fee as number), 0)),
      checkoutsWithNoFeeData: attributions.filter(x => x.fee == null).length,
      cleansWithNoAssignee: cleanTasks.filter(t => !doer(t)).length,
      cleansWithNoMatchedCheckout: cleanTasks.filter(t => !usedTask.has(String(t.id))).length,
    }
    const attribution = {
      totalCleaningRevenue: totalFees,
      attributedRevenue: attributedFees,
      rate: totalFees > 0 ? round2(attributedFees / totalFees) : 0,
      reliable: totalFees > 0 && attributedFees / totalFees >= (Number(settings.attribution_min) || 0.85),
    }

    // ---- Homebase hours/OT (workweek-aligned) ------------------------------
    const kpis = computeLaborKpis({
      start, end, shifts: dayShifts, timecards, weekShifts,
      cleansCompleted: tasks.clean || null, occupiedNights: null,
      todayISO: now.toISOString(),
      otWeeklyHours: Number(settings.ot_weekly_hours) || 40,
      weekStartDate: week.start,
    } as any)

    // ---- Payroll vs revenue ------------------------------------------------
    const scheduledCost = round2(dayShifts.reduce((a, s: any) => a + (s.scheduledCost ?? 0), 0))
    const payrollTotal = kpis.totalLaborCost ?? 0
    const laborPct = inhouseFees > 0 && payrollTotal > 0 ? round2((payrollTotal / inhouseFees) * 100) : null
    const band = laborPct == null ? 'no_data'
      : laborPct <= Number(settings.pct_good) ? 'on_target'
      : laborPct <= Number(settings.pct_bad) ? 'watch' : 'over'
    const payroll = {
      actual: payrollTotal,
      scheduled: scheduledCost,
      revenue: totalFees,
      revenueInhouse: inhouseFees,
      revenueVendor: vendorFees,
      laborPct, band,
      goalPct: Number(settings.pct_good),
      note: 'payroll = Homebase timecard costs; labor % measured against in-house cleaning fees (vendor-cleaned units excluded)',
    }

    // ---- Today (in-day decisions) -----------------------------------------
    const tcToday = timecards.filter(t => t.date === today)
    const shToday = dayShifts.filter((s: any) => s.date === today)
    const todayBlock = (start <= today && today <= end) ? {
      date: today,
      clockedInNow: Array.from(new Set(tcToday.filter(t => t.open).map(t => t.name))),
      hoursSoFar: round2(tcToday.reduce((a, t) => a + (t.hours ?? 0), 0)),
      payrollSoFar: round2(tcToday.reduce((a, t) => a + (t.laborCost ?? 0), 0)),
      scheduledPayroll: round2(shToday.reduce((a: number, s: any) => a + (s.scheduledCost ?? 0), 0)),
      cleaningRevenueToday: round2(attributions.filter(x => x.checkOut === today).reduce((a, x) => a + (x.fee ?? 0), 0)),
      tasksDoneToday: taskRows.filter(t => String(t.finished_at).slice(0, 10) === today).length,
    } : null

    const economics = {
      cleaningRevenue: totalFees,
      cleaningRevenueInhouse: inhouseFees,
      cleaningRevenueVendor: vendorFees,
      cleaningLaborCost: cleaningTaskPay > 0 ? cleaningTaskPay : payrollTotal,
      cleaningMargin: round2(inhouseFees - (cleaningTaskPay > 0 ? cleaningTaskPay : payrollTotal)),
      revenuePerLaborDollar: payrollTotal > 0 ? round2(inhouseFees / payrollTotal) : null,
      costBasis: cleaningTaskPay > 0 ? 'breezeway rate_paid' : 'homebase payroll',
    }

    // ---- Department economics: housekeeping vs maintenance ----------------
    const deptOf = (r: string | null) => {
      const s = (r || '').toLowerCase()
      if (/clean|housekeep|turn/.test(s)) return 'housekeeping'
      if (/maint|tech|repair|handy/.test(s)) return 'maintenance'
      return 'other'
    }
    // Fallback: when the Homebase role doesn't identify a department,
    // classify the person by what they actually did in Breezeway this window.
    const deptOfPerson = (name: string, role: string | null) => {
      const byRole = deptOf(role)
      if (byRole !== 'other') return byRole
      let m = 0, c = 0
      for (const t of taskRows) {
        const d = doer(t)
        if (!d || !nameMatches(d, name)) continue
        const k = classify(t)
        if (k === 'maintenance') m++
        else if (k === 'clean' || k === 'inspection') c++
      }
      if (!m && !c) return 'other'
      return m > c ? 'maintenance' : 'housekeeping'
    }
    const agg: Record<string, { hours: number; payroll: number; people: Set<string> }> = {}
    for (const t of timecards) {
      const k = deptOfPerson(t.name, t.role)
      agg[k] = agg[k] || { hours: 0, payroll: 0, people: new Set() }
      agg[k].hours += t.hours ?? 0
      agg[k].payroll += t.laborCost ?? 0
      agg[k].people.add(t.name)
    }
    const hk = agg['housekeeping'] || { hours: 0, payroll: 0, people: new Set<string>() }
    const mt = agg['maintenance'] || { hours: 0, payroll: 0, people: new Set<string>() }
    const mtPeopleArr = Array.from(mt.people)
    const mtTaskMinutes = taskRows
      .filter(t => classify(t) === 'maintenance')
      .filter(t => { const d = doer(t); return !!d && mtPeopleArr.some(p => nameMatches(d, p)) })
      .reduce((a, t) => a + Math.min(num(t.total_minutes) ?? 0, 480), 0) // cap runaway Breezeway timers at 8h/task
    // Supervisor payroll inside housekeeping - shown separately, kept in cost/clean.
    const hkSupPay = round2(Array.from(hk.people).filter(nm2 => isSupervisor(nm2))
      .reduce((a, nm2) => a + timecards.filter(t => t.name === nm2).reduce((x, t) => x + (t.laborCost ?? 0), 0), 0))

    // Billable maintenance work, straight from Breezeway billing (rates + adjustments).
    const mtIds = taskRows.filter(t => classify(t) === 'maintenance').map(t => String(t.id))
    let mtBillable = 0, mtBilledTasks = 0
    if (mtIds.length) {
      const dets: Record<string, any> = {}
      const madj: Record<string, any> = {}
      for (let i = 0; i < mtIds.length; i += 400) {
        const chunk = mtIds.slice(i, i + 400)
        try { const { data } = await sb.from('breezeway_billing_details').select('task_id,rate_type').in('task_id', chunk); for (const d0 of (data || []) as any[]) dets[String(d0.task_id)] = d0 } catch { /* no detail yet */ }
        try { const { data } = await sb.from('billing_adjustments').select('task_id,excluded,override_amount,billed_hours').in('task_id', chunk); for (const a0 of (data || []) as any[]) madj[String(a0.task_id)] = a0 } catch { /* overlay optional */ }
      }
      for (const t of taskRows) {
        if (classify(t) !== 'maintenance') continue
        const adj = madj[String(t.id)]
        if (adj && adj.excluded) continue
        const det = dets[String(t.id)]
        const cappedMin = t.total_minutes != null ? Math.min(Number(t.total_minutes), 480) : null
        const amt = adj && adj.override_amount != null
          ? Number(adj.override_amount)
          : laborAmount(num(t.rate_paid), det && det.rate_type != null ? String(det.rate_type) : null, cappedMin, adj && adj.billed_hours != null ? Number(adj.billed_hours) : null)
        if (amt > 0) { mtBillable += amt; mtBilledTasks++ }
      }
      mtBillable = Math.round(mtBillable * 100) / 100
    }

    const departments = {
      housekeeping: {
        people: hk.people.size, hours: round2(hk.hours), payroll: round2(hk.payroll),
        supervisorPayroll: hkSupPay, cleanerPayroll: round2(hk.payroll - hkSupPay),
        supervisors: SUP_NAMES,
        revenue: inhouseFees,
        vendorRevenue: vendorFees,
        margin: round2(inhouseFees - hk.payroll),
        costPerClean: tasks.clean ? round2(hk.payroll / tasks.clean) : null,
        feePerClean: tasks.clean ? round2(inhouseFees / tasks.clean) : null,
        laborPct: inhouseFees > 0 && hk.payroll > 0 ? round2((hk.payroll / inhouseFees) * 100) : null,
      },
      maintenance: {
        people: mt.people.size, hours: round2(mt.hours), payroll: round2(mt.payroll),
        tasksCompleted: tasks.maintenance,
        teamNames: mtPeopleArr,
        taskHours: round2(mtTaskMinutes / 60),
        utilizationPct: mt.hours > 0 ? round2((mtTaskMinutes / 60 / mt.hours) * 100) : null,
        costPerTask: tasks.maintenance ? round2(mt.payroll / tasks.maintenance) : null,
        billableRevenue: mtBillable, // Breezeway billing: rate math + owner adjustments
        billableTasks: mtBilledTasks,
      },
    }

    // Team week from Homebase — names and shift times only (no dollars), for the planner.
    const wsByDay: Record<string, { name: string; role: string | null; start: string | null; end: string | null }[]> = {}
    for (const s of weekShifts as any[]) {
      if (s.open || !s.name) continue
      wsByDay[s.date] = wsByDay[s.date] || []
      wsByDay[s.date].push({ name: s.name, role: (s as any).role ?? null, start: s.startAt ?? null, end: s.endAt ?? null })
    }
    const weekSchedule = Object.keys(wsByDay).sort().map(date => ({
      date,
      people: wsByDay[date].sort((a, b) => String(a.start).localeCompare(String(b.start))),
    }))

    return NextResponse.json({
      ok: true, market: marketParam, week: { ...week, weekStart }, departments, weekSchedule,
      ...kpis, tasks, economics, payroll, today: todayBlock,
      perCleaner, personTasks, attribution, unattributed, settings,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) })
  }
}
