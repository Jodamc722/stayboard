// The baseline engine. Trends only mean something against a baseline, so this is what has to exist
// before Eve can say anything stronger than "that number looks lower".
//
// HOW IT WORKS. One pass over the source tables for a whole date range, bucketed per day and per
// scope, rather than N queries per day. That is what makes a 90-day backfill affordable — the naive
// "loop the days, query each one" version is 90x the queries and times out well before it finishes.
//
// SCOPES ARE PORTFOLIO + BUILDING ONLY. Unit-level would be ~235 x 25 metrics x 365 days, which is
// both expensive and statistically useless — a single unit's daily occupancy is 0 or 1, so its
// "baseline" is noise. Buildings are where the signal is.
//
// TWO CLASSES OF METRIC, AND THE DIFFERENCE MATTERS:
//   BACKFILLABLE — computed from dated records (a reservation, a review, a finished task). We can
//                  reconstruct any past day, so the 90-day backfill gives real history immediately.
//   FORWARD-ONLY — point-in-time state ("how many field requests are open RIGHT NOW"). There is no
//                  honest way to reconstruct what was open last Tuesday, so these start from the day
//                  the job first runs and their baselines are thin for ~3 weeks. Eve is told this so
//                  she does not quote a z-score off four data points.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupBuilding } from '@/lib/optimize-score'
import { isDepartureCleanName } from '@/lib/breezeway'
import { isTaskDone } from '@/lib/task-categories'
import { bucketFor, familyFor } from '@/lib/marketing'
import { todayET, shiftDay, lc, num, round2, normStar, DEAD_LISTING, pageRows } from './ctx'
import { LIVE_STAY_STATUSES, channelFeeOf, NET_BASIS_NOTE } from '@/lib/basis'
import { isOwnerOrFriendsFamily } from '@/lib/owner-audit'

export type MetricRow = { day: string; scope: string; metric: string; value: number | null; n: number }

export type MetricDef = {
  key: string; label: string; unit: 'pct' | 'usd' | 'count' | 'rating' | 'minutes'; backfillable: boolean; higherIsBetter: boolean | null
  /** What exactly is counted — returned with every trend so a number is never quoted without its definition. */
  basis?: string
  /** A daily value that must be averaged across days (weighted by n), never summed. */
  rate?: boolean
  /** Kept so history and already-logged recommendations stay comparable; `useInstead` is the measure on the one basis. */
  legacy?: boolean
  useInstead?: string
}

// THE ONE BASIS, AS NEW MEASURES — NOT A SILENT REDEFINITION (Eve reorganisation, 2026-11-10).
//
// The original money measures below (revenue / adr / revpar / occupancy / nights_sold / bookings_made /
// cancel_rate) were written before lib/basis.ts: accommodation PLUS cleaning, before the channel fee,
// with `closed` and `reserved` requests counted as stays and owner stays counted as demand. They no
// longer match the KPI board or Revenue Center.
//
// Changing what those keys mean would have put a step in every stored series: a 90-day baseline on
// the old definition against a new day on the new one reads as a three-sigma collapse that never
// happened, and every recommendation already logged against `revenue` or `adr` (its baseline is
// frozen on the row — lib/eve/recommendations.ts) would be graded against a different number.
// So the old keys keep computing exactly what they always did, are labelled `legacy` with their real
// definition, and the measures on the one basis are NEW keys:
//   net_revenue · net_adr · net_revpar · guest_nights · occupancy_dated · guest_bookings_made · guest_cancel_rate
// The new keys have history only from the first night this code runs (three days back); the metrics
// job with ?backfill=90 fills the rest, and until then `trend` says "no data yet", which is true.
const LEGACY_MONEY = 'LEGACY basis: accommodation (fareAccommodationAdjusted) + cleaning, BEFORE the channel fee; counts closed/reserved requests and owner stays. Does not match the KPI board.'
const ONE_BASIS = `${NET_BASIS_NOTE}. Real stays only (${LIVE_STAY_STATUSES.join(' / ')}); owner and friends-and-family stays are left out.`

/** The catalogue. Anything Eve can trend has to be declared here so she cannot invent a metric name. */
export const METRICS: MetricDef[] = [
  // --- revenue (backfillable from reservations) ---
  // --- revenue on THE ONE BASIS (lib/basis.ts) — use these ---
  { key: 'net_revenue', label: 'Net revenue (accommodation after channel fee)', unit: 'usd', backfillable: true, higherIsBetter: true, basis: ONE_BASIS },
  { key: 'net_adr', label: 'ADR (net, guest nights)', unit: 'usd', backfillable: true, higherIsBetter: true, rate: true, basis: ONE_BASIS + ' Net revenue ÷ guest nights.' },
  { key: 'net_revpar', label: 'RevPAR (net, sellable nights)', unit: 'usd', backfillable: true, higherIsBetter: true, rate: true, basis: ONE_BASIS + ' Net revenue ÷ sellable nights (units live that day, less owner-held nights).' },
  { key: 'guest_nights', label: 'Guest nights sold', unit: 'count', backfillable: true, higherIsBetter: true, basis: `Nights of real stays (${LIVE_STAY_STATUSES.join(' / ')}) by guests; owner and friends-and-family nights left out.` },
  { key: 'occupancy_dated', label: 'Occupancy % (units live that day)', unit: 'pct', backfillable: true, higherIsBetter: true, basis: `Held nights (guest + owner, as the KPI board counts occupancy) of real stays ÷ the units that were live THAT day — a currently-active listing counts from the day it was created in Guesty. Units since retired are not in the denominator (their history is not kept).` },
  { key: 'guest_bookings_made', label: 'Guest bookings made', unit: 'count', backfillable: true, higherIsBetter: true, basis: 'Bookings created that day, owner and friends-and-family holds left out.' },
  { key: 'guest_cancel_rate', label: 'Guest cancellation rate %', unit: 'pct', backfillable: true, higherIsBetter: false, basis: 'Share of guest bookings created that day that are now cancelled / declined / expired; owner and friends-and-family holds left out.' },
  // --- the original measures, kept as they were (see the note above) ---
  { key: 'occupancy', label: 'Occupancy % (legacy: today\'s unit count)', unit: 'pct', backfillable: true, higherIsBetter: true, legacy: true, useInstead: 'occupancy_dated', basis: 'LEGACY: nights of live-looking reservations (closed/reserved included) ÷ the number of units active TODAY, for every past day — understated for days before newer units existed.' },
  { key: 'adr', label: 'ADR (legacy: gross incl. cleaning)', unit: 'usd', backfillable: true, higherIsBetter: true, legacy: true, useInstead: 'net_adr', basis: LEGACY_MONEY },
  { key: 'revpar', label: 'RevPAR (legacy: gross incl. cleaning)', unit: 'usd', backfillable: true, higherIsBetter: true, legacy: true, useInstead: 'net_revpar', basis: LEGACY_MONEY + ' Divided by the number of units active TODAY.' },
  { key: 'revenue', label: 'Revenue (legacy: gross incl. cleaning)', unit: 'usd', backfillable: true, higherIsBetter: true, legacy: true, useInstead: 'net_revenue', basis: LEGACY_MONEY },
  { key: 'nights_sold', label: 'Nights sold (legacy: incl. owner stays)', unit: 'count', backfillable: true, higherIsBetter: true, legacy: true, useInstead: 'guest_nights', basis: 'LEGACY: every night of a live-looking reservation, closed/reserved requests and owner stays included.' },
  { key: 'arrivals', label: 'Arrivals', unit: 'count', backfillable: true, higherIsBetter: null, basis: 'Check-ins that day, owner stays included (a unit to prepare either way).' },
  { key: 'bookings_made', label: 'Bookings made (legacy: incl. owner holds)', unit: 'count', backfillable: true, higherIsBetter: true, legacy: true, useInstead: 'guest_bookings_made', basis: 'LEGACY: every reservation row created that day, owner holds and inquiries included.' },
  { key: 'direct_share', label: 'Direct booking share %', unit: 'pct', backfillable: true, higherIsBetter: true, basis: 'Share of reservation rows created that day whose source is direct (lib/marketing).' },
  { key: 'cancel_rate', label: 'Cancellation rate % (legacy: incl. owner holds)', unit: 'pct', backfillable: true, higherIsBetter: false, legacy: true, useInstead: 'guest_cancel_rate', basis: 'LEGACY: share of ALL reservation rows created that day that are now dead — owner holds and inquiries included.' },
  // --- ops (backfillable from the Breezeway mirror) ---
  { key: 'cleans_done', label: 'Departure cleans completed', unit: 'count', backfillable: true, higherIsBetter: null },
  { key: 'cleans_unassigned', label: 'Cleans with nobody assigned', unit: 'count', backfillable: true, higherIsBetter: false },
  { key: 'clean_minutes', label: 'Average minutes per clean', unit: 'minutes', backfillable: true, higherIsBetter: false },
  { key: 'tasks_completed', label: 'All tasks completed', unit: 'count', backfillable: true, higherIsBetter: null },
  { key: 'glitches_new', label: 'Guest issues opened', unit: 'count', backfillable: true, higherIsBetter: false },
  // --- quality (backfillable from reviews / sentiment) ---
  { key: 'review_avg', label: 'Average review (/5)', unit: 'rating', backfillable: true, higherIsBetter: true },
  { key: 'review_count', label: 'Reviews received', unit: 'count', backfillable: true, higherIsBetter: null },
  { key: 'five_star_share', label: 'Five-star share %', unit: 'pct', backfillable: true, higherIsBetter: true },
  { key: 'low_reviews', label: 'Reviews at 3 stars or below', unit: 'count', backfillable: true, higherIsBetter: false },
  { key: 'sentiment_negative', label: 'Unhappy guest threads', unit: 'count', backfillable: true, higherIsBetter: false },
  // --- point-in-time state (forward only) ---
  { key: 'open_field_work', label: 'Open field work', unit: 'count', backfillable: false, higherIsBetter: false },
  { key: 'glitches_open', label: 'Open guest issues', unit: 'count', backfillable: false, higherIsBetter: false },
  { key: 'unanswered_reviews', label: 'Unanswered reviews (60d)', unit: 'count', backfillable: false, higherIsBetter: false },
  { key: 'active_units', label: 'Active units', unit: 'count', backfillable: false, higherIsBetter: null },
]
export const METRIC_BY_KEY: Record<string, MetricDef> = METRICS.reduce((m, d) => { m[d.key] = d; return m }, {} as Record<string, MetricDef>)
export const BACKFILLABLE = METRICS.filter(m => m.backfillable).map(m => m.key)

const LIVE_RES = /confirmed|checked_in|checked_out|closed|reserved/i
const DEAD_RES = /cancel|declin|inquir|expire|denied|unavailable/i

type Acc = Record<string, Record<string, { sum: number; n: number; extra?: number }>>
const bump = (acc: Acc, scope: string, metric: string, value: number, extra = 0) => {
  if (!acc[scope]) acc[scope] = {}
  if (!acc[scope][metric]) acc[scope][metric] = { sum: 0, n: 0, extra: 0 }
  const cell = acc[scope][metric]
  cell.sum += value
  cell.n += 1
  cell.extra = (cell.extra || 0) + extra
}

/**
 * Compute every backfillable metric for every day in [from, to], for portfolio + each building.
 * ONE pass over each source table. Returns rows ready to upsert into eve_metrics.
 */
export async function computeRange(from: string, to: string): Promise<MetricRow[]> {
  const db = supabaseAdmin()

  // ---- listing registry: unit counts per scope drive occupancy and RevPAR denominators ----
  // The created date rides along as one JSON-path scalar (rule 1), for the dated denominator below.
  // If that read fails the plain columns are read as before and every unit counts from day one.
  let listings: any[] | null = null
  try {
    const withCreated: any = await db.from('guesty_listings').select('id,nickname,title,status,building,created:raw->>createdAt').order('id')
    if (!withCreated?.error && Array.isArray(withCreated?.data)) listings = withCreated.data
  } catch { listings = null }
  if (!listings) {
    const plain: any = await db.from('guesty_listings').select('id,nickname,title,status,building').order('id')
    listings = (plain?.data as any[]) || []
  }
  const meta: Record<string, { building: string; active: boolean }> = {}
  const unitsByScope: Record<string, number> = { portfolio: 0 }
  // scope -> the day each active unit went live (''= unknown, counts from the start)
  const liveFromByScope: Record<string, string[]> = { portfolio: [] }
  for (const l of (listings || [])) {
    const row: any = l
    const b = rollupBuilding(row.building, row.nickname || row.title)
    const active = !DEAD_LISTING.test(lc(row.status))
    meta[String(row.id)] = { building: b, active }
    if (!active) continue
    unitsByScope.portfolio++
    const s = 'building:' + b
    unitsByScope[s] = (unitsByScope[s] || 0) + 1
    const created = /^\d{4}-\d{2}-\d{2}/.test(String(row.created || '')) ? String(row.created).slice(0, 10) : ''
    liveFromByScope.portfolio.push(created)
    if (!liveFromByScope[s]) liveFromByScope[s] = []
    liveFromByScope[s].push(created)
  }
  /** Active units that already existed on `day` — the denominator for that day, not for today. */
  const unitsLiveOn = (scope: string, day: string): number => {
    const list = liveFromByScope[scope] || []
    let n = 0
    for (const c of list) if (!c || c <= day) n++
    return n
  }
  const scopesOf = (listingId: any): string[] => {
    const m = meta[String(listingId)]
    if (!m) return ['portfolio']
    return ['portfolio', 'building:' + m.building]
  }

  // days in range
  const days: string[] = []
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d)
  const dayIndex: Record<string, true> = {}
  for (const d of days) dayIndex[d] = true

  // per-day accumulator
  const byDay: Record<string, Acc> = {}
  for (const d of days) byDay[d] = {}

  // ---- 1. Reservations. Pull anything OVERLAPPING the window, plus anything CREATED in it. ----
  // Rule 1: money via the JSON-path scalars, never raw->money.
  const RES_COLS = 'id,listing_id,check_in,check_out,nights,status,source,guest_name,money_total,created_at,'
    + 'accom:raw->money->>fareAccommodationAdjusted,accom2:raw->money->>fareAccommodation,clean:raw->money->>fareCleaning,'
    + 'fee:raw->money->>hostServiceFee,fee_inc:raw->money->>hostServiceFeeIncTax,tags:raw->tags'
  // Owner / friends-and-family: the one shared test (lib/owner-audit), on source, tags and guest name.
  const ownerish = (r: any): boolean => {
    const tagBlob = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).join(' ') : ''
    try { return isOwnerOrFriendsFamily(String(r.source || ''), tagBlob, String(r.guest_name || '')) } catch { return false }
  }
  const realStay = (st: any): boolean => LIVE_STAY_STATUSES.indexOf(lc(st)) >= 0
  const resv: any[] = []
  for (let page = 0; page < 25; page++) {
    const { data, error } = await db.from('guesty_reservations').select(RES_COLS)
      .lte('check_in', to).gte('check_out', from)
      .order('id').range(page * 1000, page * 1000 + 999)
    if (error) break
    resv.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  const created: any[] = []
  for (let page = 0; page < 25; page++) {
    const { data, error } = await db.from('guesty_reservations').select('id,listing_id,status,source,guest_name,created_at,tags:raw->tags')
      .gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z')
      .order('id').range(page * 1000, page * 1000 + 999)
    if (error) break
    created.push(...(data || []))
    if ((data || []).length < 1000) break
  }

  for (const r of resv) {
    if (DEAD_RES.test(lc(r.status)) || !LIVE_RES.test(lc(r.status))) continue
    const ci = String(r.check_in || '').slice(0, 10)
    const co = String(r.check_out || '').slice(0, 10)
    if (!ci || !co) continue
    const totalNights = Math.max(1, num(r.nights) || 1)
    const fare = num(r.accom) || num(r.accom2) || num(r.money_total)
    const perNight = fare / totalNights
    const scopes = scopesOf(r.listing_id)
    // one row per occupied night inside the window
    for (let d = ci > from ? ci : from; d < co && d <= to; d = shiftDay(d, 1)) {
      if (!dayIndex[d]) continue
      for (const s of scopes) {
        bump(byDay[d], s, 'nights_sold', 1)
        bump(byDay[d], s, 'revenue', perNight)
      }
    }
    if (dayIndex[ci]) for (const s of scopes) bump(byDay[ci], s, 'arrivals', 1)
    // cleaning revenue lands on the checkout date, same rule the KPI board uses
    if (dayIndex[co]) for (const s of scopes) bump(byDay[co], s, 'revenue', num(r.clean))
  }

  // ---- 1b. The same reservations on THE ONE BASIS (lib/basis.ts): real stays only, net of the
  //      channel fee, no cleaning, owner / friends-and-family nights held apart. ----
  for (const r of resv) {
    if (!realStay(r.status)) continue
    const ci = String(r.check_in || '').slice(0, 10)
    const co = String(r.check_out || '').slice(0, 10)
    if (!ci || !co) continue
    const totalNights = Math.max(1, num(r.nights) || 1)
    const owner = ownerish(r)
    const netPerNight = owner ? 0 : Math.max(0, num(r.accom) - channelFeeOf(num(r.fee_inc), num(r.fee))) / totalNights
    const scopes = scopesOf(r.listing_id)
    for (let d = ci > from ? ci : from; d < co && d <= to; d = shiftDay(d, 1)) {
      if (!dayIndex[d]) continue
      for (const s of scopes) {
        bump(byDay[d], s, 'held_nights', 1)
        if (owner) bump(byDay[d], s, 'owner_nights', 1)
        else { bump(byDay[d], s, 'guest_nights', 1); bump(byDay[d], s, 'net_revenue', netPerNight) }
      }
    }
  }

  for (const r of created) {
    const d = String(r.created_at || '').slice(0, 10)
    if (!dayIndex[d]) continue
    const scopes = scopesOf(r.listing_id)
    const dead = DEAD_RES.test(lc(r.status))
    const direct = familyFor(bucketFor(r.source)) === 'direct'
    // An owner hold is an inventory decision, not a guest booking and not a guest walking away.
    const guest = !ownerish(r) && !/inquir/i.test(lc(r.status))
    for (const s of scopes) {
      bump(byDay[d], s, 'bookings_made', 1)
      bump(byDay[d], s, 'direct_share', direct ? 1 : 0)
      bump(byDay[d], s, 'cancel_rate', dead ? 1 : 0)
      if (guest) { bump(byDay[d], s, 'guest_bookings_made', 1); bump(byDay[d], s, 'guest_cancel_rate', dead ? 1 : 0) }
    }
  }

  // ---- 2. Breezeway work ----
  const tasks: any[] = []
  for (let page = 0; page < 15; page++) {
    const { data, error } = await db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,assignees,finished_at,total_minutes,type_department')
      .gte('scheduled_date', from).lte('scheduled_date', to)
      .order('id').range(page * 1000, page * 1000 + 999)
    if (error) break
    tasks.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  for (const t of tasks) {
    const d = String(t.scheduled_date || '').slice(0, 10)
    if (!dayIndex[d]) continue
    const s2 = lc(t.status)
    if (/delete|cancel/.test(s2)) continue
    const done = isTaskDone(s2, t.finished_at)
    const scopes = scopesOf(t.reference_property_id)
    for (const s of scopes) {
      if (done) bump(byDay[d], s, 'tasks_completed', 1)
      if (isDepartureCleanName(t.name)) {
        if (done) bump(byDay[d], s, 'cleans_done', 1)
        const who = Array.isArray(t.assignees) ? t.assignees.length : 0
        bump(byDay[d], s, 'cleans_unassigned', who ? 0 : 1)
        const mins = num(t.total_minutes)
        if (done && mins > 0) bump(byDay[d], s, 'clean_minutes', mins)
      }
    }
  }

  // ---- 3. Reviews ----
  const reviews: any[] = []
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db.from('guesty_reviews').select('id,listing_id,rating,created_at,excluded_from_score')
      .gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z')
      .order('id').range(page * 1000, page * 1000 + 999)
    if (error) break
    reviews.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  for (const r of reviews) {
    if (r.excluded_from_score === true) continue
    const d = String(r.created_at || '').slice(0, 10)
    if (!dayIndex[d]) continue
    const stars = normStar(r.rating)
    if (stars == null) continue
    for (const s of scopesOf(r.listing_id)) {
      bump(byDay[d], s, 'review_count', 1)
      bump(byDay[d], s, 'review_avg', stars)
      bump(byDay[d], s, 'five_star_share', stars >= 4.75 ? 1 : 0)
      bump(byDay[d], s, 'low_reviews', stars <= 3 ? 1 : 0)
    }
  }

  // ---- 4. Guest issues + sentiment ----
  // Paged in key order like the reads above (2026-09-29): a backfill window holds more than one
  // 1,000-row page of either. A short read is logged, and those days count what was read.
  const gl = await pageRows<any>((a, b) => db.from('glitches').select('id,listing_id,unit,created_at')
    .gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z').order('id').range(a, b))
  if (gl.truncated) console.error(`computeRange: glitch read ${from}..${to} incomplete — glitches_new may be short`)
  for (const g of gl.rows) {
    const d = String(g.created_at || '').slice(0, 10)
    if (!dayIndex[d]) continue
    for (const s of scopesOf(g.listing_id)) bump(byDay[d], s, 'glitches_new', 1)
  }
  const st = await pageRows<any>((a, b) => db.from('guesty_conversation_sentiment').select('conversation_id,listing_id,dissatisfied,last_message_at')
    .gte('last_message_at', from + 'T00:00:00Z').lte('last_message_at', to + 'T23:59:59Z').order('conversation_id').range(a, b), 25)
  if (st.truncated) console.error(`computeRange: sentiment read ${from}..${to} incomplete — sentiment_negative may be short`)
  for (const s0 of st.rows) {
    if (!s0.dissatisfied) continue
    const d = String(s0.last_message_at || '').slice(0, 10)
    if (!dayIndex[d]) continue
    for (const s of scopesOf(s0.listing_id)) bump(byDay[d], s, 'sentiment_negative', 1)
  }

  // ---- Fold the accumulator into metric rows ----
  const out: MetricRow[] = []
  const scopeKeys = Object.keys(unitsByScope)
  for (const day of days) {
    const acc = byDay[day]
    for (const scope of scopeKeys) {
      const units = unitsByScope[scope] || 0
      const cell = acc[scope] || {}
      const g = (k: string) => cell[k]
      const push = (metric: string, value: number | null, n: number) => out.push({ day, scope, metric, value: value == null ? null : round2(value), n })

      const nights = g('nights_sold')?.n || 0
      const revenue = g('revenue')?.sum || 0
      push('nights_sold', nights, nights)
      push('revenue', revenue, nights)
      push('arrivals', g('arrivals')?.n || 0, g('arrivals')?.n || 0)
      if (units > 0) push('occupancy', (nights / units) * 100, units)
      push('adr', nights > 0 ? revenue / nights : null, nights)
      if (units > 0) push('revpar', revenue / units, units)

      // The one basis. A scope with no real stay that day writes nothing (value null is dropped below),
      // except occupancy_dated, where an empty day is a real 0%.
      const guestNights = g('guest_nights')?.n || 0
      const ownerNights = g('owner_nights')?.n || 0
      const held = g('held_nights')?.n || 0
      const netRev = g('net_revenue')?.sum || 0
      const unitsThen = unitsLiveOn(scope, day)
      const sellable = unitsThen - ownerNights
      push('guest_nights', guestNights, guestNights)
      push('net_revenue', netRev, guestNights)
      push('net_adr', guestNights > 0 ? netRev / guestNights : null, guestNights)
      if (sellable > 0) push('net_revpar', netRev / sellable, sellable)
      if (unitsThen > 0) push('occupancy_dated', Math.min(100, (held / unitsThen) * 100), unitsThen)
      const gMade = g('guest_bookings_made')?.n || 0
      push('guest_bookings_made', gMade, gMade)
      push('guest_cancel_rate', gMade > 0 ? ((g('guest_cancel_rate')?.sum || 0) / gMade) * 100 : null, gMade)

      const made = g('bookings_made')?.n || 0
      push('bookings_made', made, made)
      push('direct_share', made > 0 ? ((g('direct_share')?.sum || 0) / made) * 100 : null, made)
      push('cancel_rate', made > 0 ? ((g('cancel_rate')?.sum || 0) / made) * 100 : null, made)

      const cleansDone = g('cleans_done')?.n || 0
      push('cleans_done', cleansDone, cleansDone)
      push('cleans_unassigned', g('cleans_unassigned')?.sum || 0, g('cleans_unassigned')?.n || 0)
      const cm = g('clean_minutes')
      push('clean_minutes', cm && cm.n > 0 ? cm.sum / cm.n : null, cm?.n || 0)
      push('tasks_completed', g('tasks_completed')?.n || 0, g('tasks_completed')?.n || 0)
      push('glitches_new', g('glitches_new')?.n || 0, g('glitches_new')?.n || 0)

      const rc = g('review_count')?.n || 0
      push('review_count', rc, rc)
      push('review_avg', rc > 0 ? (g('review_avg')?.sum || 0) / rc : null, rc)
      push('five_star_share', rc > 0 ? ((g('five_star_share')?.sum || 0) / rc) * 100 : null, rc)
      push('low_reviews', g('low_reviews')?.sum || 0, rc)
      push('sentiment_negative', g('sentiment_negative')?.n || 0, g('sentiment_negative')?.n || 0)
    }
  }
  // Drop all-zero rows for scopes that simply have no activity, so a quiet building does not
  // manufacture a baseline of zeros that makes any real number look like a 4-sigma event.
  return out.filter(r => r.value != null)
}

/** Point-in-time state. Only ever valid for TODAY — there is no honest way to reconstruct it. */
export async function computeToday(): Promise<MetricRow[]> {
  const db = supabaseAdmin()
  const day = todayET()
  const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,status,building').order('id')
  const scopeOf: Record<string, string> = {}
  const counts: Record<string, number> = { portfolio: 0 }
  for (const l of (listings || [])) {
    const row: any = l
    if (DEAD_LISTING.test(lc(row.status))) continue
    const s = 'building:' + rollupBuilding(row.building, row.nickname || row.title)
    scopeOf[String(row.id)] = s
    counts.portfolio++
    counts[s] = (counts[s] || 0) + 1
  }
  const out: MetricRow[] = []
  const scopeKeys = Object.keys(counts)
  for (const s of scopeKeys) out.push({ day, scope: s, metric: 'active_units', value: counts[s], n: counts[s] })

  const tally = (rows: any[], metric: string, key = 'listing_id') => {
    const by: Record<string, number> = { portfolio: 0 }
    for (const r of rows) {
      by.portfolio++
      const s = scopeOf[String(r[key])]
      if (s) by[s] = (by[s] || 0) + 1
    }
    const keys = Object.keys(by)
    for (const s of keys) out.push({ day, scope: s, metric, value: by[s], n: by[s] })
  }
  // Every open item, paged in id order (2026-09-29): these are counts, and a capped read cannot say it
  // was cut. A short read is logged; the count is what was read.
  const fw = await pageRows<any>((a, b) => db.from('field_requests').select('listing_id').in('status', ['open', 'in_progress']).order('id').range(a, b))
  if (fw.truncated) console.error('computeToday: open field work read incomplete — the count may be short')
  tally(fw.rows, 'open_field_work')
  const gl = await pageRows<any>((a, b) => db.from('glitches').select('listing_id').not('status', 'in', '("done","resolved","closed")').order('id').range(a, b))
  if (gl.truncated) console.error('computeToday: open glitch read incomplete — the count may be short')
  tally(gl.rows, 'glitches_open')
  const ur = await pageRows<any>((a, b) => db.from('guesty_reviews').select('listing_id').eq('has_reply', false).eq('excluded_from_score', false)
    .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()).order('id').range(a, b))
  if (ur.truncated) console.error('computeToday: unanswered-review read incomplete — the count may be short')
  tally(ur.rows, 'unanswered_reviews')
  return out
}

/** Upsert in chunks. PK is (day, scope, metric) so re-running a day is idempotent. */
export async function saveMetrics(rows: MetricRow[]): Promise<{ saved: number; error?: string }> {
  if (!rows.length) return { saved: 0 }
  const db = supabaseAdmin()
  let saved = 0
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500)
    const { error } = await db.from('eve_metrics').upsert(part, { onConflict: 'day,scope,metric' })
    if (error) return { saved, error: error.message.slice(0, 200) }
    saved += part.length
  }
  return { saved }
}
