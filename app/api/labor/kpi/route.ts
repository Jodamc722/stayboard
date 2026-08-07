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

    const [dayShifts, timecards, weekShifts, listingRows] = await Promise.all([
      shiftsForRange(start, end),
      getTimecards(start, end),
      shiftsForRange(week.start, week.end),
      pageAll((a, b) => sb.from('guesty_listings')
        .select('id,nickname,title,building,address_city').range(a, b)),
    ])

    const lmap: Record<string, { market: string; name: string }> = {}
    for (const l of listingRows) {
      const name = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = { market: marketOf(l.building, l.address_city, name).toLowerCase(), name }
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
    type Attr = { fee: number | null; assignee: string | null; checkOut: string }
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
      attributions.push({ fee: num(r.cleaning), assignee: match ? doer(match) : null, checkOut: co })
    }

    const totalFees = round2(attributions.reduce((a, x) => a + (x.fee ?? 0), 0))
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

    const cleanerNames = Array.from(new Set(cleanTasks.map(t => doer(t)).filter(Boolean))) as string[]
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
    const laborPct = totalFees > 0 && payrollTotal > 0 ? round2((payrollTotal / totalFees) * 100) : null
    const band = laborPct == null ? 'no_data'
      : laborPct <= Number(settings.pct_good) ? 'on_target'
      : laborPct <= Number(settings.pct_bad) ? 'watch' : 'over'
    const payroll = {
      actual: payrollTotal,
      scheduled: scheduledCost,
      revenue: totalFees,
      laborPct, band,
      goalPct: Number(settings.pct_good),
      note: 'payroll = Homebase timecard costs; revenue = guest cleaning fees in window',
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
      cleaningLaborCost: cleaningTaskPay > 0 ? cleaningTaskPay : payrollTotal,
      cleaningMargin: round2(totalFees - (cleaningTaskPay > 0 ? cleaningTaskPay : payrollTotal)),
      revenuePerLaborDollar: payrollTotal > 0 ? round2(totalFees / payrollTotal) : null,
      costBasis: cleaningTaskPay > 0 ? 'breezeway rate_paid' : 'homebase payroll',
    }

    return NextResponse.json({
      ok: true, market: marketParam, week: { ...week, weekStart },
      ...kpis, tasks, economics, payroll, today: todayBlock,
      perCleaner, personTasks, attribution, unattributed, settings,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) })
  }
}
