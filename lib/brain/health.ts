// unit_health_daily — one upkeep-aware health score per APARTMENT per day (migration 178).
//
// This is not lib/health-score (the listing / OTA-ranking score on the Properties page). That one
// asks "how well does this listing sell"; this one asks "is this apartment giving guests and the
// field team trouble" — the input to repair-or-replace and where-to-spend decisions.
//
// THE FORMULA (also written into every row as `formula`, and each deduction into `drivers`):
//
//   score = 100
//     − reviews   (max 30)  when the unit has 3+ reviews in 365 days on the listing that is live now:
//                           (4.8 − average) × 40, between 0 and 20;  plus 5 per low review in the
//                           last 90 days, up to 10
//     − issues    (max 25)  guest issues per 100 occupied nights (90 days) × 2.5;
//                           under 10 occupied nights the rate means nothing, so 5 per issue instead
//     − repeats   (max 20)  10 per system that failed again within 90 days on this apartment
//     − upkeep    (max 15)  3 per overdue preventative job (up to 9) + 1 per 30 days the latest one
//                           is late (up to 6)
//     − inspection(max 10)  (1 − pass rate of the newest PM / arrival inspection, last 180 days) × 40
//
//   band: 85+ healthy · 70–84 watch · 50–69 risk · under 50 critical · unrated when there is nothing
//   to judge (no reviews, no occupied nights, no events, no inspection, nothing overdue).
//
// upkeep_cost_pct_rev = (upkeep billed + refunds) ÷ net revenue over 90 days is SHOWN, not scored:
// the only upkeep money on record is what was billed to the owner, which is not what the unit cost.
//
// A whole-and-parts apartment ("3316 Full" + its halves) is ONE row: nights, reviews, events and
// overdue jobs of every listing in the set are added together.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'
import { isLowReview } from '@/lib/review-scale'
import { isCurrentChannelReview } from '@/lib/channel-current-review'
import type { DimUnit } from './spine'
import { str, num, numOrNull, todayET, addDays, daysBetween, round2, upsertBatches, type BuildResult } from './shared'

export const HEALTH_FORMULA = 'score = 100 − reviews(≤30: (4.8−avg365)×40 capped 20 when n≥3, +5 per low review 90d capped 10) '
  + '− issues(≤25: glitches per 100 occupied nights 90d × 2.5; under 10 nights, 5 per glitch) '
  + '− repeats(≤20: 10 per system that failed again within 90d) '
  + '− upkeep(≤15: 3 per overdue PM capped 9, +1 per 30 days late capped 6) '
  + '− inspection(≤10: (1 − newest PM/arrival pass rate, 180d) × 40). '
  + 'Bands: 85+ healthy, 70–84 watch, 50–69 risk, <50 critical. Upkeep cost % of revenue is shown, not scored.'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

type Acc = {
  listings: DimUnit[]
  nights: number; netRev: number
  glitches: number; repeats: Record<string, boolean>; billed: number; refunds: number; events: number
  ratingSum: number; ratingN: number; low90: number
  overdue: number; maxLate: number
  inspPass: number | null; inspAt: string | null
}

export async function buildUnitHealth(units: DimUnit[], byId: Record<string, DimUnit>, deadline: number): Promise<BuildResult> {
  if (!units.length) return { rows: 0, partial: true, error: 'dim_unit is empty' }
  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const today = todayET()
  const d90 = addDays(today, -90)
  let partial = false

  const acc: Record<string, Acc> = {}
  for (const u of units) {
    const a = (acc[u.physical_unit_id] = acc[u.physical_unit_id] || {
      listings: [], nights: 0, netRev: 0, glitches: 0, repeats: {}, billed: 0, refunds: 0, events: 0,
      ratingSum: 0, ratingN: 0, low90: 0, overdue: 0, maxLate: 0, inspPass: null, inspAt: null,
    })
    a.listings.push(u)
  }
  const accOf = (listingId: any): Acc | null => { const u = byId[str(listingId)]; return u ? acc[u.physical_unit_id] || null : null }

  // 1. Occupied nights and net revenue, last 90 days (fact_unit_day — vacant rows are not needed).
  const ud = await pageRows<any>((a, b) => db.from('fact_unit_day').select('day,listing_id,physical_unit_id,net_accom')
    .gte('day', d90).lt('day', today).in('state', ['occupied', 'owner_stay'])
    .order('day').order('listing_id').range(a, b), 40)
  if (ud.truncated) partial = true
  for (const r of ud.rows) {
    const a = acc[str(r.physical_unit_id)] || accOf(r.listing_id)
    if (!a) continue
    a.nights += 1; a.netRev += num(r.net_accom)
  }

  // 2. Events, last 90 days (fact_maintenance_event).
  const ev = await pageRows<any>((a, b) => db.from('fact_maintenance_event')
    .select('event_id,source,physical_unit_id,system,is_repeat,billed_owner,refund,opened_at')
    .gte('opened_at', d90 + 'T00:00:00Z').not('physical_unit_id', 'is', null)
    .order('opened_at').order('event_id').range(a, b), 12)
  if (ev.truncated) partial = true
  for (const e of ev.rows) {
    const a = acc[str(e.physical_unit_id)]
    if (!a) continue
    a.events += 1
    if (str(e.source) === 'glitch') a.glitches += 1
    if (e.is_repeat === true) a.repeats[str(e.system)] = true
    a.billed += num(e.billed_owner); a.refunds += num(e.refund)
  }

  // 3. Reviews, last 365 days — only those left on the channel listing that is live now
  //    (lib/channel-current-review: a re-created Airbnb listing starts over).
  const ints: Record<string, any> = {}
  try {
    const li = await pageRows<any>((a, b) => db.from('guesty_listings').select('id,ints:raw->integrations').order('id').range(a, b), 4)
    if (li.truncated) partial = true
    for (const l of li.rows) ints[str(l.id)] = { integrations: Array.isArray(l.ints) ? l.ints : [] }
  } catch { partial = true }
  const d365 = addDays(today, -365) + 'T00:00:00Z'
  const R_COLS = 'id,listing_id,rating,channel,created_at,ext:raw->>externalListingId,rl:raw->rawReview->>listing_id'
  const readReviews = (withRemoved: boolean) => pageRows<any>((a, b) => {
    let q = db.from('guesty_reviews').select(R_COLS).gte('created_at', d365)
    if (withRemoved) q = q.is('removed_at', null)
    return q.order('created_at').order('id').range(a, b)
  }, 10)
  let rv = await readReviews(true)
  if (rv.truncated && !rv.rows.length) rv = await readReviews(false)   // removed_at arrives with migration 107
  if (rv.truncated) partial = true
  const d90Iso = d90 + 'T00:00:00Z'
  for (const r of rv.rows) {
    const a = accOf(r.listing_id)
    const rating = numOrNull(r.rating)
    if (!a || rating == null) continue
    const reviewRaw = { externalListingId: r.ext, rawReview: { listing_id: r.rl } }
    if (!isCurrentChannelReview(reviewRaw, ints[str(r.listing_id)] || null, str(r.channel))) continue
    a.ratingSum += rating; a.ratingN += 1
    if (str(r.created_at) >= d90Iso && isLowReview(rating, r.channel)) a.low90 += 1
  }

  // 4. Preventative work that is overdue (pm_schedule: one row per unit × cadence).
  try {
    const pm = await pageRows<any>((a, b) => db.from('pm_schedule').select('listing_id,cadence_key,next_due,status')
      .lt('next_due', today).in('status', ['scheduled', 'created'])
      .order('listing_id').order('cadence_key').range(a, b), 5)
    if (pm.truncated) partial = true
    for (const p of pm.rows) {
      const a = accOf(p.listing_id)
      if (!a) continue
      const late = daysBetween(str(p.next_due).slice(0, 10), today)
      if (late <= 0) continue
      a.overdue += 1
      if (late > a.maxLate) a.maxLate = late
    }
  } catch { partial = true }

  // 5. The newest PM / arrival inspection on the apartment, last 180 days.
  try {
    const ins = await pageRows<any>((a, b) => db.from('inspection_results').select('task_id,listing_id,kind,pass_rate,finished_at')
      .in('kind', ['pm', 'arrival']).gte('finished_at', addDays(today, -180) + 'T00:00:00Z').not('pass_rate', 'is', null)
      .order('finished_at', { ascending: false }).order('task_id').range(a, b), 5)
    if (ins.truncated) partial = true
    for (const i of ins.rows) {
      const a = accOf(i.listing_id)
      const pass = numOrNull(i.pass_rate)
      if (!a || pass == null || a.inspAt) continue          // newest first: the first one seen stands
      a.inspPass = clamp(pass, 0, 1); a.inspAt = str(i.finished_at) || null
    }
  } catch { partial = true }

  const rows: Record<string, any>[] = []
  for (const pid of Object.keys(acc)) {
    const a = acc[pid]
    const live = a.listings.filter(u => u.status !== 'inactive')
    if (!live.length) continue                                // a retired apartment gets no row
    const shown = live.find(u => u.is_parent) || live.slice().sort((x, y) => str(x.nickname).localeCompare(str(y.nickname)))[0]
    const avg = a.ratingN ? a.ratingSum / a.ratingN : null
    const per100 = a.nights >= 10 ? (a.glitches / a.nights) * 100 : null
    const repeatSystems = Object.keys(a.repeats).sort()
    const drivers: { key: string; points: number; why: string }[] = []

    let reviews = 0
    if (avg != null && a.ratingN >= 3) reviews += clamp((4.8 - avg) * 40, 0, 20)
    reviews += clamp(a.low90 * 5, 0, 10)
    reviews = clamp(reviews, 0, 30)
    if (reviews > 0) drivers.push({ key: 'reviews', points: -round2(reviews), why: (avg != null ? 'average ' + round2(avg) + ' on ' + a.ratingN + ' review(s)' : 'no average yet') + (a.low90 ? ', ' + a.low90 + ' low in 90 days' : '') })

    const issues = clamp(per100 != null ? per100 * 2.5 : a.glitches * 5, 0, 25)
    if (issues > 0) drivers.push({ key: 'issues', points: -round2(issues), why: a.glitches + ' guest issue(s) in 90 days' + (per100 != null ? ' — ' + round2(per100) + ' per 100 occupied nights' : ' on ' + a.nights + ' occupied night(s)') })

    const repeats = clamp(repeatSystems.length * 10, 0, 20)
    if (repeats > 0) drivers.push({ key: 'repeats', points: -repeats, why: 'failed again within 90 days: ' + repeatSystems.join(', ') })

    const upkeep = clamp(clamp(a.overdue * 3, 0, 9) + clamp(Math.floor(a.maxLate / 30), 0, 6), 0, 15)
    if (upkeep > 0) drivers.push({ key: 'upkeep', points: -upkeep, why: a.overdue + ' preventative job(s) overdue, the latest by ' + a.maxLate + ' day(s)' })

    const inspection = a.inspPass == null ? 0 : clamp((1 - a.inspPass) * 40, 0, 10)
    if (inspection > 0) drivers.push({ key: 'inspection', points: -round2(inspection), why: 'last inspection passed ' + Math.round((a.inspPass as number) * 100) + '%' })

    const nothing = !a.ratingN && !a.nights && !a.events && a.inspPass == null && !a.overdue
    const score = nothing ? null : Math.round(clamp(100 - reviews - issues - repeats - upkeep - inspection, 0, 100))
    const band = score == null ? 'unrated' : score >= 85 ? 'healthy' : score >= 70 ? 'watch' : score >= 50 ? 'risk' : 'critical'
    drivers.sort((x, y) => x.points - y.points)
    rows.push({
      day: today, physical_unit_id: pid,
      listing_id: shown.listing_id, nickname: shown.nickname, building_id: shown.building_id, market: shown.market,
      review_avg_live: avg == null ? null : round2(avg), review_n: a.ratingN, low_reviews_90d: a.low90,
      occupied_nights_90d: a.nights, glitches_90d: a.glitches,
      glitches_per_100_nights: per100 == null ? null : round2(per100),
      repeat_systems: repeatSystems,
      pm_overdue_count: a.overdue, pm_max_days_late: a.maxLate,
      last_inspection_pass: a.inspPass, last_inspection_at: a.inspAt,
      net_revenue_90d: round2(a.netRev), upkeep_billed_90d: round2(a.billed),
      upkeep_cost_pct_rev: a.netRev > 0 ? round2(((a.billed + a.refunds) / a.netRev) * 100) : null,
      score, band, drivers, formula: HEALTH_FORMULA,
      built_at: now, partial,
    })
  }
  const w = await upsertBatches('unit_health_daily', rows, 'day,physical_unit_id', { deadline })
  return { rows: w.written, partial: partial || w.stoppedEarly, ...(w.error ? { error: w.error } : {}) }
}
