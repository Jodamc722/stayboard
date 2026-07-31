// Master Property Health Score - the portfolio's top quality metric. ONE 0-100 weighted composite of
// THREE pillars, each mapping to a real STR/hospitality ranking or revenue driver (2025/26 evidence).
//   Overall = Ops & Guest 45% + Listing Optimization 30% + Revenue 25% (renormalized over pillars that
//   have data). Chosen because every OTA ultimately ranks on booking-probability × review-probability
//   (Airbnb's own stated model): Ops & Guest drives both and carries the most weight; Listing
//   Optimization is the controllable conversion lever; Revenue is the realized outcome.
//
//   Pillar 1 · OPS & GUEST (0-100): recency-weighted, BAYESIAN-SHRUNK rating quality (32) + review
//     volume (9) + review-response rate (10, Superhost floor 90%) + ops load / open work (9) − recurring
//     complaint penalty (cleanliness/HVAC weighted, last-12-mo only). Bayesian shrinkage (IMDb/Algolia
//     weighted average) stops a 5.0-from-2-reviews outranking a 4.9-from-200. Sub-4.0 avg = OTA
//     removal-risk zone → hard gate caps the overall score.
//   Pillar 2 · LISTING OPTIMIZATION (0-100): the optimize/setup score (title, description, amenities,
//     booking settings, photos) straight through.
//   Pillar 3 · REVENUE (0-100): RevPAR/occupancy Index (RGI) vs the building's median earning unit,
//     mapped on the hotel-industry RGI bands (100 = fair share; ≥110 dominant; <90 red flag).
//   Rating quality anchors each OTA's badge line (Airbnb 4.8 Superhost / Booking 9.0 Superb / Vrbo 4.6
//   Premier) at 90 so a badge-level listing reaches Elite and a flawless one hits 100.
// Also scores each OTA separately (per-channel, badge-aware) and emits ranked, team-assignable actions.
// Building rollup = 0.70*mean + 0.30*worst-quartile.
// Evidence base: Airbnb/Booking/Vrbo host help centers (badge thresholds), AirDNA Performance Score &
// hotel RGI/MPI/ARI (revenue indexing), Algolia/IMDb (Bayesian shrinkage), Breezeway/Rapid Eye (ops KPIs).
import { computeScore } from '@/lib/optimize-score'

export type HealthBand = 'elite' | 'healthy' | 'watch' | 'risk' | 'critical' | 'neutral'
export type ChannelKey = 'airbnb' | 'vrbo' | 'bookingcom' | 'expedia' | 'other'
export type HealthReview = { rating: number | null; channel?: string | null; content?: string | null; created_at?: string | null; hasReply?: boolean }
export type Issue = { key: string; severity: 'critical' | 'high' | 'medium' | 'low'; title: string; action: string; owner: string; gain: number; channel?: string | null }
export type ChannelHealth = { channel: ChannelKey; label: string; score: number; band: HealthBand; avgStars: number | null; reviewCount: number; responseRate: number | null; badge: string | null }
export type ListingHealth = {
  // ONE overall Health Score (0-100) — a weighted composite of three pillars. The breakdown shows
  // where to act: Ops & Guest (45%) + Listing Optimization (30%) + Revenue (25%), renormalized over
  // whichever pillars have data.
  score: number
  band: HealthBand
  pillars: {
    ops: number | null; opsBand: HealthBand
    listing: number; listingBand: HealthBand
    revenue: number | null; revenueBand: HealthBand
    occIndex: number | null; occPct: number | null
  }
  unrated: boolean
  optimizeScore: number
  breakdown: { rating: number; volume: number; response: number; penalty: number; ops: number; setup: number }
  review: { avgStars: number | null; recencyQuality: number | null; count: number; ratedCount: number; lowConfidence: boolean; responseRate: number | null; recurring: string[]; topIssue: string | null }
  channels: ChannelHealth[]
  issues: Issue[]
}

/* --------------------------------- bands ---------------------------------- */
export function healthBand(score: number, unrated = false): HealthBand {
  if (unrated) return 'neutral'
  if (score >= 90) return 'elite'
  if (score >= 80) return 'healthy'
  if (score >= 70) return 'watch'
  if (score >= 60) return 'risk'
  return 'critical'
}
export function healthBandUi(b: HealthBand): { ring: string; text: string; bg: string; dot: string; label: string } {
  switch (b) {
    case 'elite': return { ring: 'ring-emerald-300', text: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500', label: 'Elite' }
    case 'healthy': return { ring: 'ring-emerald-200', text: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500', label: 'Healthy' }
    case 'watch': return { ring: 'ring-amber-200', text: 'text-amber-700', bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'Watch' }
    case 'risk': return { ring: 'ring-orange-200', text: 'text-orange-700', bg: 'bg-orange-50', dot: 'bg-orange-500', label: 'At risk' }
    case 'critical': return { ring: 'ring-rose-200', text: 'text-rose-700', bg: 'bg-rose-50', dot: 'bg-rose-500', label: 'Critical' }
    default: return { ring: 'ring-slate-200', text: 'text-muted', bg: 'bg-app', dot: 'bg-slate-300', label: 'No reviews yet' }
  }
}

/* ------------------------------- normalize -------------------------------- */
// Stored ratings come in mixed scales across channels; reduce everything to 0-5 stars.
function toStars(r: number | null): number | null {
  if (r == null || isNaN(r)) return null
  if (r > 10) return Math.max(0, Math.min(5, r / 20))   // 0-100
  if (r > 5) return Math.max(0, Math.min(5, r / 2))     // 0-10 (Booking/Expedia)
  return Math.max(0, Math.min(5, r))                    // 0-5 (Airbnb/Vrbo)
}

function channelKey(c?: string | null): ChannelKey {
  const s = (c || '').toLowerCase()
  if (/airbnb/.test(s)) return 'airbnb'
  if (/vrbo|homeaway/.test(s)) return 'vrbo'
  if (/booking/.test(s)) return 'bookingcom'
  if (/expedia/.test(s)) return 'expedia'
  return 'other'
}
const CHANNEL_LABEL: Record<ChannelKey, string> = { airbnb: 'Airbnb', vrbo: 'Vrbo', bookingcom: 'Booking.com', expedia: 'Expedia', other: 'Other' }
// badge line (=80) and viability floor (=40) on a 0-5 star scale, per platform.
const ANCHOR: Record<ChannelKey, { badge: number; floor: number; badgeName: string }> = {
  airbnb: { badge: 4.8, floor: 4.0, badgeName: 'Superhost 4.8' },
  vrbo: { badge: 4.6, floor: 3.8, badgeName: 'Premier 4.6' },
  bookingcom: { badge: 4.5, floor: 3.5, badgeName: 'Superb 9.0' }, // 9.0/10 = 4.5 stars
  expedia: { badge: 4.5, floor: 3.5, badgeName: 'Premium 9.0' },
  other: { badge: 4.7, floor: 3.8, badgeName: 'Top tier' },
}
// stars -> 0-100 quality, anchored so the OTA badge line = 90, floor = 45. A listing AT its badge
// (Superhost / Premier / Superb) is elite-quality by definition, so it should score near the top;
// a flawless listing above the badge reaches 100. (Was badge=80/floor=40, which capped a perfect
// Airbnb listing's rating component at ~90% and helped make Elite unreachable.)
function normQuality(stars: number, ch: ChannelKey): number {
  const a = ANCHOR[ch]
  return Math.max(0, Math.min(100, 45 + ((stars - a.floor) / (a.badge - a.floor)) * 45))
}
// Months since a review; null when undated.
function monthsSince(created_at?: string | null): number | null {
  if (!created_at) return null
  const t = new Date(created_at).getTime()
  if (isNaN(t)) return null
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30)
}

// recency weight: <=3mo x1, 3-12mo x0.6, 12-24mo x0.3, >24mo x0.1
function recencyWeight(created_at?: string | null): number {
  if (!created_at) return 0.3
  const mo = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)
  if (mo <= 3) return 1.0
  if (mo <= 12) return 0.6
  if (mo <= 24) return 0.3
  return 0.1
}

/* ----------------------------- recurring issues --------------------------- */
const THEMES: Record<string, string[]> = {
  Cleanliness: ['dirty', 'not clean', "wasn't clean", 'unclean', 'filthy', 'stain', 'dusty', 'smell', 'odor', 'mold', 'mildew', 'trash'],
  'A/C & climate': ['a/c', 'ac was', 'air condition', 'too hot', 'no cold', 'hvac', 'heat not', "didn't cool", 'broken ac'],
  WiFi: ['wifi', 'wi-fi', 'internet', 'no signal', 'no service', 'connection'],
  Noise: ['noise', 'noisy', 'loud', 'construction', "couldn't sleep", 'thin wall'],
  'Check-in / access': ['check-in', 'check in', 'lockbox', 'lock box', "code didn", "couldn't get in", "couldn't access", 'access code', 'key not', 'getting in'],
  Maintenance: ['broken', 'not working', "doesn't work", 'leak', 'clogged', 'toilet', 'plumb', 'no hot water', 'light out'],
  Pests: ['roach', 'bug', 'ants', 'pest', 'insect', 'cockroach'],
  Parking: ['no parking', 'parking was', "couldn't park", 'parking is'],
}

/* --------------------------- subscore helpers ----------------------------- */
function volumeFrac(n: number): number { return n === 0 ? 0 : n < 5 ? 0.4 : n < 10 ? 0.7 : n < 25 ? 0.9 : 1 }
function responseFrac(rate: number | null): number { if (rate == null) return 0; return rate >= 0.9 ? 1 : rate >= 0.75 ? 0.7 : rate >= 0.5 ? 0.4 : 0 }
function opsPts(open: number, max: number): number { return open <= 0 ? max : open <= 2 ? max * 0.75 : open <= 4 ? max * 0.4 : 0 }
// RevPAR/occupancy Index (RGI, 100 = at building fair share) → 0-100, on the hotel-industry RGI bands
// (RevPAR Genius: ≥110 dominant, 90-110 normal/healthy, <90 red flag). Piecewise-linear & continuous.
function rgiToScore(rgi: number): number {
  let s: number
  if (rgi >= 120) s = 90 + Math.min(10, (rgi - 120) * 0.25)  // dominant, capped at 100
  else if (rgi >= 110) s = 80 + (rgi - 110)                  // strong
  else if (rgi >= 100) s = 65 + (rgi - 100) * 1.5            // healthy, at/above market
  else if (rgi >= 90) s = 50 + (rgi - 90) * 1.5              // slightly under fair share
  else if (rgi >= 80) s = 30 + (rgi - 80) * 2                // weak
  else s = Math.max(0, rgi * 0.375)                          // red flag
  return Math.round(Math.max(0, Math.min(100, s)))
}

/* ------------------------------ main entry -------------------------------- */
export function computeListingHealth(listing: any, reviews: HealthReview[], opts?: { openWork?: number; occIndex?: number | null; occPct?: number | null; priorMean?: number; priorC?: number }): ListingHealth {
  const openWork = opts?.openWork ?? 0
  const optimizeScore = computeScore(listing, { isBeach: /beach/i.test(String(listing?.address_city || '')) }).overall

  const rated = reviews.filter(r => toStars(r.rating) != null)
  const count = reviews.length
  const ratedCount = rated.length
  const unrated = ratedCount === 0

  // A1 recency-weighted normalized quality (cross-channel), then BAYESIAN-SHRUNK toward a prior.
  // Recency weighting mirrors how the OTAs rank (recent reviews dominate; Superhost uses a 12-mo window).
  let wSum = 0, wqSum = 0, starSum = 0
  rated.forEach(r => {
    const stars = toStars(r.rating)!
    const q = normQuality(stars, channelKey(r.channel))
    const w = recencyWeight(r.created_at)
    wSum += w; wqSum += w * q; starSum += stars
  })
  const rawQuality = wSum > 0 ? wqSum / wSum : null
  const avgStars = ratedCount ? Math.round((starSum / ratedCount) * 100) / 100 : null
  // Bayesian shrinkage (IMDb/Algolia weighted-average): pull a listing's quality toward the portfolio
  // prior in proportion to how FEW reviews back it, so a 5.0 from 2 reviews doesn't outrank a 4.9 from
  // 200. shrunk = (q*n + priorMean*C) / (n + C). Prior defaults to ~4.7-star-equivalent quality (the
  // STR-typical average); C is the review count at which we start trusting a listing's own number.
  const priorMean = opts?.priorMean ?? 84   // normalized quality at ~4.7 stars (portfolio-typical)
  const priorC = opts?.priorC ?? 6
  const recencyQuality = rawQuality != null ? (rawQuality * ratedCount + priorMean * priorC) / (ratedCount + priorC) : null
  const lowConfidence = ratedCount > 0 && ratedCount < 5   // thin sample — flag, don't green-light
  const A1 = recencyQuality != null ? (recencyQuality / 100) * 32 : 0

  // A2 volume.
  const A2 = volumeFrac(count) * 9

  // A3 response rate.
  const replied = reviews.filter(r => r.hasReply).length
  const responseRate = count ? replied / count : null
  const A3 = responseFrac(responseRate) * 10

  // A4 recurring-issue penalty (negative reviews only, LAST 12 MONTHS only; cleanliness double).
  // Old complaints shouldn't keep a unit flagged "critical" forever - a fault fixed a year ago is
  // not a recurring issue today. Undated reviews are included (most are recent); >12mo are dropped.
  const themeHits: Record<string, number> = {}
  reviews.forEach(r => {
    const stars = toStars(r.rating)
    const neg = stars != null && stars <= 3.5
    const text = String(r.content || '').toLowerCase()
    if (!text || !neg) return
    const mo = monthsSince(r.created_at)
    if (mo != null && mo > 12) return
    for (const [theme, kws] of Object.entries(THEMES)) if (kws.some(k => text.includes(k))) themeHits[theme] = (themeHits[theme] || 0) + 1
  })
  let penalty = 0
  const recurring: string[] = []
  for (const [theme, c] of Object.entries(themeHits)) {
    if (c < 2) continue
    recurring.push(theme)
    let p = c >= 4 ? 6 : 3
    if (theme === 'Cleanliness') p *= 2
    penalty += p
  }
  penalty = Math.min(12, penalty)
  const A4 = penalty
  const topIssue = Object.entries(themeHits).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // A5 ops load.
  const A5 = opsPts(openWork, 9)

  // B setup.
  const B = (optimizeScore / 100) * 40

  // ---- ONE OVERALL HEALTH SCORE from THREE pillars (Jon 2026-07-31: "full weighted score,
  //      show breakdown — Rev, Ops, Listing Optimization"). The overall is what leads; the three
  //      pillars are the hover/expand breakdown that guides where to act.
  //
  // Pillar 1 · OPS & GUEST (are guests happy + the unit maintained?): rating quality + volume +
  //   response + ops load − recurring complaints, rescaled to 0-100. Null when there are no reviews.
  const opsMax = 32 + 9 + 10 + 9 // A1+A2+A3+A5
  const pillarOps: number | null = unrated ? null : Math.round(Math.max(0, Math.min(100, ((A1 + A2 + A3 + A5 - A4) / opsMax) * 100)))
  // Pillar 2 · LISTING OPTIMIZATION (title, description, amenities, booking settings, photos): the
  //   optimize score straight through — the controllable conversion lever.
  const pillarListing = Math.round(optimizeScore)
  // Pillar 3 · REVENUE (is it actually earning?): the hotel/STR RevPAR-Index approach. occIndex = unit
  //   occupancy ÷ building median earning unit, so occIndex×100 is a RevPAR/occupancy Index (RGI) where
  //   100 = at fair share. Mapped to 0-100 on the industry RGI bands (≥110 dominant, 90-110 normal,
  //   <90 red flag). Null w/o ≥2 building peers. (ADR/rate index still pending — see dataPending.)
  const occIndex = opts?.occIndex ?? null
  const occPct = opts?.occPct ?? null
  const pillarRevenue: number | null = occIndex != null ? rgiToScore(occIndex * 100) : null

  // Weighted composite. Guest/ops carries the most weight (it drives BOTH booking-probability and
  // review-probability, the two things every OTA ranks on), listing optimization next (the controllable
  // conversion lever), revenue as the realized outcome. Weights renormalize over whichever pillars
  // exist, so a brand-new listing (no reviews / no peers) still gets a fair full score.
  const OPS_W = 0.45, LISTING_W = 0.30, REV_W = 0.25
  const parts: { w: number; v: number }[] = []
  if (pillarOps != null) parts.push({ w: OPS_W, v: pillarOps })
  parts.push({ w: LISTING_W, v: pillarListing })
  if (pillarRevenue != null) parts.push({ w: REV_W, v: pillarRevenue })
  const pWSum = parts.reduce((s, p) => s + p.w, 0)
  const rawScore = Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / (pWSum || 1))
  // Removal-risk gate: a sub-4.0 average is the documented OTA suppression/removal zone — no amount of
  // listing optimization or occupancy should let such a unit read "healthy". Cap it into the risk band.
  const score = (!unrated && avgStars != null && avgStars < 4.0) ? Math.min(rawScore, 55) : rawScore
  const band = healthBand(score, false)
  const opsBand = healthBand(pillarOps ?? 0, unrated)
  const listingBand = healthBand(pillarListing, false)
  const revenueBand = healthBand(pillarRevenue ?? 0, pillarRevenue == null)

  // ---- Per-OTA ----
  const byCh = new Map<ChannelKey, HealthReview[]>()
  reviews.forEach(r => { const k = channelKey(r.channel); const a = byCh.get(k) || []; a.push(r); byCh.set(k, a) })
  const channels: ChannelHealth[] = []
  for (const [ch, revs] of Array.from(byCh.entries())) {
    if (ch === 'other' && byCh.size > 1) continue
    const cr = revs.filter((r: HealthReview) => toStars(r.rating) != null)
    let cw = 0, cwq = 0, cs = 0
    cr.forEach((r: HealthReview) => { const st = toStars(r.rating)!; const q = normQuality(st, ch); const w = recencyWeight(r.created_at); cw += w; cwq += w * q; cs += st })
    const cQuality = cw > 0 ? cwq / cw : null
    const cStars = cr.length ? Math.round((cs / cr.length) * 100) / 100 : null
    const cReplied = revs.filter((r: HealthReview) => r.hasReply).length
    const cResp = revs.length ? cReplied / revs.length : null
    const cScore = cr.length === 0
      ? Math.round(optimizeScore)
      : Math.round(Math.max(0, Math.min(100,
        (cQuality != null ? (cQuality / 100) * 45 : 0) +
        volumeFrac(revs.length) * 15 +
        responseFrac(cResp) * 15 +
        opsPts(openWork, 10) +
        (optimizeScore / 100) * 15 -
        Math.min(15, penalty))))
    const a = ANCHOR[ch]
    const badge = cStars != null && cStars >= a.badge && cr.length >= 5 ? a.badgeName : null
    channels.push({ channel: ch, label: CHANNEL_LABEL[ch], score: cScore, band: healthBand(cScore, cr.length === 0), avgStars: cStars, reviewCount: revs.length, responseRate: cResp != null ? Math.round(cResp * 100) : null, badge })
  }
  channels.sort((a, b) => b.reviewCount - a.reviewCount)

  // ---- Actionable issues ----
  const issues: Issue[] = []
  const add = (i: Issue) => issues.push(i)
  if (recurring.includes('Cleanliness')) add({ key: 'clean', severity: 'critical', title: 'Recurring cleanliness complaints', action: 'Schedule a deep clean + QC inspection; retrain the assigned cleaner and add to the QC watchlist.', owner: 'Housekeeping + QC', gain: 8 })
  if (recurring.includes('A/C & climate')) add({ key: 'ac', severity: 'critical', title: 'Recurring A/C complaints', action: 'Dispatch HVAC field work now; if it spans multiple units, escalate to building capex.', owner: 'Maintenance', gain: 7 })
  if (recurring.includes('Maintenance')) add({ key: 'maint', severity: 'high', title: 'Recurring maintenance issues', action: 'Triage the reported items and close the highest guest-impacting ones first.', owner: 'Maintenance', gain: 5 })
  if (responseRate != null && responseRate < 0.9 && count > 0) add({ key: 'resp', severity: count >= 5 && responseRate < 0.75 ? 'high' : 'medium', title: `Response rate ${Math.round(responseRate * 100)}%`, action: `Clear the backlog - reply to the ${count - replied} unanswered review(s). Keeps Superhost eligibility and lifts ranking.`, owner: 'CCS', gain: 9 })
  if (!unrated && avgStars != null && avgStars < 4.8) add({ key: 'rating', severity: avgStars < 4.5 ? 'high' : 'medium', title: `Rating ${avgStars}/5 below 4.8`, action: `Fix the top recurring driver${topIssue ? ` (${topIssue})` : ''}, then request reviews from recent happy guests to lift the average.`, owner: 'Mini-GM + Ops', gain: 10 })
  if (recurring.includes('Noise')) add({ key: 'noise', severity: 'medium', title: 'Recurring noise complaints', action: 'Add quiet-hours messaging + set expectations pre-arrival; consider a noise monitor.', owner: 'Guest Comms', gain: 3 })
  if (recurring.includes('Check-in / access')) add({ key: 'checkin', severity: 'medium', title: 'Check-in / access friction', action: 'Audit lock/keypad codes and check-in instructions; update the access section.', owner: 'Field + Listings', gain: 4 })
  if (count > 0 && count < 5) add({ key: 'volume', severity: 'medium', title: `Only ${count} review(s)`, action: 'Turn on post-stay review requests to reach badge eligibility (5+).', owner: 'Guest Comms', gain: 4 })
  if (optimizeScore < 70) add({ key: 'setup', severity: 'medium', title: `Setup score ${optimizeScore} - listing not fully optimized`, action: 'Run the Listing Optimizer (title, 6 sections, amenities, photos) and push to Guesty.', owner: 'Listings', gain: 6 })
  if (openWork >= 3) add({ key: 'ops', severity: 'medium', title: `${openWork} open ops item${openWork === 1 ? '' : 's'} on this unit`, action: 'Triage the Breezeway/field backlog; close stale and guest-impacting tasks.', owner: 'Ops supervisor', gain: 3 })
  if (unrated) add({ key: 'noreviews', severity: 'low', title: 'No reviews yet', action: 'Drive first stays and request reviews to start building OTA ranking.', owner: 'Mini-GM', gain: 0 })
  const sev = { critical: 0, high: 1, medium: 2, low: 3 }
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || b.gain - a.gain)

  return {
    score, band,
    pillars: {
      ops: pillarOps, opsBand,
      listing: pillarListing, listingBand,
      revenue: pillarRevenue, revenueBand,
      occIndex: occIndex != null ? Math.round(occIndex * 100) / 100 : null,
      occPct: occPct != null ? Math.round(occPct * 100) : null,
    },
    unrated, optimizeScore,
    breakdown: { rating: Math.round(A1), volume: Math.round(A2), response: Math.round(A3), penalty: Math.round(A4), ops: Math.round(A5), setup: Math.round(B) },
    review: { avgStars, recencyQuality: recencyQuality != null ? Math.round(recencyQuality) : null, count, ratedCount, lowConfidence, responseRate: responseRate != null ? Math.round(responseRate * 100) : null, recurring, topIssue },
    channels, issues,
  }
}

/* ----------------------------- building rollup ---------------------------- */
export function rollupBuildingHealth(scores: number[]): { score: number | null; band: HealthBand; mean: number | null; weak: number; min: number | null } {
  const s = scores.filter(n => typeof n === 'number' && !isNaN(n))
  if (s.length === 0) return { score: null, band: 'neutral', mean: null, weak: 0, min: null }
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  const sorted = [...s].sort((a, b) => a - b)
  const qn = Math.max(1, Math.ceil(s.length * 0.25))
  const worstQ = sorted.slice(0, qn)
  const worstMean = worstQ.reduce((a, b) => a + b, 0) / worstQ.length
  const score = Math.round(0.7 * mean + 0.3 * worstMean)
  return { score, band: healthBand(score), mean: Math.round(mean), weak: s.filter(n => n < 70).length, min: Math.round(sorted[0]) }
}
