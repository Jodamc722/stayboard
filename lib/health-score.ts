// Master Listing Health Score - the portfolio's top quality metric. Encompasses the
// Optimize/setup score AND operational/review health, evidence-weighted to how the OTAs
// actually rank in 2025/26 (recent guest satisfaction dominates; setup is a gate).
//   Master (0-100) = Review/Ops health (65) + Optimize score (35)
//     A1 recency-weighted rating 28 · A2 volume 8 · A3 response 9 · A4 recurring penalty -12 · A5 ops 8 · B setup 35
// Also scores each OTA separately (normalized to each platform's badge line = 80) and
// emits ranked, team-assignable actions. Building rollup = 0.70*mean + 0.30*worst-quartile.
import { computeScore } from '@/lib/optimize-score'

export type HealthBand = 'elite' | 'healthy' | 'watch' | 'risk' | 'critical' | 'neutral'
export type ChannelKey = 'airbnb' | 'vrbo' | 'bookingcom' | 'expedia' | 'other'
export type HealthReview = { rating: number | null; channel?: string | null; content?: string | null; created_at?: string | null; hasReply?: boolean }
export type Issue = { key: string; severity: 'critical' | 'high' | 'medium' | 'low'; title: string; action: string; owner: string; gain: number; channel?: string | null }
export type ChannelHealth = { channel: ChannelKey; label: string; score: number; band: HealthBand; avgStars: number | null; reviewCount: number; responseRate: number | null; badge: string | null }
export type ListingHealth = {
  score: number
  band: HealthBand
  unrated: boolean
  optimizeScore: number
  breakdown: { rating: number; volume: number; response: number; penalty: number; ops: number; setup: number }
  review: { avgStars: number | null; recencyQuality: number | null; count: number; ratedCount: number; responseRate: number | null; recurring: string[]; topIssue: string | null }
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
// stars -> 0-100 quality, anchored so the badge line = 80, floor = 40.
function normQuality(stars: number, ch: ChannelKey): number {
  const a = ANCHOR[ch]
  return Math.max(0, Math.min(100, 40 + ((stars - a.floor) / (a.badge - a.floor)) * 40))
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

/* ------------------------------ main entry -------------------------------- */
export function computeListingHealth(listing: any, reviews: HealthReview[], opts?: { openWork?: number }): ListingHealth {
  const openWork = opts?.openWork ?? 0
  const optimizeScore = computeScore(listing, { isBeach: /beach/i.test(String(listing?.address_city || '')) }).overall

  const rated = reviews.filter(r => toStars(r.rating) != null)
  const count = reviews.length
  const ratedCount = rated.length
  const unrated = ratedCount === 0

  // A1 recency-weighted normalized quality (cross-channel).
  let wSum = 0, wqSum = 0, starSum = 0
  rated.forEach(r => {
    const stars = toStars(r.rating)!
    const q = normQuality(stars, channelKey(r.channel))
    const w = recencyWeight(r.created_at)
    wSum += w; wqSum += w * q; starSum += stars
  })
  const recencyQuality = wSum > 0 ? wqSum / wSum : null
  const avgStars = ratedCount ? Math.round((starSum / ratedCount) * 100) / 100 : null
  const A1 = recencyQuality != null ? (recencyQuality / 100) * 28 : 0

  // A2 volume.
  const A2 = volumeFrac(count) * 8

  // A3 response rate.
  const replied = reviews.filter(r => r.hasReply).length
  const responseRate = count ? replied / count : null
  const A3 = responseFrac(responseRate) * 9

  // A4 recurring-issue penalty (negative reviews only; cleanliness double).
  const themeHits: Record<string, number> = {}
  reviews.forEach(r => {
    const stars = toStars(r.rating)
    const neg = stars != null && stars <= 3.5
    const text = String(r.content || '').toLowerCase()
    if (!text || !neg) return
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
  const A5 = opsPts(openWork, 8)

  // B setup.
  const B = (optimizeScore / 100) * 35

  let score: number
  if (unrated) {
    // No reviews yet: provisional health = setup quality, flagged neutral (don't unfairly zero).
    score = Math.round(optimizeScore)
  } else {
    score = Math.round(Math.max(0, Math.min(100, A1 + A2 + A3 + A5 - A4 + B)))
  }
  const band = healthBand(score, unrated)

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
  if (openWork >= 5) add({ key: 'ops', severity: 'medium', title: `${openWork} open ops items on this building`, action: 'Triage the Breezeway/field backlog; close stale and guest-impacting tasks.', owner: 'Ops supervisor', gain: 3 })
  if (unrated) add({ key: 'noreviews', severity: 'low', title: 'No reviews yet', action: 'Drive first stays and request reviews to start building OTA ranking.', owner: 'Mini-GM', gain: 0 })
  const sev = { critical: 0, high: 1, medium: 2, low: 3 }
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || b.gain - a.gain)

  return {
    score, band, unrated, optimizeScore,
    breakdown: { rating: Math.round(A1), volume: Math.round(A2), response: Math.round(A3), penalty: Math.round(A4), ops: Math.round(A5), setup: Math.round(B) },
    review: { avgStars, recencyQuality: recencyQuality != null ? Math.round(recencyQuality) : null, count, ratedCount, responseRate: responseRate != null ? Math.round(responseRate * 100) : null, recurring, topIssue },
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
