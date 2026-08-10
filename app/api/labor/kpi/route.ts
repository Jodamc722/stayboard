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
import { getAccess, canSeeMoney } from '@/lib/access'
import { redactMoney, pctOf } from '@/lib/money'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getShifts, nameMatches, nameMatchesRoster, type Shift } from '@/lib/homebase'
import { getTimecards, computeLaborKpis } from '@/lib/homebase-labor'
import { getLaborSettings } from '@/lib/labor-settings'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { laborAmount, billingMonth } from '@/lib/billing'
import { staffByName, resolveStaff } from '@/lib/staffing'

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
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Amounts are the owner's, plus anyone he has switched on at /users → Dollar amounts; everyone
  // else gets the same board in percentages. Decided here, on the server, so the dollars are never
  // in the payload at all (see lib/money.ts).
  const showMoney = canSeeMoney(access)

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

    const [dayShiftsAll, timecardsAll, weekShiftsAll, listingRows] = await Promise.all([
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
    const taskRowsAll = (await pageAll((a, b) => sb.from('breezeway_tasks_sync')
      .select('id,name,type_department,assignee_name,finished_by_name,reference_property_id,finished_at,rate_paid,total_minutes')
      .gte('finished_at', start).lte('finished_at', end + 'T23:59:59')
      .range(a, b)))
    const taskRows = taskRowsAll.filter(t => marketFilter(t.reference_property_id))

    const classify = (t: any): 'clean' | 'inspection' | 'maintenance' | 'other' => {
      const s = `${t.type_department || ''} ${t.name || ''}`.toLowerCase()
      // Strips/walkthroughs and delivery errands are NOT departure cleans - they must
      // never collect a cleaning fee (a strip on a checkout day was stealing the
      // fee from the real cleaner).
      if (/strip|walkthrough|walk-through|deliver|mattress/.test(s)) return 'other'
      if (/clean|housekeep|turn/.test(s)) return 'clean'
      if (/inspect|walk/.test(s)) return 'inspection'
      if (/maint|repair|fix|hvac|plumb|electric|pest/.test(s)) return 'maintenance'
      return 'other'
    }
    // Canonicalize Breezeway doer names to the Homebase roster. Fuzzy full-name
    // match first; then the unique-first-name fallback (last-name drift between
    // systems). Everything downstream keys on the Homebase spelling.
    const rosterNames: string[] = []
    for (const t of timecardsAll) if (t.name && rosterNames.indexOf(t.name) < 0) rosterNames.push(t.name)
    for (const s of weekShiftsAll as any[]) if (s.name && rosterNames.indexOf(s.name) < 0) rosterNames.push(s.name)
    const aliasCache: Record<string, string | null> = {}
    const doer = (t: any): string | null => {
      const raw = t.assignee_name || t.finished_by_name || null
      if (!raw) return null
      if (!(raw in aliasCache)) aliasCache[raw] = nameMatchesRoster(String(raw), rosterNames)
      return aliasCache[raw] || String(raw)
    }

    // ---- Market scoping for PEOPLE (Jon 2026-08-07) ------------------------
    // Homebase is one location with no market concept. A person belongs to the
    // market where their Breezeway work actually happened this window (majority
    // of their tasks, ALL markets considered). Payroll, hours, OT and rosters
    // then parse out by market tab instead of showing the whole company everywhere.
    const personMarketCount: Record<string, Record<string, number>> = {}
    for (const t of taskRowsAll) {
      const d0 = doer(t)
      if (!d0) continue
      const li0 = lmap[String(t.reference_property_id)]
      if (!li0) continue
      personMarketCount[d0] = personMarketCount[d0] || {}
      personMarketCount[d0][li0.market] = (personMarketCount[d0][li0.market] || 0) + 1
    }
    // The STAFF RECORD WINS (Jon 2026-08-08: "the user setting should apply that for labor").
    // /users -> Staffing is where a human decides someone's area; majority-of-tasks is only the
    // fallback for people nobody has classified yet. Without this the settings page would look
    // authoritative while the board quietly ignored it.
    const staffIdx = await staffByName().catch(() => ({} as Record<string, any>))
    const marketOfPerson = (name: string): string | null => {
      const rec = resolveStaff(name, staffIdx)
      if (rec?.area) return String(rec.area).toLowerCase()
      const agg0: Record<string, number> = {}
      for (const rawName of Object.keys(personMarketCount)) {
        if (!nameMatches(rawName, name)) continue
        for (const mk1 of Object.keys(personMarketCount[rawName])) agg0[mk1] = (agg0[mk1] || 0) + personMarketCount[rawName][mk1]
      }
      let best: string | null = null, bestN = 0
      for (const mk1 of Object.keys(agg0)) if (agg0[mk1] > bestN) { best = mk1; bestN = agg0[mk1] }
      return best
    }
    const roleOfPerson = (name: string): string | null => resolveStaff(name, staffIdx)?.role || null
    const inMarket = (name: string) => marketParam === 'all' || marketOfPerson(name) === marketParam
    const timecards = marketParam === 'all' ? timecardsAll : timecardsAll.filter(t => inMarket(t.name))
    const dayShifts = marketParam === 'all' ? dayShiftsAll : dayShiftsAll.filter((s: any) => s.name && inMarket(s.name))
    const weekShifts = marketParam === 'all' ? weekShiftsAll : weekShiftsAll.filter((s: any) => s.name && inMarket(s.name))

    // COST PER CLEAN IS DEPARTURE CLEANS ONLY (Jon, 2026-08-08).
    // classify() calls anything in the housekeeping DEPARTMENT a "clean", which swept in common-area
    // and building work — checked against the live month: 22 "clean common areas", 22 "17WEST pool
    // and fitness center", 22 "trash pickup / takeout", 19 "Eden office cleaning", plus exterior and
    // linen-refresh jobs. Counting those as cleans inflated the denominator and made every clean
    // look cheaper than it is. A departure clean is the turnover the guest fee pays for, and it is
    // named for itself in Breezeway ("Departure Clean Checklist", incl. same-day-turn and long-stay
    // variants), so it is matched by name rather than by department.
    const isDepartureClean = (t: any) => /departure clean|turnover clean|check-?out clean/i.test(String(t.name || ''))
    const tasks = { clean: 0, inspection: 0, maintenance: 0, other: 0, total: 0 }
    const cleanTasks: any[] = []
    let hkNonDeparture = 0
    for (const t of taskRows) {
      const c = classify(t)
      ;(tasks as any)[c]++; tasks.total++
      if (c === 'clean') {
        if (isDepartureClean(t)) cleanTasks.push(t)
        else hkNonDeparture++
      }
    }
    // tasks.clean now means DEPARTURE cleans; the rest of the housekeeping work is kept separately
    // so nothing is lost — it is real work, just not a turnover.
    tasks.clean = cleanTasks.length
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
    // Revenue per person - EVERYONE with an attributed clean, supervisors included
    // (the ranked cleaner board still excludes them; this feeds the People table).
    const personRevenue: Record<string, number> = {}
    for (const x of attributed) {
      const who = x.assignee as string
      personRevenue[who] = round2((personRevenue[who] || 0) + (x.fee as number))
    }

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
        // role/area straight off the staff record so the board labels people the way /users says.
        name, role: roleOfPerson(name), area: marketOfPerson(name),
        cleans: myTasks.length, checkoutsAttributed: mine.length,
        revenueGenerated: revenue, taskPay: myPay, payroll, hours,
        margin: round2(revenue - cost),
        revenuePerLaborDollar: cost > 0 ? round2(revenue / cost) : null,
        avgFeePerClean: mine.length ? round2(revenue / mine.length) : null,
        // Dollar-free versions of the same two facts, so the ranking still reads when amounts are
        // hidden: how much of what this person generated was left after paying them, and how much
        // of the team's cleaning revenue came through their hands.
        marginPct: pctOf(revenue - cost, revenue),
        laborPct: pctOf(cost, revenue),
        _rev: revenue,
      }
    }).sort((a, b) => (b.revenuePerLaborDollar ?? -1) - (a.revenuePerLaborDollar ?? -1))
    const cleanerRevTotal = perCleaner.reduce((a, c) => a + (c._rev || 0), 0)
    for (const c of perCleaner as any[]) { c.sharePct = pctOf(c._rev, cleanerRevTotal); delete c._rev }

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
      // Percentage reads of the same three comparisons, for the money-hidden view.
      scheduledVsActualPct: pctOf(payrollTotal, scheduledCost),   // 100% = spent exactly what was scheduled
      vendorMixPct: pctOf(vendorFees, totalFees),                 // share of cleaning revenue on vendor-cleaned units
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
      laborPct: pctOf(
        round2(tcToday.reduce((a, t) => a + (t.laborCost ?? 0), 0)),
        round2(attributions.filter(x => x.checkOut === today).reduce((a, x) => a + (x.fee ?? 0), 0))),
      vsScheduledPct: pctOf(
        round2(tcToday.reduce((a, t) => a + (t.laborCost ?? 0), 0)),
        round2(shToday.reduce((a: number, s: any) => a + (s.scheduledCost ?? 0), 0))),
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
      if (/inspect|audit|quality/.test(s)) return 'inspection'
      if (/clean|housekeep|turn/.test(s)) return 'housekeeping'
      if (/maint|tech|repair|handy/.test(s)) return 'maintenance'
      return 'other'
    }
    // WHO COUNTS AS MAINTENANCE — in order of how much we trust it (Jon 2026-08-10: "not
    // assumptions"). 1) the staff record a human set on /users → Staffing, 2) the role text typed
    // into Homebase, 3) only then a guess from what they did in Breezeway. Before this, a person
    // whose Homebase role was blank was classified by majority vote, which put ALL of a mixed
    // worker's clocked hours into one department.
    const deptOfPerson = (name: string, role: string | null) => {
      const rec = resolveStaff(name, staffIdx)
      const byStaff = deptOf(rec?.role || null)
      if (byStaff !== 'other') return byStaff
      const byRole = deptOf(role)
      if (byRole !== 'other') return byRole
      let m = 0, c = 0, insp = 0
      for (const t of taskRows) {
        const d = doer(t)
        if (!d || !nameMatches(d, name)) continue
        const k = classify(t)
        if (k === 'maintenance') m++
        else if (k === 'clean') c++
        else if (k === 'inspection') insp++
      }
      if (!m && !c && !insp) return 'other'
      if (insp > c && insp > m) return 'inspection'
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
    const insp = agg['inspection'] || { hours: 0, payroll: 0, people: new Set<string>() }
    const mt = agg['maintenance'] || { hours: 0, payroll: 0, people: new Set<string>() }
    const mtPeopleArr = Array.from(mt.people)
    const mtTaskMinutes = taskRows
      .filter(t => classify(t) === 'maintenance')
      .filter(t => { const d = doer(t); return !!d && mtPeopleArr.some(p => nameMatches(d, p)) })
      .reduce((a, t) => a + Math.min(num(t.total_minutes) ?? 0, 480), 0) // cap runaway Breezeway timers at 8h/task
    // Supervisor payroll inside housekeeping - shown separately, kept in cost/clean.
    const hkSupPay = round2(Array.from(hk.people).filter(nm2 => isSupervisor(nm2))
      .reduce((a, nm2) => a + timecards.filter(t => t.name === nm2).reduce((x, t) => x + (t.laborCost ?? 0), 0), 0))

    // BILLABLE MAINTENANCE — read from the SAME engine as the Billable Hours sheet (lib/billing).
    //
    // The old version here priced each task with laborAmount(rate_paid, ...) alone. Breezeway
    // carries a rate on ZERO tasks (verified against live data 2026-08-09), so that returned ~$0
    // and this board reported $35 of billable maintenance in a week where the Billable Hours sheet
    // showed $1,565. It looked like a "reviewed-only" filter; it was not — review status has never
    // been part of either calculation. The real cause: the team enters FLAT AMOUNTS in Breezeway,
    // which arrive as billing-detail cost/supply items, and those were being ignored here.
    // billingMonth() applies the whole rule — labor + items, owner-billable only, honouring
    // exclusions and overrides — so calling it is the only way the two screens can agree.
    let mtBillable = 0, mtBilledTasks = 0
    try {
      const mtIdSet = new Set(taskRows.filter(t => classify(t) === 'maintenance').map(t => String(t.id)))
      if (mtIdSet.size) {
        const months = Array.from(new Set([String(start).slice(0, 7), String(end).slice(0, 7)]))
        const seen = new Set<string>()
        for (const m of months) {
          const bm = await billingMonth(m)
          for (const bt of (bm.tasks || [])) {
            const id = String((bt as any).id)
            if (!mtIdSet.has(id) || seen.has(id)) continue
            seen.add(id)
            const amt = Number((bt as any).billedAmount) || 0
            if (amt > 0) { mtBillable += amt; mtBilledTasks++ }
          }
        }
        mtBillable = Math.round(mtBillable * 100) / 100
      }
    } catch { /* billing detail unavailable — billable simply reads as zero, never blocks the board */ }

    // Payroll split three ways. This is the one number that survives money-hiding intact: it says
    // where the labor dollar goes without ever saying how big it is.
    const deptPayrollTotal = hk.payroll + insp.payroll + mt.payroll
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
        departureCleans: tasks.clean,
        otherHkTasks: hkNonDeparture,   // common areas, pool, trash, office, linen refreshes
        laborPct: inhouseFees > 0 && hk.payroll > 0 ? round2((hk.payroll / inhouseFees) * 100) : null,
        marginPct: pctOf(inhouseFees - hk.payroll, inhouseFees),
        supervisorSharePct: pctOf(hkSupPay, hk.payroll),
        payrollSharePct: pctOf(hk.payroll, deptPayrollTotal),
      },
      inspection: {
        people: insp.people.size, hours: round2(insp.hours), payroll: round2(insp.payroll),
        inspections: tasks.inspection,
        costPerInspection: tasks.inspection ? round2(insp.payroll / tasks.inspection) : null,
        payrollSharePct: pctOf(insp.payroll, deptPayrollTotal),
      },
      // TWO DIFFERENT FACTS, NEVER MIXED (Jon 2026-08-10: "maintenance hours should be pulled from
      // Breezeway and payroll from Homebase — not assumptions").
      //   hours   = time ON MAINTENANCE TASKS, from Breezeway total_minutes. What was worked.
      //   payroll = what Homebase actually paid those people. What it cost.
      // `hours` used to be the Homebase clocked total, so a maintenance tech who also did a clean
      // had that clean's hours counted as maintenance. Clocked time is still reported, under its
      // own name, because the gap between the two IS the utilisation number.
      maintenance: {
        people: mt.people.size,
        hours: round2(mtTaskMinutes / 60),           // Breezeway — time on maintenance tasks
        payroll: round2(mt.payroll),                 // Homebase — actual wages
        clockedHours: round2(mt.hours),              // Homebase — hours on the clock
        source: { hours: 'breezeway', payroll: 'homebase' },
        tasksCompleted: tasks.maintenance,
        teamNames: mtPeopleArr,
        taskHours: round2(mtTaskMinutes / 60),       // kept: same number, older key
        utilizationPct: mt.hours > 0 ? round2((mtTaskMinutes / 60 / mt.hours) * 100) : null,
        costPerTask: tasks.maintenance ? round2(mt.payroll / tasks.maintenance) : null,
        billableRevenue: mtBillable, // Breezeway billing: rate math + owner adjustments
        billableTasks: mtBilledTasks,
        billableMargin: Math.round((mtBillable - mt.payroll) * 100) / 100, // billable vs wages
        // "Did the work we billed out cover the crew?" — the margin question without the amounts.
        billableCoveragePct: pctOf(mtBillable, mt.payroll),
        payrollSharePct: pctOf(mt.payroll, deptPayrollTotal),
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

    const body = {
      ok: true, market: marketParam, week: { ...week, weekStart }, departments, weekSchedule,
      ...kpis, tasks, economics, payroll, today: todayBlock,
      perCleaner, personTasks, personRevenue, attribution, unattributed, settings,
      nameAliases: Object.keys(aliasCache).filter(k => aliasCache[k] && aliasCache[k] !== k).reduce((o: any, k) => { o[k] = aliasCache[k]; return o }, {}),
    }
    // The percentages above were computed for everyone; only the amounts are gated. `moneyHidden`
    // tells the panel to render the percentage layout — it is a rendering hint, not the control:
    // the dollars are already gone from `body` by the time it is set.
    return NextResponse.json(showMoney ? { ...body, moneyHidden: false } : { ...redactMoney(body), moneyHidden: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) })
  }
}
