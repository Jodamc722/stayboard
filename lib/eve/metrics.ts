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
import { bucketFor, familyFor } from '@/lib/marketing'
import { todayET, shiftDay, lc, num, round2, normStar, safe, DEAD_LISTING } from './ctx'

export type MetricRow = { day: string; scope: string; metric: string; value: number | null; n: number }

export type MetricDef = { key: string; label: string; unit: 'pct' | 'usd' | 'count' | 'rating' | 'minutes'; backfillable: boolean; higherIsBetter: boolean | null }

/** The catalogue. Anything Eve can trend has to be declared here so she cannot invent a metric name. */
export const METRICS: MetricDef[] = [
  // --- revenue (backfillable from reservations) ---
  { key: 'occupancy', label: 'Occupancy %', unit: 'pct', backfillable: true, higherIsBetter: true },
  { key: 'adr', label: 'ADR', unit: 'usd', backfillable: true, higherIsBetter: true },
  { key: 'revpar', label: 'RevPAR', unit: 'usd', backfillable: true, higherIsBetter: true },
  { key: 'revenue', label: 'Revenue', unit: 'usd', backfillable: true, higherIsBetter: true },
  { key: 'nights_sold', label: 'Nights sold', unit: 'count', backfillable: true, higherIsBetter: true },
  { key: 'arrivals', label: 'Arrivals', unit: 'count', backfillable: true, higherIsBetter: null },
  { key: 'bookings_made', label: 'Bookings made', unit: 'count', backfillable: true, higherIsBetter: true },
  { key: 'direct_share', label: 'Direct booking share %', unit: 'pct', backfillable: true, higherIsBetter: true },
  { key: 'cancel_rate', label: 'Cancellation rate %', unit: 'pct', backfillable: true, higherIsBetter: false },
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
  const { data: listings } = await db.from('guesty_listings').select('id,nickname,title,status,building').order('id')
  const meta: Record<string, { building: string; active: boolean }> = {}
  const unitsByScope: Record<string, number> = { portfolio: 0 }
  for (const l of (listings || [])) {
    const row: any = l
    const b = rollupBuilding(row.building, row.nickname || row.title)
    const active = !DEAD_LISTING.test(lc(row.status))
    meta[String(row.id)] = { building: b, active }
    if (!active) continue
    unitsByScope.portfolio++
    const s = 'building:' + b
    unitsByScope[s] = (unitsByScope[s] || 0) + 1
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
  const RES_COLS = 'id,listing_id,check_in,check_out,nights,status,source,money_total,created_at,'
    + 'accom:raw->money->>fareAccommodationAdjusted,accom2:raw->money->>fareAccommodation,clean:raw->money->>fareCleaning'
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
    const { data, error } = await db.from('guesty_reservations').select('id,listing_id,status,source,created_at')
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

  for (const r of created) {
    const d = String(r.created_at || '').slice(0, 10)
    if (!dayIndex[d]) continue
    const scopes = scopesOf(r.listing_id)
    const dead = DEAD_RES.test(lc(r.status))
    const direct = familyFor(bucketFor(r.source)) === 'direct'
    for (const s of scopes) {
      bump(byDay[d], s, 'bookings_made', 1)
      bump(byDay[d], s, 'direct_share', direct ? 1 : 0)
      bump(byDay[d], s, 'cancel_rate', dead ? 1 : 0)
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
    const done = !!t.finished_at || /complete|finish|close|approv/.test(s2)
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
  const gl: any = await safe(db.from('glitches').select('id,listing_id,unit,created_at')
    .gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z').order('id').limit(3000), { data: [] } as any)
  for (const g of (gl.data || [])) {
    const d = String(g.created_at || '').slice(0, 10)
    if (!dayIndex[d]) continue
    for (const s of scopesOf(g.listing_id)) bump(byDay[d], s, 'glitches_new', 1)
  }
  const st: any = await safe(db.from('guesty_conversation_sentiment').select('conversation_id,listing_id,dissatisfied,last_message_at')
    .gte('last_message_at', from + 'T00:00:00Z').lte('last_message_at', to + 'T23:59:59Z').order('conversation_id').limit(3000), { data: [] } as any)
  for (const s0 of (st.data || [])) {
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
  const fw: any = await safe(db.from('field_requests').select('listing_id').in('status', ['open', 'in_progress']).order('id').limit(3000), { data: [] } as any)
  tally(fw.data || [], 'open_field_work')
  const gl: any = await safe(db.from('glitches').select('listing_id').not('status', 'in', '("done","resolved","closed")').order('id').limit(3000), { data: [] } as any)
  tally(gl.data || [], 'glitches_open')
  const ur: any = await safe(db.from('guesty_reviews').select('listing_id').eq('has_reply', false).eq('excluded_from_score', false)
    .gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()).order('id').limit(2000), { data: [] } as any)
  tally(ur.data || [], 'unanswered_reviews')
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
