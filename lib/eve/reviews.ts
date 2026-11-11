// ONE REVIEW SCORE, THE WAY THE GUEST SEES IT (Eve reorganisation, 2026-11-10).
//
// review_summary used to average every review Guesty holds for a unit, all time, all channels in one
// number. Three things were wrong with that, and Jon has named each of them:
//   - "we recreated listings on Airbnb, so make sure the review score is the current score, not what
//     you're pulling from Guesty" — a review left on a replaced channel listing is not on the page a
//     guest reads today (lib/channel-current-review.ts decides, and keeps a review when it cannot tell);
//   - the average of ACTIVE units PER CHANNEL is the number he asks for, because Superhost, Premier
//     Host and Booking's score are each earned on one channel;
//   - "how are reviews lately" needs a window, not the lifetime average.
// This file is the one reader behind review_summary and the review sections of unit_360 / building_360,
// so the three can never quote different scores for the same unit.
//
// RULE 1 (lib/eve/ctx.ts): the raw payload never leaves the database — only the JSON paths below.
import 'server-only'
import { isCurrentChannelReview } from '@/lib/channel-current-review'
import { subScoresOf } from '@/lib/review-playbook'
import type { EveCtx } from './ctx'
import { chunk, lc, normStar, pageRows, shiftDay } from './ctx'

const BASE_COLS = 'id,listing_id,rating,has_reply,excluded_from_score,channel,created_at'
const RAW_COLS = ',ext:raw->>externalListingId,ext2:raw->>external_listing_id,rl:raw->rawReview->>listing_id,rl2:raw->rawReview->>listingId,rl3:raw->rawReview->>external_listing_id,cats:raw->rawReview->category_ratings,scoring:raw->rawReview->scoring'

/** The channel a review was left on, in the spelling lib/channel-current-review keys on. */
export function reviewChannel(v: any): string {
  const s = lc(v)
  if (!s) return 'Unknown'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('vrbo') || s.includes('homeaway')) return 'Vrbo'
  if (s.includes('booking')) return 'Booking.com'
  if (s.includes('expedia')) return 'Expedia'
  if (s.includes('google')) return 'Google'
  if (s.includes('direct') || s.includes('manual') || s.includes('website')) return 'Direct'
  return String(v)
}

const r2 = (n: number) => Math.round(n * 100) / 100

export type ChannelScore = { channel: string; avg: number | null; reviews: number; five_star_pct: number | null; older_listing_left_out: number }

// EACH CHANNEL ON ITS OWN SCALE, NEVER BLENDED (eval 2026-11-11: she quoted a 4.43 "portfolio average"
// that mixed Airbnb, Vrbo and Booking.com). Superhost, Premier Host and Booking's score are each earned
// on one channel and shown on that channel's own scale, so a cross-channel average is not a number any
// guest or channel ever sees. Stored ratings are on a 5-star basis (Booking halved at sync / normStar);
// Booking.com is shown back on its own /10 here.
export function channelScaleOf(channel: string): 10 | 5 { return channel === 'Booking.com' ? 10 : 5 }
/** One channel's average for a person to read: on that channel's own scale, with its count. */
export function channelLine(c: ChannelScore): { channel: string; average: number | null; scale: string; reviews: number; five_star_pct?: number | null; older_listing_reviews_left_out?: number } {
  const scale = channelScaleOf(c.channel)
  return {
    channel: c.channel,
    average: c.avg == null ? null : r2(scale === 10 ? c.avg * 2 : c.avg),
    scale: scale === 10 ? '/10' : '/5',
    reviews: c.reviews,
    five_star_pct: scale === 5 ? c.five_star_pct : undefined,
    older_listing_reviews_left_out: c.older_listing_left_out || undefined,
  }
}
export const NEVER_BLEND = 'Per channel only, each on its own scale (Airbnb /5, Vrbo /5, Booking.com /10), each with its review count. NEVER blend channels into one average — there is no portfolio-wide score.'
export type UnitScore = { listing_id: string; name: string; reviews: number; avg: number | null }
export type ReviewStats = {
  window: string
  days: number | null
  review_count: number
  rated_count: number
  avg_rating: number | null
  distribution_by_star: Record<string, number>
  unanswered: number
  by_channel: ChannelScore[]
  units: UnitScore[]
  /** Reviews left on a channel listing that has since been replaced — not on the page a guest reads now. */
  older_listing_left_out: number
  /** The average if those were counted too (what Guesty holds) — so the difference can be explained. */
  avg_including_older_listings: number | null
  sub_scores: { key: string; label: string; avg: number; n: number }[]
  /** 'checked' | 'unavailable' — unavailable means the listing ids could not be read, so nothing was left out. */
  current_listing_check: 'checked' | 'unavailable'
  /** Same window immediately before this one (only when a window was asked for). */
  prior: { window: string; avg_rating: number | null; rated_count: number; by_channel: ChannelScore[] } | null
  truncated: boolean
}

/**
 * Review statistics for a set of listings (null = every reviewable unit), optionally over the last
 * `days`. Counts ACTIVE units only (ctx.reviewable: live, not Waves), reviews not excluded from the
 * score, and — per channel — only reviews on the channel listing that is live now.
 */
export async function reviewStats(ctx: EveCtx, opts: { ids?: string[] | null; days?: number | null; withPrior?: boolean }): Promise<ReviewStats> {
  const days = opts.days && Number(opts.days) > 0 ? Math.min(Math.round(Number(opts.days)), 1500) : null
  const since = days ? shiftDay(ctx.today, -days) : null
  const priorSince = days && opts.withPrior ? shiftDay(ctx.today, -2 * days) : null
  const readFrom = priorSince || since
  const want: string[] | null = opts.ids ? opts.ids.filter(id => ctx.reviewable(id)) : null

  const read = async (cols: string): Promise<{ rows: any[]; truncated: boolean }> => {
    const rows: any[] = []
    let truncated = false
    const one = async (ids: string[] | null) => {
      const got = await pageRows<any>((a, b) => {
        let q = ctx.db.from('guesty_reviews').select(cols)
        if (ids) q = q.in('listing_id', ids)
        if (readFrom) q = q.gte('created_at', readFrom + 'T00:00:00Z')
        return q.order('id').range(a, b)
      }, 20)
      rows.push(...got.rows)
      if (got.truncated) truncated = true
    }
    if (want && want.length <= 120) { for (const part of chunk(want, 40)) await one(part) }
    else await one(null)
    return { rows, truncated }
  }

  // The JSON paths first; if that read fails outright (a column that is not there), the plain columns —
  // the score is still right, only the current-listing check and the sub-scores are unavailable.
  let check: 'checked' | 'unavailable' = 'checked'
  let got = want && !want.length ? { rows: [] as any[], truncated: false } : await read(BASE_COLS + RAW_COLS)
  if (got.truncated && !got.rows.length) { got = await read(BASE_COLS); check = 'unavailable' }

  // The live channel listing ids, from each listing's integrations (one small JSON path per listing).
  const ints: Record<string, any[]> = {}
  if (check === 'checked' && got.rows.length) {
    try {
      const ids = Array.from(new Set(got.rows.map(r => String(r.listing_id)))).filter(id => ctx.reviewable(id))
      for (const part of chunk(ids, 60)) {
        const { data, error } = await ctx.db.from('guesty_listings').select('id,ints:raw->integrations').in('id', part).order('id')
        if (error) throw error
        for (const l of ((data as any[]) || [])) if (Array.isArray(l.ints)) ints[String(l.id)] = l.ints
      }
    } catch { check = 'unavailable' }
  }
  const isCurrent = (r: any, channel: string): boolean => {
    if (check !== 'checked') return true
    const li = ints[String(r.listing_id)]
    if (!li) return true
    const stub = { externalListingId: r.ext, external_listing_id: r.ext2, rawReview: { listing_id: r.rl, listingId: r.rl2, external_listing_id: r.rl3 } }
    try { return isCurrentChannelReview(stub, { integrations: li }, channel) } catch { return true }
  }

  const wantSet: Record<string, true> | null = want ? {} : null
  if (want && wantSet) for (const id of want) wantSet[id] = true

  const dist: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 }
  const byCh: Record<string, { sum: number; n: number; five: number; old: number }> = {}
  const priorCh: Record<string, { sum: number; n: number; five: number; old: number }> = {}
  const byUnit: Record<string, { count: number; sum: number; rated: number }> = {}
  const sub: Record<string, { label: string; sum: number; n: number }> = {}
  let reviewCount = 0, rated = 0, sum = 0, unanswered = 0, old = 0, allSum = 0, allN = 0, priorSum = 0, priorN = 0

  for (const r of got.rows) {
    const lid = String(r.listing_id)
    if (!ctx.reviewable(lid)) continue
    if (wantSet && !wantSet[lid]) continue
    const day = String(r.created_at || '').slice(0, 10)
    const ch = reviewChannel(r.channel)
    const stars = r.excluded_from_score === true ? null : normStar(r.rating)
    const current = isCurrent(r, ch)
    // The window before this one: same rules, kept apart.
    if (since && day < since) {
      if (current && stars != null) {
        priorSum += stars; priorN++
        if (!priorCh[ch]) priorCh[ch] = { sum: 0, n: 0, five: 0, old: 0 }
        priorCh[ch].sum += stars; priorCh[ch].n++
        if (stars >= 4.75) priorCh[ch].five++
      }
      continue
    }
    if (stars != null) { allSum += stars; allN++ }
    if (!current) {
      old++
      if (!byCh[ch]) byCh[ch] = { sum: 0, n: 0, five: 0, old: 0 }
      byCh[ch].old++
      continue
    }
    reviewCount++
    if (!r.has_reply) unanswered++
    if (!byUnit[lid]) byUnit[lid] = { count: 0, sum: 0, rated: 0 }
    byUnit[lid].count++
    if (stars == null) continue
    rated++; sum += stars
    byUnit[lid].rated++; byUnit[lid].sum += stars
    dist[String(Math.max(1, Math.min(5, Math.round(stars))))]++
    if (!byCh[ch]) byCh[ch] = { sum: 0, n: 0, five: 0, old: 0 }
    byCh[ch].sum += stars; byCh[ch].n++
    if (stars >= 4.75) byCh[ch].five++
    if (r.cats || r.scoring) {
      try {
        for (const s of subScoresOf(r.cats, r.scoring)) {
          if (!sub[s.key]) sub[s.key] = { label: s.label, sum: 0, n: 0 }
          sub[s.key].sum += s.rating; sub[s.key].n++
        }
      } catch { /* a malformed category block is skipped, never fatal */ }
    }
  }

  const chScores = (m: Record<string, { sum: number; n: number; five: number; old: number }>): ChannelScore[] => Object.keys(m).map(ch => ({
    channel: ch,
    avg: m[ch].n ? r2(m[ch].sum / m[ch].n) : null,
    reviews: m[ch].n,
    five_star_pct: m[ch].n >= 5 ? Math.round((m[ch].five / m[ch].n) * 100) : null,
    older_listing_left_out: m[ch].old,
  })).sort((a, b) => b.reviews - a.reviews)
  const by_channel: ChannelScore[] = chScores(byCh)
  const units: UnitScore[] = Object.keys(byUnit).map(id => ({
    listing_id: id, name: ctx.nameOf(id), reviews: byUnit[id].count,
    avg: byUnit[id].rated ? r2(byUnit[id].sum / byUnit[id].rated) : null,
  })).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9))

  return {
    window: since ? `${since} → ${ctx.today} (last ${days} days)` : 'all time',
    days,
    review_count: reviewCount,
    rated_count: rated,
    avg_rating: rated ? r2(sum / rated) : null,
    distribution_by_star: dist,
    unanswered,
    by_channel,
    units,
    older_listing_left_out: old,
    avg_including_older_listings: old && allN ? r2(allSum / allN) : null,
    sub_scores: Object.keys(sub).map(k => ({ key: k, label: sub[k].label, avg: r2(sub[k].sum / sub[k].n), n: sub[k].n })).sort((a, b) => a.avg - b.avg),
    current_listing_check: check,
    prior: since && priorSince ? { window: `${priorSince} → ${shiftDay(since, -1)}`, avg_rating: priorN ? r2(priorSum / priorN) : null, rated_count: priorN, by_channel: chScores(priorCh) } : null,
    truncated: got.truncated,
  }
}
