// OUR STORY — the year in numbers (Jon, 2026-11-26): "share all historical stats of tasks completed,
// maintenance, cleans, inspections YTD, and any other stats — messages, guests hosted. This should
// live in the team history page … our story … like a history page of our stats. Let's start with
// YTD stats."
//
// ONE SNAPSHOT of the year to date, computed from what Lighthouse already holds:
//   the work      breezeway_tasks_sync   finished + closed tasks, by department, month, person, day
//   the guests    guesty_reservations    confirmed + closed stays that have checked in, nights, channels
//   the reviews   guesty_reviews         count, average (5-scale), five-star share (per-channel rule)
//   the talk      guesty_messages, talkroute_calls
//   the care      glitches, claims, lost & found, auto inspections, Eve
//
// HONEST COVERAGE. Tasks, stays and reviews go back before January, so their year is a full year.
// Messages, calls, guest issues and claims only started syncing part-way through — each of those
// carries `since` (the first month with real volume) and the page prints it beside the number.
// Nothing is estimated: party size is recorded on about a third of stays, so there is no
// "guests hosted" figure — stays, nights and distinct guests who booked are exact.
//
// The scan is ~35k slim rows; the result is cached in app_settings for three hours.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { getSettingFresh, setSetting } from './app-settings'
import { isDepartureCleanName } from './breezeway'
import { isFiveStarReview } from './review-scale'
import { isOwnerOrFriendsFamily } from './owner-audit'

const str = (v: any) => (v == null ? '' : String(v))
const ymdET = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type Leader = { name: string; n: number }
export type Covered = { total: number; since: string | null; monthly: number[] }
export type YearStats = {
  ok: true; year: number; asOf: string; computedAt: string; months: string[]; partial: string[]
  work: {
    total: number; cleans: number; departureCleans: number; maintenance: number; inspections: number
    hours: number; people: number; units: number
    monthly: { housekeeping: number[]; maintenance: number[]; inspection: number[] }
    busiestDay: { date: string; n: number } | null; bestMonth: { month: string; n: number } | null
    leaders: { housekeeping: Leader[]; maintenance: Leader[]; inspection: Leader[] }
  }
  guests: {
    stays: number; nights: number; uniqueGuests: number; ownerStays: number; listings: number; avgNights: number
    monthly: number[]; channels: { name: string; n: number }[]
    busiestArrival: { date: string; n: number } | null
  }
  reviews: { total: number; avg: number | null; fiveStar: number; fiveStarShare: number | null; replied: number; monthly: number[] }
  talk: { guestMessages: Covered; teamMessages: Covered; automated: Covered; calls: Covered & { inbound: number; outbound: number; talkHours: number }; welcomeCalls: number }
  care: { guestIssues: Covered & { closed: number }; claims: Covered & { paid: number; recovered: number }; lostFound: number; autoInspections: number; eveAnswers: number; eveActions: number; guidebooks: number; ownerReports: number }
}

const CHANNEL: [RegExp, string][] = [[/airbnb/i, 'Airbnb'], [/booking/i, 'Booking.com'], [/expedia|hotels\.com|travelocity|orbitz|american express/i, 'Expedia group'], [/vrbo|homeaway/i, 'Vrbo'], [/be-api|website|direct|manual/i, 'Direct'], [/google/i, 'Google']]
const channelOf = (s: string) => { for (const [re, n] of CHANNEL) if (re.test(s)) return n; return 'Other' }
const top = (m: Record<string, number>, n: number): Leader[] => Object.keys(m).map(k => ({ name: k, n: m[k] })).sort((a, b) => b.n - a.n).slice(0, n)
const best = (m: Record<string, number>) => { const t = top(m, 1)[0]; return t ? { date: t.name, n: t.n } : null }
/** First month whose volume is at least a tenth of the best month — where real coverage starts. */
function since(monthly: number[], year: number): string | null {
  const max = Math.max(0, ...monthly)
  if (!max) return null
  const i = monthly.findIndex(v => v >= max / 10)
  return i <= 0 ? null : `${MONTHS[i]} ${year}`
}
const covered = (monthly: number[], year: number): Covered => ({ total: monthly.reduce((s, v) => s + v, 0), since: since(monthly, year), monthly })

async function count(table: string, f: (q: any) => any): Promise<number> {
  try { const { count: c, error } = await f(supabaseAdmin().from(table).select('*', { count: 'exact', head: true })); return error ? 0 : (c || 0) } catch { return 0 }
}

export async function computeYear(year: number): Promise<YearStats> {
  const db = supabaseAdmin()
  const today = ymdET()
  const from = `${year}-01-01`
  const to = today.slice(0, 4) === String(year) ? today : `${year}-12-31`
  const nMonths = Number(to.slice(5, 7))
  const zero = () => Array.from({ length: nMonths }, () => 0)
  const mi = (d: string) => Number(str(d).slice(5, 7)) - 1
  // Month edges for timestamp columns, in Eastern time (5h is close enough at a month boundary).
  const edge = (m: number) => m >= 12 ? `${year + 1}-01-01T05:00:00Z` : `${year}-${String(m + 1).padStart(2, '0')}-01T05:00:00Z`
  const partial: string[] = []

  const [tasks, stays, reviews, calls] = await Promise.all([
    pageRows((a, b) => db.from('breezeway_tasks_sync').select('id,type_department,name,scheduled_date,total_minutes,finished_by_name,assignee_name,reference_property_id')
      .in('status', ['finished', 'closed']).gte('scheduled_date', from).lte('scheduled_date', to).order('id').range(a, b), 60),
    pageRows((a, b) => db.from('guesty_reservations').select('id,check_in,nights,source,guest_id,guest_email,guest_name,listing_id')
      .in('status', ['confirmed', 'closed']).gte('check_in', from).lte('check_in', to).order('id').range(a, b), 40),
    pageRows((a, b) => db.from('guesty_reviews').select('id,rating,channel,created_at,has_reply').is('removed_at', null)
      .gte('created_at', edge(0)).lt('created_at', edge(12)).order('id').range(a, b), 20),
    pageRows((a, b) => db.from('talkroute_calls').select('id,direction,call_at,duration').gte('call_at', edge(0)).lt('call_at', edge(12)).order('id').range(a, b), 30),
  ])
  if (tasks.truncated) partial.push('tasks'); if (stays.truncated) partial.push('stays'); if (reviews.truncated) partial.push('reviews'); if (calls.truncated) partial.push('calls')

  // ---- the work
  const monthly = { housekeeping: zero(), maintenance: zero(), inspection: zero() }
  const byDay: Record<string, number> = {}, people: Record<string, boolean> = {}, units: Record<string, boolean> = {}
  const lead: Record<'housekeeping' | 'maintenance' | 'inspection', Record<string, number>> = { housekeeping: {}, maintenance: {}, inspection: {} }
  let minutes = 0, departure = 0
  for (const t of tasks.rows as any[]) {
    const dept = str(t.type_department) as 'housekeeping' | 'maintenance' | 'inspection'
    if (!monthly[dept]) continue
    const d = str(t.scheduled_date).slice(0, 10)
    monthly[dept][mi(d)]++
    byDay[d] = (byDay[d] || 0) + 1
    minutes += Number(t.total_minutes) || 0
    if (dept === 'housekeeping' && isDepartureCleanName(t.name)) departure++
    const who = str(t.finished_by_name || t.assignee_name).trim()
    if (who) { people[who] = true; lead[dept][who] = (lead[dept][who] || 0) + 1 }
    if (t.reference_property_id) units[str(t.reference_property_id)] = true
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  const monthTotals = zero().map((_, i) => monthly.housekeeping[i] + monthly.maintenance[i] + monthly.inspection[i])
  const bi = monthTotals.indexOf(Math.max(...monthTotals))

  // ---- the guests
  const stayMonthly = zero(), arrivals: Record<string, number> = {}, chan: Record<string, number> = {}, guestIds: Record<string, boolean> = {}, listings: Record<string, boolean> = {}
  let nights = 0, guestStays = 0, ownerStays = 0
  for (const r of stays.rows as any[]) {
    if (isOwnerOrFriendsFamily(str(r.source), '', str(r.guest_name))) { ownerStays++; continue }
    guestStays++
    const d = str(r.check_in).slice(0, 10)
    stayMonthly[mi(d)]++
    arrivals[d] = (arrivals[d] || 0) + 1
    nights += Number(r.nights) || 0
    chan[channelOf(str(r.source))] = (chan[channelOf(str(r.source))] || 0) + 1
    const g = str(r.guest_id || r.guest_email); if (g) guestIds[g] = true
    if (r.listing_id) listings[str(r.listing_id)] = true
  }

  // ---- reviews (stored on the 5-scale; five-star judged on each channel's own scale)
  const revMonthly = zero()
  let rSum = 0, rN = 0, five = 0, replied = 0
  for (const r of reviews.rows as any[]) {
    const m = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', month: '2-digit' }).format(new Date(r.created_at))) - 1
    if (m < nMonths) revMonthly[m]++
    if (r.has_reply) replied++
    const n = Number(r.rating)
    if (r.rating != null && Number.isFinite(n) && n > 0) { rSum += n; rN++; if (isFiveStarReview(n, r.channel)) five++ }
  }

  // ---- the talk
  const callMonthly = zero()
  let inbound = 0, outbound = 0, talkSec = 0
  for (const c of calls.rows as any[]) {
    const m = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', month: '2-digit' }).format(new Date(c.call_at))) - 1
    if (m < nMonths) callMonthly[m]++
    if (/in/i.test(str(c.direction))) inbound++; else outbound++
    talkSec += Number(c.duration) || 0
  }
  const msgMonthly = async (sender: string) => Promise.all(zero().map((_, i) => count('guesty_messages', q => q.eq('sender', sender).gte('sent_at', edge(i)).lt('sent_at', edge(i + 1)))))
  const tsMonthly = async (table: string, col: string, extra?: (q: any) => any) => Promise.all(zero().map((_, i) => count(table, q => (extra ? extra(q) : q).gte(col, edge(i)).lt(col, edge(i + 1)))))
  const [gm, hm, sm, glitchM, claimM, glitchClosed, lostFound, autoInsp, eveAnswers, eveActions, guidebooks, ownerReports, welcomeCalls, claimRows] = await Promise.all([
    msgMonthly('guest'), msgMonthly('host'), msgMonthly('system'),
    tsMonthly('glitches', 'created_at'), tsMonthly('claims', 'created_at', q => q.is('deleted_at', null)),
    count('glitches', q => q.gte('created_at', edge(0)).not('closed_at', 'is', null)),
    count('lost_found_items', q => q.gte('created_at', edge(0))),
    count('auto_inspections', q => q.gte('created_at', edge(0))),
    count('eve_chats', q => q.gte('created_at', edge(0))),
    count('eve_actions', q => q.gte('created_at', edge(0)).not('executed_at', 'is', null)),
    count('guidebooks', q => q.gte('created_at', edge(0))),
    count('owner_reports', q => q.gte('created_at', edge(0))),
    count('guest_calls', q => q.gte('called_at', edge(0))),
    db.from('claims').select('amount_paid,paid_on').is('deleted_at', null).gte('created_at', edge(0)).then(r => (r.data || []) as any[], () => [] as any[]),
  ])
  const paidClaims = claimRows.filter(c => Number(c.amount_paid) > 0)

  return {
    ok: true, year, asOf: to, computedAt: new Date().toISOString(), months: MONTHS.slice(0, nMonths), partial,
    work: {
      total: sum(monthTotals), cleans: sum(monthly.housekeeping), departureCleans: departure, maintenance: sum(monthly.maintenance), inspections: sum(monthly.inspection),
      hours: Math.round(minutes / 60), people: Object.keys(people).length, units: Object.keys(units).length, monthly,
      busiestDay: best(byDay), bestMonth: bi >= 0 && monthTotals[bi] ? { month: MONTHS[bi], n: monthTotals[bi] } : null,
      leaders: { housekeeping: top(lead.housekeeping, 5), maintenance: top(lead.maintenance, 5), inspection: top(lead.inspection, 5) },
    },
    guests: {
      stays: guestStays, nights, uniqueGuests: Object.keys(guestIds).length, ownerStays, listings: Object.keys(listings).length,
      avgNights: guestStays ? Math.round(nights / guestStays * 10) / 10 : 0, monthly: stayMonthly,
      channels: top(chan, 6), busiestArrival: best(arrivals),
    },
    reviews: { total: reviews.rows.length, avg: rN ? Math.round(rSum / rN * 100) / 100 : null, fiveStar: five, fiveStarShare: rN ? five / rN : null, replied, monthly: revMonthly },
    talk: {
      guestMessages: covered(gm, year), teamMessages: covered(hm, year), automated: covered(sm, year),
      calls: { ...covered(callMonthly, year), inbound, outbound, talkHours: Math.round(talkSec / 3600) }, welcomeCalls,
    },
    care: {
      guestIssues: { ...covered(glitchM, year), closed: glitchClosed },
      claims: { ...covered(claimM, year), paid: paidClaims.length, recovered: Math.round(paidClaims.reduce((s, c) => s + Number(c.amount_paid), 0)) },
      lostFound, autoInspections: autoInsp, eveAnswers, eveActions, guidebooks, ownerReports,
    },
  }
}

const TTL = 3 * 60 * 60 * 1000
export async function yearStats(year: number, refresh = false): Promise<YearStats> {
  const key = `history_year_${year}`
  if (!refresh) {
    const hit = await getSettingFresh<YearStats | null>(key, null).catch(() => null)
    if (hit?.ok && hit.asOf === (ymdET().slice(0, 4) === String(year) ? ymdET() : `${year}-12-31`) && Date.now() - new Date(hit.computedAt).getTime() < TTL) return hit
  }
  const fresh = await computeYear(year)
  if (!fresh.partial.length) await setSetting(key, fresh, 'history').catch(() => {})
  return fresh
}
