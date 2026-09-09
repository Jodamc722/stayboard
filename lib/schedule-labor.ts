import 'server-only'
// LABOR AGAINST THE CLEANS THAT ARE ACTUALLY ON THE BOARD (Jon, 2026-09-09).
//
// "It should mostly be for labor and for departure cleans… we want to see the actual scheduled
// cleans and who's cleaning them so we can get an idea of labor."
//
// So this does NOT go and find its own cleans. It is handed the planner that was just built and
// prices exactly the jobs on it — the same rows the reader is looking at. A second query here
// would be a second set of numbers, and this codebase has been bitten by that more than once.
//
// THREE NUMBERS, AND THEY ARE NOT THE SAME KIND OF NUMBER:
//
//   REVENUE     the guest's cleaning fee on the checkout each departure clean belongs to
//               (Guesty fareCleaning) — the same field lib/labor-econ prices cleans with, so the
//               planner and the labor P&L agree. Known for past and future alike: it is booked.
//   LABOR, PAST what people were actually punched in for, from Homebase. A real spend.
//   LABOR, AHEAD what people are SCHEDULED for. Tomorrow has no punches, and inventing them by
//               multiplying cleans by a rate would print a spend that never happened. Scheduled
//               cost is labelled scheduled everywhere it appears and never added to actual.
//
// A day is priced from punches once it is over and from shifts while it is still ahead, and the
// split is reported so a total is never half-guess half-fact without saying so.
//
// WHEN PAYROLL COMES BACK SHORT the audit flag travels with the number and every caller is
// expected to show the warning instead of the figure — the daily true-up email already refuses to
// send on a partial read, and a shared board must not quietly understate what the crew cost.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTimecardsAudited } from '@/lib/homebase-labor'
import { getShifts } from '@/lib/homebase'
import { isDepartureCleanName } from '@/lib/breezeway'
import { nameMatches } from '@/lib/person-name'
import type { TeamSchedule } from '@/lib/team-schedule'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const EXPEDIA_RE = /expedia|hotels\.com|orbitz|egencia|travelocity/

export type LaborDay = {
  date: string
  ahead: boolean
  cleans: number            // departure cleans on the board that day
  other: number             // the rest of the cleaning work (prep, strip, touch-up)
  people: number            // how many of ours are on it
  revenue: number           // cleaning fees on those checkouts
  hours: number | null
  cost: number | null
  basis: 'actual' | 'scheduled' | 'none'
}
export type LaborPerson = {
  name: string; market: string
  cleans: number; other: number; days: number
  hours: number | null      // punched hours inside the window (past days only)
  cost: number | null
}
export type ScheduleLabor = {
  from: string; to: string; today: string
  days: LaborDay[]
  people: LaborPerson[]
  totals: {
    cleans: number; other: number; revenue: number
    actualHours: number; actualCost: number; actualDays: number
    scheduledHours: number; scheduledCost: number; scheduledDays: number
    /** revenue − actual − scheduled, only meaningful when the window is all one or all the other. */
    perClean: number | null
    revenuePerClean: number | null
  }
  /** False when Homebase came back short. Every cost below is then understated — show the warning. */
  payrollComplete: boolean
  notes: string[]
}

/** Every job on the planner, flattened, with the person it belongs to. */
function jobsOf(plan: TeamSchedule) {
  const out: { name: string; market: string; date: string; listingId: string; task: string; isClean: boolean }[] = []
  for (const b of plan.markets) {
    for (const p of b.people) {
      for (const date of Object.keys(p.byDay)) {
        for (const j of p.byDay[date]) {
          out.push({ name: p.name, market: j.market || b.market, date, listingId: str(j.listingId), task: str(j.task), isClean: !!j.isClean })
        }
      }
    }
  }
  return out
}

/**
 * Price the planner that was just built.
 *
 * `plan` must be the cleaning planner — maintenance is a different trade with a different rate and
 * belongs in its own section, so a maintenance planner is priced for hours only and never for
 * cleaning revenue.
 */
export async function scheduleLabor(plan: TeamSchedule, today: string): Promise<ScheduleLabor> {
  const db = supabaseAdmin()
  const jobs = jobsOf(plan)
  const notes: string[] = []
  const dates = plan.days.map(d => d.date)
  const past = dates.filter(d => d < today)
  const ahead = dates.filter(d => d >= today)

  // ── REVENUE: the cleaning fee on the checkout each departure clean belongs to ────────────────
  // Matched on (unit, day): a departure clean on day D at unit U is the turnover of the stay that
  // checked out of U that morning. Padded nine days back so a clean sitting on day one of the
  // window, whose checkout was earlier, still finds its fee — the same padding labor-econ uses.
  const listingIds = Array.from(new Set(jobs.map(j => j.listingId).filter(Boolean)))
  const feeOf = new Map<string, number>()          // listingId|checkout -> fee
  const modal: Record<string, Record<string, number>> = {}
  if (listingIds.length) {
    const back = new Date(plan.from + 'T12:00:00Z'); back.setUTCDate(back.getUTCDate() - 9)
    const rows: any[] = []
    for (let i = 0; i < listingIds.length; i += 100) {
      const { data } = await db.from('guesty_reservations')
        .select('listing_id,check_out,status,source,cleaning:raw->money->>fareCleaning,grossFare:raw->money->>fareAccommodationAdjusted')
        .in('listing_id', listingIds.slice(i, i + 100))
        .gte('check_out', back.toISOString().slice(0, 10)).lte('check_out', plan.to)
        .not('status', 'in', '("canceled","cancelled","declined")')
        .limit(1000)
      rows.push(...(data || []))
    }
    // Expedia bundles the cleaning fee into the fare, so those checkouts arrive at zero. Rebuild
    // from the unit's own non-Expedia bookings — modal, capped at the fare, skipped where the unit
    // has no history to learn from. Same rule as labor-econ and the owner report, so all three agree.
    for (const r of rows) {
      const c = num(r.cleaning)
      if (c > 0 && !EXPEDIA_RE.test(str(r.source).toLowerCase())) {
        const id = str(r.listing_id), k = String(Math.round(c))
        modal[id] = modal[id] || {}; modal[id][k] = (modal[id][k] || 0) + 1
      }
    }
    const best: Record<string, number> = {}
    for (const id in modal) {
      let b = 0, bn = 0
      for (const k in modal[id]) if (modal[id][k] > bn) { bn = modal[id][k]; b = Number(k) }
      best[id] = b
    }
    let filled = 0
    for (const r of rows) {
      const id = str(r.listing_id)
      let fee = num(r.cleaning)
      if (!(fee > 0) && EXPEDIA_RE.test(str(r.source).toLowerCase())) {
        const take = Math.min(best[id] || 0, num(r.grossFare))
        if (take > 0) { fee = take; filled++ }
      }
      if (fee > 0) feeOf.set(id + '|' + str(r.check_out).slice(0, 10), fee)
    }
    if (filled) notes.push(`${filled} Expedia checkout${filled === 1 ? '' : 's'} had the cleaning fee bundled into the fare — rebuilt from that unit's usual fee.`)
  }

  // ── THE BOARD, BY DAY ───────────────────────────────────────────────────────────────────────
  const byDate = new Map<string, LaborDay>()
  for (const d of plan.days) {
    byDate.set(d.date, {
      date: d.date, ahead: d.date >= today, cleans: 0, other: 0, people: 0,
      revenue: 0, hours: null, cost: null, basis: 'none',
    })
  }
  const seenPerDay = new Map<string, Set<string>>()
  const seenFee = new Set<string>()
  for (const j of jobs) {
    const row = byDate.get(j.date); if (!row) continue
    const departure = j.isClean && isDepartureCleanName(j.task)
    if (departure) row.cleans++; else row.other++
    if (!seenPerDay.has(j.date)) seenPerDay.set(j.date, new Set())
    seenPerDay.get(j.date)!.add(j.name)
    // One fee per checkout, however many people are on the clean.
    if (departure && j.listingId) {
      const k = j.listingId + '|' + j.date
      if (!seenFee.has(k)) { seenFee.add(k); row.revenue += feeOf.get(k) || 0 }
    }
  }
  for (const [date, set] of Array.from(seenPerDay.entries())) {
    const row = byDate.get(date); if (row) row.people = set.size
  }

  // ── LABOR, PAST: punches ────────────────────────────────────────────────────────────────────
  let payrollComplete = true
  const punchedBy = new Map<string, { hours: number; cost: number }>()
  if (past.length) {
    try {
      const audit = await getTimecardsAudited(past[0], past[past.length - 1])
      payrollComplete = audit.complete !== false
      if (!payrollComplete) notes.push('Homebase came back short for part of this window — actual hours and cost are understated.')
      const perDay = new Map<string, { hours: number; cost: number }>()
      for (const c of audit.cards) {
        const d = str(c.date).slice(0, 10)
        if (!d || d < past[0] || d > past[past.length - 1]) continue
        const h = num(c.hours), cost = num(c.laborCost)
        const dd = perDay.get(d) || { hours: 0, cost: 0 }
        dd.hours += h; dd.cost += cost; perDay.set(d, dd)
        const pk = str(c.name).toLowerCase()
        const pp = punchedBy.get(pk) || { hours: 0, cost: 0 }
        pp.hours += h; pp.cost += cost; punchedBy.set(pk, pp)
      }
      for (const [d, v] of Array.from(perDay.entries())) {
        const row = byDate.get(d); if (!row) continue
        row.hours = Math.round(v.hours * 10) / 10; row.cost = Math.round(v.cost); row.basis = 'actual'
      }
    } catch {
      payrollComplete = false
      notes.push('Homebase did not answer for the past days in this window — no actual labor to show.')
    }
  }

  // ── LABOR, AHEAD: scheduled shifts ──────────────────────────────────────────────────────────
  // Capped at seven days out: Homebase is one call per day and a month-long board would be thirty
  // round trips for a number nobody has finalised yet.
  const AHEAD_CAP = 7
  for (const d of ahead.slice(0, AHEAD_CAP)) {
    try {
      const shifts = await getShifts(d)
      if (!shifts.length) continue
      let hours = 0, cost = 0, priced = 0
      for (const s of shifts) {
        const a = new Date(str(s.startAt)).getTime(), b = new Date(str(s.endAt)).getTime()
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) hours += (b - a) / 3600000
        if (s.scheduledCost != null) { cost += num(s.scheduledCost); priced++ }
        else if (s.wageRate != null && Number.isFinite(a) && Number.isFinite(b) && b > a) { cost += num(s.wageRate) * ((b - a) / 3600000); priced++ }
      }
      const row = byDate.get(d); if (!row) continue
      row.hours = Math.round(hours * 10) / 10
      row.cost = priced ? Math.round(cost) : null
      row.basis = 'scheduled'
    } catch { /* a day Homebase will not answer for stays 'none' rather than a zero */ }
  }
  if (ahead.length > AHEAD_CAP) notes.push(`Scheduled labor is shown for the first ${AHEAD_CAP} days ahead; beyond that the shifts are rarely set.`)

  // ── PER PERSON ──────────────────────────────────────────────────────────────────────────────
  const pMap = new Map<string, LaborPerson>()
  for (const j of jobs) {
    const k = j.name.toLowerCase()
    const p = pMap.get(k) || { name: j.name, market: j.market, cleans: 0, other: 0, days: 0, hours: null, cost: null }
    if (j.isClean && isDepartureCleanName(j.task)) p.cleans++; else p.other++
    pMap.set(k, p)
  }
  const daysPer = new Map<string, Set<string>>()
  for (const j of jobs) {
    const k = j.name.toLowerCase()
    if (!daysPer.has(k)) daysPer.set(k, new Set())
    daysPer.get(k)!.add(j.date)
  }
  for (const [k, p] of Array.from(pMap.entries())) {
    p.days = (daysPer.get(k) || new Set()).size
    // Punches are keyed by the Homebase spelling, the board by the roster spelling. Match the way
    // every other screen does rather than on an exact string, or half the crew reads as unpaid.
    for (const [pk, v] of Array.from(punchedBy.entries())) {
      if (nameMatches(pk, p.name)) {
        p.hours = Math.round(((p.hours || 0) + v.hours) * 10) / 10
        p.cost = Math.round((p.cost || 0) + v.cost)
      }
    }
  }

  const days = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  const t = {
    cleans: days.reduce((a, d) => a + d.cleans, 0),
    other: days.reduce((a, d) => a + d.other, 0),
    revenue: Math.round(days.reduce((a, d) => a + d.revenue, 0)),
    actualHours: Math.round(days.filter(d => d.basis === 'actual').reduce((a, d) => a + (d.hours || 0), 0) * 10) / 10,
    actualCost: Math.round(days.filter(d => d.basis === 'actual').reduce((a, d) => a + (d.cost || 0), 0)),
    actualDays: days.filter(d => d.basis === 'actual').length,
    scheduledHours: Math.round(days.filter(d => d.basis === 'scheduled').reduce((a, d) => a + (d.hours || 0), 0) * 10) / 10,
    scheduledCost: Math.round(days.filter(d => d.basis === 'scheduled').reduce((a, d) => a + (d.cost || 0), 0)),
    scheduledDays: days.filter(d => d.basis === 'scheduled').length,
    perClean: null as number | null,
    revenuePerClean: null as number | null,
  }
  // Cost per clean only where the cost is a fact: the days that have been worked and punched.
  const actualCleans = days.filter(d => d.basis === 'actual').reduce((a, d) => a + d.cleans, 0)
  if (actualCleans > 0 && t.actualCost > 0) t.perClean = Math.round(t.actualCost / actualCleans)
  if (t.cleans > 0 && t.revenue > 0) t.revenuePerClean = Math.round(t.revenue / t.cleans)

  return {
    from: plan.from, to: plan.to, today,
    days, people: Array.from(pMap.values()).sort((a, b) => b.cleans - a.cleans || a.name.localeCompare(b.name)),
    totals: t, payrollComplete, notes,
  }
}
