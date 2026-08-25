// WHO WAS IN THE UNIT, AND WHAT HAPPENED NEXT.
//
// Jon, 2026-08-24, on cleaners: efficiency by "payroll versus revenue generated from departure
// cleans", by time ("obviously by-the-hour time isn't always accurate because they don't always
// start and end their times, but it should look at it"), by what guests said afterwards, and by
// whether a maintenance task existed from the day they were in the unit — "if they clean a unit,
// they do a great job, but there was a maintenance issue that they reported that wasn't fixed...
// there's a good indication that they reported it, but unfortunately it wasn't resolved by our
// maintenance team." And then, minutes later: the same for INSPECTORS — "if a guy goes to a unit,
// inspects it, doesn't create a new task or doesn't report it, then we need to track his
// performance as an inspector."
//
// Those are one question, not two, and the shared shape is what makes this worth building once:
//
//     a person was in a unit before a guest arrived — what did the guest find?
//
// THE IDEA THAT MAKES THIS FAIR. A naive scorecard blames whoever touched the unit last for
// whatever the guest complained about. That is not just unfair, it is actively harmful: it teaches
// the crew that reporting a problem is how you get blamed for it, so they stop reporting. The
// number that prevents it is CAUGHT BUT NOT FIXED — the cleaner flagged the broken thing, the task
// sat unresolved through check-in, and the guest hit it anyway. That is not a cleaning failure. It
// is a resolution failure, and it belongs to maintenance. Every one of those exonerates the person
// who found it and indicts the person who did not fix it.
//
// The inverse is the real miss: nobody reported anything, and the guest found something on day one.
// For an inspector that is the whole job — an inspection that produces no findings is either a
// genuinely perfect unit or somebody who did not look, and the only way to tell the two apart is
// what the guest says next.
//
// WHAT IS HONEST ABOUT THE DATA, STATED IN THE OUTPUT RATHER THAN BURIED HERE:
//   * TIMES ARE PARTIAL. People forget to start and stop tasks. Every average reports how many
//     visits it is actually based on, and the share with no timing at all is a headline number, not
//     a footnote — an average built on a third of the work is a rumour.
//   * "REPORTED" IS A PROXY. The mirror does not carry who raised a task, so a maintenance task at
//     that unit dated the same day as the visit is treated as "they found it". Same-day maintenance
//     at a unit somebody was standing in is a good proxy, and it is not proof.
//   * REVIEWS ARE MATCHED BY TIME. Reviews carry no reservation id, so a review is attached to the
//     stay whose checkout it follows within two weeks. Wrong occasionally; wrong at random.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from '@/lib/breezeway'
import { rollupBuilding } from '@/lib/optimize-score'
import { billingRange, type BillingTask } from '@/lib/billing'
import { todayET, shiftDay, lc, num, round2, normStar, DEAD_LISTING } from './ctx'

export type Role = 'clean' | 'inspect'

const INSPECT_RE = /inspect|walk\s?through|walkthrough|qc\b|quality check/i
const MAINT_RE = /maintenance|repair|handyman|technician|fix/i

const isDone = (t: any) => !!t.finished_at || /complete|finish|close|approv/.test(lc(t.status))
const dayOf = (v: any) => String(v || '').slice(0, 10)

function roleOf(t: any): Role | 'maintenance' | null {
  const dept = lc(t.type_department)
  const name = String(t.name || '')
  if (MAINT_RE.test(dept) || MAINT_RE.test(name)) return 'maintenance'
  if (INSPECT_RE.test(dept) || INSPECT_RE.test(name)) return 'inspect'
  if (isDepartureCleanName(name) || /clean|turnover|housekeep/i.test(dept)) return 'clean'
  return null
}

function peopleOn(t: any): string[] {
  const list = Array.isArray(t.assignees) ? t.assignees : []
  const names = list.map((a: any) => String(a?.name || '').trim()).filter(Boolean)
  if (!names.length && t.finished_by_name) names.push(String(t.finished_by_name))
  return Array.from(new Set(names))
}

export type Visit = {
  taskId: string
  person: string
  role: Role
  listingId: string
  unit: string
  building: string
  date: string
  minutes: number | null
  cost: number | null
  /** The arrival this visit was preparing for. */
  nextArrival: { id: string; guest: string; checkIn: string; checkOut: string; revenue: number | null } | null
  reportedSameDay: number          // maintenance tasks at this unit dated the day of the visit
  caughtNotFixed: number           // …of those, still unfinished when the guest checked in
  guestFoundIssue: boolean         // a maintenance task raised DURING the stay
  guestFoundDayOne: boolean        // …on the first day, which is the damning version
  review: number | null            // /5, matched by checkout window
  /** The guest in their own words. Coaching needs a quote, not a score. */
  reviewText: string | null
  reviewGuest: string | null
  /** What an inspector wrote about THIS clean, when one was logged. */
  inspection: { inspector: string | null; rating: number | null; notes: string | null; followUp: string | null } | null
}

export type PersonScore = {
  person: string
  role: Role
  visits: number
  units: number
  // time — always reported with the sample it rests on
  minutesAvg: number | null
  minutesSample: number
  noTimingPct: number
  // money
  costTotal: number | null
  costAvg: number | null
  revenueTotal: number | null
  costPctOfRevenue: number | null
  // outcomes
  reviewAvg: number | null
  reviewSample: number
  catchRate: number                // % of visits where something was reported that day
  missRate: number                 // % where the guest found something and nothing was reported
  caughtNotFixed: number           // exonerations — and maintenance's problem, not theirs
  flags: string[]
}

export type ScorecardResult = {
  role: Role
  windowDays: number
  from: string
  to: string
  people: PersonScore[]
  totals: {
    visits: number
    noTimingPct: number
    costTotal: number | null
    revenueTotal: number | null
    costPctOfRevenue: number | null
    reviewAvg: number | null
    caughtNotFixed: number
    guestFoundDayOne: number
  }
  caveats: string[]
  truncated: boolean
  /** Only when asked for: the visit-by-visit receipts behind the numbers. */
  visits?: Visit[]
}

export async function crewScorecard(input: {
  role?: Role; days?: number; person?: string; building?: string; includeVisits?: boolean
}): Promise<ScorecardResult> {
  const db = supabaseAdmin()
  const role: Role = input?.role === 'inspect' ? 'inspect' : 'clean'
  const days = Math.min(Math.max(Number(input?.days) || 60, 7), 180)
  const today = todayET()
  const from = shiftDay(today, -days)

  // ---- listings, for names and buildings ----
  const meta: Record<string, { unit: string; building: string; live: boolean }> = {}
  {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building,status').order('id').limit(500)
    for (const l of (data || [])) {
      const r: any = l
      const unit = r.nickname || r.title || String(r.id)
      meta[String(r.id)] = { unit, building: rollupBuilding(r.building, unit), live: !DEAD_LISTING.test(lc(r.status)) }
    }
  }

  // ---- every task in the window, ONE query, no raw ----
  const TASK_CAP = 8000
  const { data: taskRows } = await db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,type_department,scheduled_date,started_at,finished_at,total_minutes,rate_paid,assignees,finished_by_name')
    .gte('scheduled_date', from).lte('scheduled_date', today)
    .order('scheduled_date').limit(TASK_CAP)
  const tasks = (taskRows || []).filter((t: any) => !/delete|cancel/.test(lc(t.status)))
  const truncated = (taskRows || []).length >= TASK_CAP

  // Maintenance tasks indexed by unit+day, so "did anyone report anything that day" is a lookup
  // rather than a query per visit.
  const maintByUnitDay: Record<string, any[]> = {}
  const maintByUnit: Record<string, any[]> = {}
  for (const t of tasks) {
    if (roleOf(t) !== 'maintenance') continue
    const u = String((t as any).reference_property_id || '')
    const d = dayOf((t as any).scheduled_date)
    ;(maintByUnitDay[u + '|' + d] ||= []).push(t)
    ;(maintByUnit[u] ||= []).push(t)
  }

  // ---- reservations in and after the window ----
  const { data: resRows } = await db.from('guesty_reservations')
    .select('id,listing_id,guest_name,check_in,check_out,status,money_total')
    .gte('check_out', from).order('check_in').limit(6000)
  const liveRes = (resRows || []).filter((r: any) => !/cancel|declin|inquir|expire/i.test(lc(r.status)))
  const resByUnit: Record<string, any[]> = {}
  for (const r of liveRes) (resByUnit[String((r as any).listing_id)] ||= []).push(r)
  for (const k of Object.keys(resByUnit)) resByUnit[k].sort((a: any, b: any) => dayOf(a.check_in).localeCompare(dayOf(b.check_in)))

  // ---- reviews, matched to a stay by the checkout that precedes them ----
  const { data: revRows } = await db.from('guesty_reviews')
    .select('id,listing_id,rating,content,guest_name,created_at,excluded_from_score')
    .gte('created_at', from + 'T00:00:00Z').eq('excluded_from_score', false)
    .order('created_at').limit(4000)
  const revByUnit: Record<string, any[]> = {}
  for (const r of (revRows || [])) (revByUnit[String((r as any).listing_id)] ||= []).push(r)

  function reviewFor(listingId: string, checkOut: string): { stars: number | null; text: string | null; guest: string | null } {
    const list = revByUnit[listingId] || []
    const out = Date.parse(checkOut + 'T00:00:00Z')
    let best: any = null
    let bestGap = Infinity
    for (const r of list) {
      const at = Date.parse(String((r as any).created_at))
      const gap = at - out
      if (gap < -86400000 || gap > 14 * 86400000) continue
      if (gap < bestGap) { bestGap = gap; best = r }
    }
    return best
      ? { stars: normStar(best.rating), text: String(best.content || '').slice(0, 700) || null, guest: best.guest_name || null }
      : { stars: null, text: null, guest: null }
  }

  // OUR OWN inspection of that clean, when somebody logged one. A named human rating with notes
  // beats every inference in this file, so where it exists it leads.
  const inspByUnitDay: Record<string, any> = {}
  {
    const { data } = await db.from('unit_inspections')
      .select('id,listing_id,inspected_on,inspector,cleaner,rating,notes,follow_up')
      .gte('inspected_on', from).order('inspected_on').limit(4000)
    for (const r of (data || [])) {
      const row: any = r
      inspByUnitDay[String(row.listing_id) + '|' + dayOf(row.inspected_on)] = row
    }
  }

  // ---- build one visit per person per qualifying task ----
  const visits: Visit[] = []
  for (const t of tasks) {
    const r = roleOf(t)
    if (r !== role) continue
    if (!isDone(t)) continue
    const listingId = String((t as any).reference_property_id || '')
    const m = meta[listingId]
    if (!m) continue
    if (input?.building && lc(m.building) !== lc(input.building)) continue
    const date = dayOf((t as any).scheduled_date)

    // The arrival this visit was preparing for: the first check-in on or after the visit day.
    const arrivals = (resByUnit[listingId] || []).filter((x: any) => dayOf(x.check_in) >= date)
    const a: any = arrivals[0] || null

    const reported = (maintByUnitDay[listingId + '|' + date] || [])
    const caughtNotFixed = a
      ? reported.filter((x: any) => !isDone(x) || (x.finished_at && dayOf(x.finished_at) > dayOf(a.check_in))).length
      : 0

    let guestFound = false, guestFoundDayOne = false
    if (a) {
      const ci = dayOf(a.check_in), co = dayOf(a.check_out)
      for (const x of (maintByUnit[listingId] || [])) {
        const d = dayOf((x as any).scheduled_date)
        if (d > ci && d <= co) guestFound = true
        if (d === ci || d === shiftDay(ci, 1)) { guestFound = true; guestFoundDayOne = true }
      }
    }

    const rv = a ? reviewFor(listingId, dayOf(a.check_out)) : { stars: null, text: null, guest: null }
    const insp = inspByUnitDay[listingId + '|' + date] || null

    const mins = Number((t as any).total_minutes)
    const cost = Number((t as any).rate_paid)
    for (const person of peopleOn(t)) {
      if (input?.person && !lc(person).includes(lc(input.person))) continue
      visits.push({
        taskId: String((t as any).id), person, role,
        listingId, unit: m.unit, building: m.building, date,
        minutes: Number.isFinite(mins) && mins > 0 ? mins : null,
        cost: Number.isFinite(cost) && cost > 0 ? cost : null,
        nextArrival: a ? {
          id: String(a.id), guest: a.guest_name, checkIn: dayOf(a.check_in), checkOut: dayOf(a.check_out),
          revenue: Number.isFinite(Number(a.money_total)) ? Number(a.money_total) : null,
        } : null,
        reportedSameDay: reported.length,
        caughtNotFixed,
        guestFoundIssue: guestFound,
        guestFoundDayOne,
        review: rv.stars, reviewText: rv.text, reviewGuest: rv.guest,
        inspection: insp ? {
          inspector: insp.inspector || null,
          rating: Number.isFinite(Number(insp.rating)) ? Number(insp.rating) : null,
          notes: String(insp.notes || '').slice(0, 400) || null,
          followUp: String(insp.follow_up || '').slice(0, 300) || null,
        } : null,
      })
    }
  }

  // ---- aggregate ----
  const byPerson: Record<string, Visit[]> = {}
  for (const v of visits) (byPerson[v.person] ||= []).push(v)

  const people: PersonScore[] = Object.keys(byPerson).map(person => {
    const vs = byPerson[person]
    const timed = vs.filter(v => v.minutes != null)
    const costed = vs.filter(v => v.cost != null)
    const revenued = vs.filter(v => v.nextArrival?.revenue != null)
    const reviewed = vs.filter(v => v.review != null)
    const costTotal = costed.length ? round2(costed.reduce((a, v) => a + num(v.cost), 0)) : null
    const revenueTotal = revenued.length ? round2(revenued.reduce((a, v) => a + num(v.nextArrival!.revenue), 0)) : null
    const caught = vs.filter(v => v.reportedSameDay > 0).length
    const missed = vs.filter(v => v.guestFoundDayOne && v.reportedSameDay === 0).length
    const cnf = vs.reduce((a, v) => a + v.caughtNotFixed, 0)
    const noTimingPct = Math.round(((vs.length - timed.length) / vs.length) * 100)

    const flags: string[] = []
    if (noTimingPct >= 50) flags.push(`${noTimingPct}% of these visits have no start/finish time — the time figures here rest on ${timed.length} of ${vs.length}`)
    if (cnf > 0) flags.push(`${cnf} issue(s) they reported were still open when the guest walked in — those are maintenance failures, not theirs`)
    if (missed > 0) flags.push(`${missed} arrival(s) hit a problem on day one that nobody had reported`)

    return {
      person, role, visits: vs.length, units: new Set(vs.map(v => v.listingId)).size,
      minutesAvg: timed.length ? Math.round(timed.reduce((a, v) => a + num(v.minutes), 0) / timed.length) : null,
      minutesSample: timed.length,
      noTimingPct,
      costTotal, costAvg: costed.length ? round2(costTotal! / costed.length) : null,
      revenueTotal,
      costPctOfRevenue: costTotal != null && revenueTotal ? round2((costTotal / revenueTotal) * 100) : null,
      reviewAvg: reviewed.length ? round2(reviewed.reduce((a, v) => a + num(v.review), 0) / reviewed.length) : null,
      reviewSample: reviewed.length,
      catchRate: Math.round((caught / vs.length) * 100),
      missRate: Math.round((missed / vs.length) * 100),
      caughtNotFixed: cnf,
      flags,
    }
  }).sort((a, b) => b.visits - a.visits)

  const timedAll = visits.filter(v => v.minutes != null).length
  const costAll = visits.filter(v => v.cost != null)
  const revAll = visits.filter(v => v.nextArrival?.revenue != null)
  const revwAll = visits.filter(v => v.review != null)
  const ct = costAll.length ? round2(costAll.reduce((a, v) => a + num(v.cost), 0)) : null
  const rt = revAll.length ? round2(revAll.reduce((a, v) => a + num(v.nextArrival!.revenue), 0)) : null

  return {
    role, windowDays: days, from, to: today, people,
    totals: {
      visits: visits.length,
      noTimingPct: visits.length ? Math.round(((visits.length - timedAll) / visits.length) * 100) : 0,
      costTotal: ct, revenueTotal: rt,
      costPctOfRevenue: ct != null && rt ? round2((ct / rt) * 100) : null,
      reviewAvg: revwAll.length ? round2(revwAll.reduce((a, v) => a + num(v.review), 0) / revwAll.length) : null,
      caughtNotFixed: visits.reduce((a, v) => a + v.caughtNotFixed, 0),
      guestFoundDayOne: visits.filter(v => v.guestFoundDayOne).length,
    },
    caveats: [
      'Times are partial — people forget to start and stop tasks. Every time figure names the sample it rests on; quote that sample, never the average alone.',
      '"Reported" is a proxy: a maintenance task at that unit dated the same day as the visit. Good evidence, not proof of who raised it.',
      'Reviews carry no reservation id, so each is matched to the stay whose checkout it follows within 14 days.',
      'Cost is rate_paid on the task. Revenue is the money_total of the NEXT arrival, so it is the stay that visit prepared, not a share of the month.',
    ],
    truncated,
    // The receipts, when somebody is about to be judged on a number. Nobody should have to take an
    // aggregate on faith about their own work.
    visits: input?.includeVisits ? visits.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200) : undefined,
  }
}


// -------------------------------------------------------------------------------------------
// MAINTENANCE — hours, billable hours, and whether the work actually got finished.
//
// Jon: "We need to track also maintenance hours, logged billable hours etc, their task completion."
//
// Maintenance is a different economics from cleaning and needs different questions. A clean is
// piece-work that prepares one stay; maintenance is hourly, often BILLABLE to an owner or a guest,
// and its failure mode is not a bad review — it is a job that stays open.
//
// So four questions, and one of them is uncomfortable:
//
//   HOURS          — how much time is actually logged against tasks. Tasks with no time on them at
//                    all are counted and reported, because an hours figure that quietly ignores
//                    half the work is worse than no figure.
//   BILLABLE       — of that time and cost, how much we can put on an owner or guest invoice
//                    versus how much we absorb. Maintenance is a cost centre until it is billed,
//                    and the recovery rate is the number that says which one we are running.
//   COMPLETION     — finished versus still open, and how long it takes to close. Not a rate on its
//                    own: a 95% completion rate with a 30-day median is a queue, not a service.
//   TURNAROUND ON  — the uncomfortable one. This owns the number that EXONERATES the cleaners.
//   TURNOVER WORK    An issue flagged on a turnover day has a deadline, not a backlog position,
//                    and this counts how many of those were closed before the guest walked in.
//
// A HONESTY NOTE THAT HAS TO TRAVEL WITH THE BILLABLE FIGURES. The task list mirror does not carry
// costs, supplies or bill_to — those only arrive on a per-task detail pull. Any task without that
// detail contributes zero billable, so every billable total here is a FLOOR, and the count of tasks
// missing detail is reported next to it. Presenting a floor as a total is how a recovery rate ends
// up quietly wrong in the direction that flatters nobody.
// -------------------------------------------------------------------------------------------
export type MaintScore = {
  person: string
  crew: string                     // inhouse | vendor | mixed | unknown
  tasks: number
  completed: number
  open: number
  completionPct: number
  units: number
  hoursLogged: number | null
  noTimePct: number                // share of their tasks with no minutes recorded at all
  medianDaysToClose: number | null
  overSevenDays: number            // still open, scheduled more than a week ago
  billedTotal: number | null       // money — what an owner or guest can be charged
  costTotal: number | null         // money — what the labour cost us
  recoveryPct: number | null       // billed as a share of cost
  missingDetail: number            // tasks whose billing detail was never pulled
  turnoverJobs: number             // flagged on a turnover day
  turnoverMissed: number           // …and still open when the guest checked in
  repeatVisits: number             // same unit again within 14 days — the job that did not hold
  flags: string[]
}

export type MaintResult = {
  windowDays: number
  from: string
  to: string
  people: MaintScore[]
  totals: {
    tasks: number; completed: number; completionPct: number
    hoursLogged: number | null; noTimePct: number
    billedTotal: number | null; costTotal: number | null; recoveryPct: number | null
    missingDetail: number; turnoverJobs: number; turnoverMissed: number
  }
  caveats: string[]
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const a = xs.slice().sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10
}

export async function maintenanceScorecard(input: {
  days?: number; person?: string; building?: string
}): Promise<MaintResult> {
  const db = supabaseAdmin()
  const days = Math.min(Math.max(Number(input?.days) || 30, 7), 90)
  const today = todayET()
  const from = shiftDay(today, -days)

  // billingRange already resolves costs, supplies, bill_to, rate type and our overlay, so the
  // billable side is computed once in one place rather than re-derived differently here.
  const { tasks: billed } = await billingRange(from, today)
  const maint = billed.filter((t: BillingTask) => MAINT_RE.test(lc(t.department)) || MAINT_RE.test(String(t.name || '')))

  // Buildings, arrivals, and which days a turnover clean happened — all one pass each.
  const meta: Record<string, { unit: string; building: string }> = {}
  {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building').order('id').limit(500)
    for (const l of (data || [])) {
      const r: any = l
      const unit = r.nickname || r.title || String(r.id)
      meta[String(r.id)] = { unit, building: rollupBuilding(r.building, unit) }
    }
  }
  const { data: resRows } = await db.from('guesty_reservations')
    .select('id,listing_id,check_in,status').gte('check_in', from).order('check_in').limit(6000)
  const arrivalsByUnit: Record<string, string[]> = {}
  for (const r of (resRows || [])) {
    const row: any = r
    if (/cancel|declin|inquir|expire/i.test(lc(row.status))) continue
    ;(arrivalsByUnit[String(row.listing_id)] ||= []).push(dayOf(row.check_in))
  }
  const { data: cleanRows } = await db.from('breezeway_tasks_sync')
    .select('reference_property_id,name,type_department,scheduled_date,status')
    .gte('scheduled_date', from).lte('scheduled_date', today).order('scheduled_date').limit(8000)
  const turnoverDays = new Set<string>()
  for (const t of (cleanRows || [])) {
    const row: any = t
    if (roleOf(row) !== 'clean') continue
    turnoverDays.add(String(row.reference_property_id) + '|' + dayOf(row.scheduled_date))
  }

  // Repeat visits: the same unit needing maintenance again within a fortnight. Not proof the first
  // fix failed — units break twice — but a person whose jobs come back far more than everyone
  // else's is worth a conversation.
  const maintByUnit: Record<string, string[]> = {}
  for (const t of maint) {
    if (!t.listingId) continue
    ;(maintByUnit[String(t.listingId)] ||= []).push(dayOf(t.scheduledDate))
  }

  type Row = { t: BillingTask; person: string }
  const rows: Row[] = []
  for (const t of maint) {
    const b = t.listingId ? meta[String(t.listingId)] : null
    if (input?.building && (!b || lc(b.building) !== lc(input.building))) continue
    const names = (t.assignees || []).map(a => String(a?.name || '').trim()).filter(Boolean)
    if (!names.length && t.finishedBy) names.push(String(t.finishedBy))
    for (const person of (names.length ? names : ['(unassigned)'])) {
      if (input?.person && !lc(person).includes(lc(input.person))) continue
      rows.push({ t, person })
    }
  }

  const byPerson: Record<string, Row[]> = {}
  for (const r of rows) (byPerson[r.person] ||= []).push(r)

  const people: MaintScore[] = Object.keys(byPerson).map(person => {
    const rs = byPerson[person]
    const ts = rs.map(r => r.t)
    const done = ts.filter(t => !!t.finishedAt || /complete|finish|close|approv/.test(lc(t.status)))
    const open = ts.filter(t => !done.includes(t))
    const timed = ts.filter(t => Number.isFinite(Number(t.actualMinutes)) && Number(t.actualMinutes) > 0)
    const mins = timed.reduce((a, t) => a + num(t.actualMinutes), 0)

    const closeDays = done
      .filter(t => t.finishedAt && t.scheduledDate)
      .map(t => Math.max(0, Math.round((Date.parse(dayOf(t.finishedAt)) - Date.parse(dayOf(t.scheduledDate))) / 86400000)))

    const billedTotal = round2(ts.reduce((a, t) => a + num(t.billedAmount), 0))
    const costTotal = round2(ts.reduce((a, t) => a + num(t.laborAmount), 0))
    const missingDetail = ts.filter(t => !t.hasDetail).length

    let turnoverJobs = 0, turnoverMissed = 0
    for (const t of ts) {
      if (!t.listingId || !t.scheduledDate) continue
      const key = String(t.listingId) + '|' + dayOf(t.scheduledDate)
      if (!turnoverDays.has(key)) continue
      turnoverJobs++
      const nextIn = (arrivalsByUnit[String(t.listingId)] || []).filter(d => d >= dayOf(t.scheduledDate)).sort()[0]
      if (!nextIn) continue
      const closed = t.finishedAt ? dayOf(t.finishedAt) : null
      if (!closed || closed > nextIn) turnoverMissed++
    }

    let repeats = 0
    for (const t of ts) {
      if (!t.listingId || !t.finishedAt) continue
      const later = (maintByUnit[String(t.listingId)] || []).filter(d => d > dayOf(t.finishedAt) && Date.parse(d) - Date.parse(dayOf(t.finishedAt)) <= 14 * 86400000)
      if (later.length) repeats++
    }

    const noTimePct = ts.length ? Math.round(((ts.length - timed.length) / ts.length) * 100) : 0
    const crewSet = new Set(ts.map(t => t.crew).filter(Boolean))
    const crew = crewSet.size > 1 ? 'mixed' : (Array.from(crewSet)[0] || 'unknown')

    const flags: string[] = []
    if (noTimePct >= 40) flags.push(`${noTimePct}% of these tasks have no time logged — the hours figure rests on ${timed.length} of ${ts.length}`)
    if (missingDetail) flags.push(`${missingDetail} task(s) have no billing detail pulled, so the billable figure is a floor, not a total`)
    if (turnoverMissed) flags.push(`${turnoverMissed} job(s) flagged on a turnover day were still open when the guest arrived — those are the ones a guest meets`)
    if (repeats >= 3) flags.push(`${repeats} of these units needed maintenance again within a fortnight`)

    return {
      person, crew: String(crew), tasks: ts.length, completed: done.length, open: open.length,
      completionPct: ts.length ? Math.round((done.length / ts.length) * 100) : 0,
      units: new Set(ts.map(t => t.listingId).filter(Boolean)).size,
      hoursLogged: timed.length ? round2(mins / 60) : null,
      noTimePct,
      medianDaysToClose: median(closeDays),
      overSevenDays: open.filter(t => t.scheduledDate && dayOf(t.scheduledDate) < shiftDay(today, -7)).length,
      billedTotal: billedTotal || null, costTotal: costTotal || null,
      recoveryPct: costTotal ? round2((billedTotal / costTotal) * 100) : null,
      missingDetail, turnoverJobs, turnoverMissed, repeatVisits: repeats, flags,
    }
  }).sort((a, b) => b.tasks - a.tasks)

  const allTs = rows.map(r => r.t)
  const allDone = allTs.filter(t => !!t.finishedAt || /complete|finish|close|approv/.test(lc(t.status)))
  const allTimed = allTs.filter(t => Number(t.actualMinutes) > 0)
  const bt = round2(allTs.reduce((a, t) => a + num(t.billedAmount), 0))
  const ctot = round2(allTs.reduce((a, t) => a + num(t.laborAmount), 0))

  return {
    windowDays: days, from, to: today, people,
    totals: {
      tasks: allTs.length, completed: allDone.length,
      completionPct: allTs.length ? Math.round((allDone.length / allTs.length) * 100) : 0,
      hoursLogged: allTimed.length ? round2(allTimed.reduce((a, t) => a + num(t.actualMinutes), 0) / 60) : null,
      noTimePct: allTs.length ? Math.round(((allTs.length - allTimed.length) / allTs.length) * 100) : 0,
      billedTotal: bt || null, costTotal: ctot || null,
      recoveryPct: ctot ? round2((bt / ctot) * 100) : null,
      missingDetail: allTs.filter(t => !t.hasDetail).length,
      turnoverJobs: people.reduce((a, p) => a + p.turnoverJobs, 0),
      turnoverMissed: people.reduce((a, p) => a + p.turnoverMissed, 0),
    },
    caveats: [
      'Billable totals are a FLOOR. Costs, supplies and bill_to only arrive on a per-task detail pull; any task without it contributes zero. The missingDetail count sits next to every billable number for that reason.',
      'Hours are logged time on tasks, not payroll hours. People forget to start and stop, so every hours figure names the sample it rests on.',
      'Days-to-close runs from the scheduled date, because the mirror does not carry when a task was raised. A job scheduled late looks faster than it was.',
      'Repeat visits mean the same unit needed maintenance again within a fortnight. Units do break twice — treat it as a question, not a verdict.',
      'A task with several assignees counts once for each of them, so per-person task counts do not sum to the portfolio total.',
    ],
  }
}

// -------------------------------------------------------------------------------------------
// COACHING — the version you can actually say to somebody's face.
//
// Jon: "Eve should be able to share real data on them and real feedback for them to work on. It
// should also review last 5 or 6 cleans, check audits."
//
// A scorecard is for deciding. This is for TALKING, and it is a different object: it leads with the
// last handful of jobs, it quotes the guest rather than scoring them, and it separates three things
// that a single average smears together —
//
//   what is going well, with the evidence
//   what to work on, with the evidence
//   what is NOT their fault, with the evidence
//
// That third bucket exists because it is the one a manager forgets and the crew never does. Walking
// into a conversation about a 3-star review without knowing the cleaner had already reported the
// broken thing is how you lose a good cleaner.
//
// Every line here is anchored to a real unit on a real date. Feedback somebody cannot check is not
// feedback, it is an opinion with a number attached.
// -------------------------------------------------------------------------------------------
export type Coaching = {
  person: string
  role: Role
  windowDays: number
  headline: string
  goingWell: string[]
  toWorkOn: string[]
  notYourFault: string[]
  recent: {
    date: string; unit: string; minutes: number | null
    guestScore: number | null; guestSaid: string | null
    ourInspection: string | null
    reported: number; caughtNotFixed: number; guestFoundDayOne: boolean
  }[]
  score: PersonScore | null
  caveats: string[]
}

export async function crewCoaching(person: string, role: Role = 'clean', days = 90, recentN = 6): Promise<Coaching> {
  const s = await crewScorecard({ role, days, person, includeVisits: true })
  const score = s.people[0] || null
  const all = (s.visits || []).filter(v => lc(v.person).includes(lc(person)))
  const recent = all.slice(0, Math.min(Math.max(recentN, 3), 12))

  const goingWell: string[] = []
  const toWorkOn: string[] = []
  const notYourFault: string[] = []

  if (!score) {
    return {
      person, role, windowDays: days,
      headline: `No completed ${role === 'inspect' ? 'inspections' : 'cleans'} on file for anyone matching "${person}" in the last ${days} days.`,
      goingWell: [], toWorkOn: [], notYourFault: [], recent: [], score: null, caveats: s.caveats,
    }
  }

  // --- what is going well ---
  const good = all.filter(v => v.review != null && (v.review as number) >= 4.5)
  if (good.length) {
    const q = good.find(v => v.reviewText && v.reviewText.length > 30)
    goingWell.push(`${good.length} of the ${all.filter(v => v.review != null).length} stays after your work scored 4.5 or better.`
      + (q ? ` ${q.unit}, ${q.date}: the guest wrote "${(q.reviewText as string).slice(0, 200)}"` : ''))
  }
  const praised = all.filter(v => v.inspection?.rating != null && (v.inspection!.rating as number) >= 4)
  if (praised.length) {
    const p = praised[0]
    goingWell.push(`${praised.length} of your jobs were inspected and rated 4+.`
      + (p.inspection?.notes ? ` ${p.inspection.inspector || 'The inspector'} on ${p.date}: "${p.inspection.notes.slice(0, 160)}"` : ''))
  }
  if (score.catchRate >= 40) {
    goingWell.push(`You flag problems on ${score.catchRate}% of your visits. That is the habit that keeps issues off guests — keep doing it.`)
  }
  if (score.minutesSample >= 5 && score.minutesAvg != null) {
    goingWell.push(`Your recorded time averages ${score.minutesAvg} minutes across ${score.minutesSample} timed job(s).`)
  }

  // --- what to work on ---
  const missed = all.filter(v => v.guestFoundDayOne && v.reportedSameDay === 0)
  for (const m of missed.slice(0, 3)) {
    toWorkOn.push(`${m.unit}, ${m.date}: a guest arrived and something needed fixing on day one that had not been flagged.`
      + (m.reviewText ? ` They wrote: "${m.reviewText.slice(0, 160)}"` : ''))
  }
  const lowInsp = all.filter(v => v.inspection?.rating != null && (v.inspection!.rating as number) <= 3)
  for (const l of lowInsp.slice(0, 2)) {
    toWorkOn.push(`${l.unit}, ${l.date}: inspected and rated ${l.inspection!.rating}/5${l.inspection?.notes ? ` — "${l.inspection.notes.slice(0, 160)}"` : ''}`)
  }
  const lowRev = all.filter(v => v.review != null && (v.review as number) <= 3 && v.caughtNotFixed === 0)
  for (const l of lowRev.slice(0, 2)) {
    toWorkOn.push(`${l.unit}, ${l.date}: the stay after this scored ${l.review}/5${l.reviewText ? ` — "${l.reviewText.slice(0, 160)}"` : ''}`)
  }
  if (score.noTimingPct >= 40) {
    toWorkOn.push(`${score.noTimingPct}% of your jobs have no start or finish time recorded. Starting and finishing the task in the app is what lets us pay and defend your time properly — right now most of it is invisible.`)
  }

  // --- what is not their fault ---
  const exonerated = all.filter(v => v.caughtNotFixed > 0)
  for (const e of exonerated.slice(0, 4)) {
    notYourFault.push(`${e.unit}, ${e.date}: you reported ${e.caughtNotFixed} issue(s) and ${e.caughtNotFixed === 1 ? 'it was' : 'they were'} still open when the guest checked in.`
      + (e.review != null && (e.review as number) <= 4 ? ` The stay scored ${e.review}/5 — that one is on maintenance, not on you.` : ' You did your part.'))
  }

  const reviewed = all.filter(v => v.review != null).length
  const headline = `${person} — ${score.visits} ${role === 'inspect' ? 'inspection' : 'clean'}(s) across ${score.units} unit(s) in ${days} days. `
    + (score.reviewAvg != null ? `Stays after their work average ${score.reviewAvg}/5 across ${reviewed} review(s). ` : 'No reviews landed on the stays after their work yet. ')
    + (score.caughtNotFixed ? `${score.caughtNotFixed} issue(s) they reported were not fixed before a guest arrived — read those first.` : '')

  return {
    person: score.person, role, windowDays: days, headline,
    goingWell, toWorkOn, notYourFault,
    recent: recent.map(v => ({
      date: v.date, unit: v.unit, minutes: v.minutes,
      guestScore: v.review, guestSaid: v.reviewText,
      ourInspection: v.inspection ? `${v.inspection.rating ?? '?'}/5 by ${v.inspection.inspector || 'unknown'}${v.inspection.notes ? ` — ${v.inspection.notes}` : ''}` : null,
      reported: v.reportedSameDay, caughtNotFixed: v.caughtNotFixed, guestFoundDayOne: v.guestFoundDayOne,
    })),
    score, caveats: s.caveats,
  }
}

/** One person, visit by visit — the receipts behind a number somebody is about to be judged on. */
export async function crewPerson(person: string, role: Role, days = 60): Promise<{
  person: string; role: Role; score: PersonScore | null; visits: Visit[]; caveats: string[]
}> {
  const s = await crewScorecard({ role, days, person, includeVisits: true })
  return { person, role, score: s.people[0] || null, visits: s.visits || [], caveats: s.caveats }
}
