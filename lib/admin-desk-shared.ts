// THE ADMIN DESK — the rules behind the administrator's page (Jon, 2026-10-26: "a full admin
// dashboard page that directs our administrator": listing optimization, review management, photo
// captions, offline and online listings — suspended, removed, not live — blocked units, listings on
// Airbnb, which OTAs are live, last optimized, photo analysis).
//
// One row per listing, built by lib/admin-desk.ts from what the app already knows (channel health,
// reviews, the optimize score, the photo index, Guesty's own status). THIS file judges the rows:
// which ones need a person today, in what order, and which tile each row counts under. The page
// draws exactly these verdicts, so a number on a tile is always the rows its click shows and a
// "Do now" line always says why it is there.
//
// Pure and client-safe: no imports of values, no dates read from the clock (today is passed in), so
// lib/__tests__/admin-desk.test.mjs runs it with plain node and the browser bundles it unchanged.
import type { CellVerdict } from './channel-types'

// ── The thresholds, in one place and on the page's hover text ───────────────────────────────────
export const RULES = {
  /** EVERY THREE MONTHS (Jon, 2026-10-26: "we should optimize and rearrange every 3 months"): a
   *  listing optimized longer ago than this is due again. */
  staleOptimizeDays: 90,
  /** An optimize score under this is work whatever the date says. */
  lowScore: 60,
  /** Fewer photos than this and guests cannot verify the home. */
  minPhotos: 15,
  /** Captions missing on at least this many photos, or this share of them, is a captions job. */
  captionGapMin: 5,
  captionGapShare: 0.3,
  /** The photo analysis — and with it the order and the cover — older than this (or never run) is due. */
  staleAnalysisDays: 90,
  /** UNDERPERFORMING (Jon, 2026-10-26: "if a unit is performing poorly, recommend a refresh, new
   *  cover photo, etc."): RevPAR over the last 90 days at or under this share of its building's
   *  median (2+ earning peers needed) is poor; under `watchRevparIndex` is worth watching. */
  poorRevparIndex: 0.7,
  watchRevparIndex: 0.85,
  /** A cover photo under this quality (the photo analysis's 0–100) should be replaced. */
  coverMinQuality: 65,
  /** On an underperformer, a cover under this is still worth trying to beat. */
  coverTryQuality: 80,
  /** Channels close replies after about a month; a review older than this is no longer owed. */
  replyWindowDays: 30,
  /** A low review in this window is a flag on the unit. */
  lowReviewDays: 30,
  /** A block this long, not caused by a sibling booking, is worth a second look. */
  longBlockNights: 7,
  /** A channel missing on this share of the active portfolio (and at least this many listings) is a
   *  distribution decision, not one to-do per listing: Do now carries ONE line for the channel. */
  channelRolloutShare: 0.25,
  channelRolloutMin: 10,
} as const

export type Severity = 'high' | 'medium' | 'low'
export type ChannelCellLite = {
  verdict: CellVerdict
  status: string | null
  approval: string | null
  url: string | null
  lastBookingAt: string | null
  bookings90d: number
  /** When the app first saw this problem (from the channel audit), or null when it is fine / unknown. */
  since: string | null
}
export type AdminRow = {
  id: string
  name: string
  building: string
  market: string
  active: boolean
  guestyStatus: string
  channels: Record<string, ChannelCellLite>
  /** Worst verdict across the major channels. */
  verdict: CellVerdict
  score: number | null
  lastOptimized: string | null
  photos: { count: number; noCaption: number; analyzedAt: string | null; photoScore: number | null }
  reviews: { avg: number | null; count: number; owed: number; owedLow: number; low30: number; last: string | null }
  /** The last 90 days against the building: bookings made, occupancy, RevPAR as a share of the
   *  building's median over its earning units (`peers`), null when there is nothing to index against. */
  perf?: { bookings90: number; occ90: number | null; revparIndex: number | null; peers: number } | null
  /** The cover (first photo) as the photo analysis saw it; null when the analysis has not seen it. */
  cover?: { quality: number | null; kind: string | null; shotType: string | null; category: string | null } | null
  /** Filled in by the page from /api/blocked-units; null until then or when the unit is open. */
  blocked?: { nights: number; reason: string; openEnded: boolean; from: string; linked: boolean } | null
}

export type WorkKind = 'channel' | 'reply' | 'refresh' | 'optimize' | 'photos' | 'blocked'
export type WorkItem = {
  kind: WorkKind
  severity: Severity
  listingId: string
  name: string
  building: string
  market: string
  /** One line: what is wrong. */
  title: string
  /** One line: the evidence, for the hover and the expand. */
  why: string
  /** The verb on the button. */
  verb: string
  href: string
  /** For a channel item: which channel. */
  channel?: string
  /** For a refresh: the steps, in order. */
  steps?: string[]
}

export const PROBLEM: CellVerdict[] = ['suspended', 'failed', 'disconnected', 'missing']
export const NOT_FOR_SALE: CellVerdict[] = ['suspended', 'failed', 'disconnected']
const MAJORS = ['airbnb2', 'bookingCom', 'homeaway2', 'expedia']
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's')
const LABEL: Record<string, string> = { airbnb2: 'Airbnb', bookingCom: 'Booking.com', homeaway2: 'Vrbo', expedia: 'Expedia', googleVacationRentals: 'Google VR', hopper: 'Hopper', bluegroundNestpick: 'Blueground', whimstay: 'Whimstay', homesVillasByMarriott: 'Marriott HVMI' }
const VERDICT_WORD: Record<string, string> = { suspended: 'suspended', failed: 'failed', disconnected: 'disconnected', missing: 'not connected', unknown: 'unknown', stale: 'no bookings', live: 'live' }
export const channelLabel = (k: string) => LABEL[k] || k

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────
/** Whole days from an ISO stamp (or Y-M-D) to `today` (Y-M-D); null when there is no date. */
export function daysSince(iso: string | null | undefined, today: string): number | null {
  const s = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const a = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  return Math.round((b - a) / 86400000)
}
/** "today" · "3d" · "2mo" · "1y" — the compact age a tag can carry. */
export function agoShort(iso: string | null | undefined, today: string): string {
  const d = daysSince(iso, today)
  if (d == null) return 'never'
  if (d <= 0) return 'today'
  if (d < 30) return d + 'd'
  if (d < 365) return Math.round(d / 30) + 'mo'
  return Math.round(d / 365) + 'y'
}

// ── Per-row states ──────────────────────────────────────────────────────────────────────────────
export type OptimizeState = 'never' | 'low' | 'stale' | 'ok'
export function optimizeState(r: Pick<AdminRow, 'score' | 'lastOptimized'>, today: string): OptimizeState {
  if (!r.lastOptimized) return 'never'
  if (r.score != null && r.score < RULES.lowScore) return 'low'
  const d = daysSince(r.lastOptimized, today)
  if (d != null && d > RULES.staleOptimizeDays) return 'stale'
  return 'ok'
}
export type PhotoFlag = 'few' | 'captions' | 'unanalyzed' | 'stale-analysis'
export function photoFlags(p: AdminRow['photos'], today: string): PhotoFlag[] {
  const out: PhotoFlag[] = []
  if (p.count < RULES.minPhotos) out.push('few')
  if (p.count > 0 && (p.noCaption >= RULES.captionGapMin || p.noCaption / p.count >= RULES.captionGapShare)) out.push('captions')
  if (p.count > 0) {
    if (!p.analyzedAt) out.push('unanalyzed')
    else { const d = daysSince(p.analyzedAt, today); if (d != null && d > RULES.staleAnalysisDays) out.push('stale-analysis') }
  }
  return out
}

/** How the unit is doing against its building over the last 90 days. */
export type PerfState = 'poor' | 'watch' | 'ok' | 'unknown'
export function performance(r: Pick<AdminRow, 'active' | 'perf'>): { state: PerfState; why: string } {
  const p = r.perf
  if (!r.active || !p || p.revparIndex == null || p.peers < 2) return { state: 'unknown', why: p && p.peers < 2 ? 'No building peers to compare with' : 'No 90-day numbers yet' }
  const pct = Math.round((1 - p.revparIndex) * 100)
  const occ = p.occ90 != null ? ' · occupancy ' + Math.round(p.occ90 * 100) + '%' : ''
  if (p.revparIndex <= RULES.poorRevparIndex) return { state: 'poor', why: 'RevPAR ' + pct + '% under its building peers over 90 days (' + p.peers + ' earning units)' + occ }
  if (p.revparIndex <= RULES.watchRevparIndex) return { state: 'watch', why: 'RevPAR ' + pct + '% under its building peers over 90 days' + occ }
  return { state: 'ok', why: 'RevPAR ' + (pct <= 0 ? Math.abs(pct) + '% over' : pct + '% under') + ' its building peers over 90 days' + occ }
}
const WEAK_COVER_CATEGORIES = ['bathroom', 'exterior', 'detail', 'other', 'amenity']
/** Is the cover photo weak — too low a quality, stock, a close-up, or a room no guest clicks on? */
export function coverVerdict(c: AdminRow['cover']): { weak: boolean; why: string } {
  if (!c) return { weak: false, why: 'cover not analyzed yet' }
  const why: string[] = []
  if (c.quality != null && c.quality < RULES.coverMinQuality) why.push('quality ' + c.quality)
  if (c.kind === 'stock') why.push('stock photo')
  if (c.shotType === 'detail') why.push('a close-up')
  if (c.category && WEAK_COVER_CATEGORIES.indexOf(c.category) >= 0) why.push(c.category + ' as the cover')
  return { weak: why.length > 0, why: why.length ? why.join(', ') : 'quality ' + (c.quality ?? '?') + (c.category ? ' · ' + c.category : '') }
}
/**
 * THE REFRESH (Jon, 2026-10-26): what to do on a unit that is performing poorly, in the order it
 * pays — the cover decides the click, the first five decide the open, the copy and price decide the
 * booking. Each step is one line a person can act on.
 */
export function refreshSteps(r: AdminRow, today: string): string[] {
  const out: string[] = []
  const cv = coverVerdict(r.cover)
  if (!r.cover) out.push('Run the photo analysis and pick the cover it rates highest (the current cover has not been analyzed)')
  else if (cv.weak) out.push('New cover photo — the current one reads ' + cv.why)
  else if (r.cover.quality != null && r.cover.quality < RULES.coverTryQuality) out.push('Try a new cover — the current one is ' + r.cover.quality + '/100 and the search card is the click')
  const pf = photoFlags(r.photos, today)
  if (pf.indexOf('unanalyzed') >= 0 || pf.indexOf('stale-analysis') >= 0) out.push('Re-run the photo analysis and re-order the first five' + (r.photos.analyzedAt ? ' (last ' + agoShort(r.photos.analyzedAt, today) + ' ago)' : ''))
  if (pf.indexOf('few') >= 0) out.push('Shoot more photos — ' + r.photos.count + ' is not enough to verify the home')
  if (pf.indexOf('captions') >= 0) out.push('Caption the ' + r.photos.noCaption + ' photos with no caption')
  const os = optimizeState(r, today)
  if (os !== 'ok') out.push('Re-optimize the title and description (' + (os === 'never' ? 'never optimized' : os === 'low' ? 'score ' + r.score : 'last pass ' + agoShort(r.lastOptimized, today) + ' ago') + ')')
  if (r.reviews.low30 > 0) out.push('Read the ' + plural(r.reviews.low30, 'low review') + ' from the last ' + RULES.lowReviewDays + ' days and fix what they name first')
  out.push('Check the rate against its building peers in the Revenue App')
  return out
}

// ── The tiles. Each key is a rule; rowInTile() is the ONLY test, used both to count and to filter. ─
export type TileKey = 'all' | 'liveAll' | 'notForSale' | 'notConnected' | 'offline' | 'replyOwed' | 'lowReviews' | 'refresh' | 'neverOptimized' | 'staleOptimized' | 'captions' | 'unanalyzed' | 'blocked'
export const TILES: { key: TileKey; label: string; hint: string }[] = [
  { key: 'liveAll', label: 'Live everywhere', hint: 'Active in Guesty and live (or simply quiet) on every major channel: Airbnb, Booking.com, Vrbo, Expedia' },
  { key: 'notForSale', label: 'Not for sale', hint: 'Active in Guesty but suspended, failed or disconnected on a major channel — the listing exists there and is not selling' },
  { key: 'notConnected', label: 'Not connected', hint: 'Active in Guesty with no integration at all on a major channel' },
  { key: 'offline', label: 'Offline in Guesty', hint: 'Not active in Guesty (inactive, archived, …) — off every channel' },
  { key: 'replyOwed', label: 'Reply owed', hint: `Reviews from the last ${RULES.replyWindowDays} days with no reply and not dismissed` },
  { key: 'lowReviews', label: 'Low reviews', hint: `A low review in the last ${RULES.lowReviewDays} days (Airbnb/Vrbo 3★ or under, Booking 7/10 or under)` },
  { key: 'neverOptimized', label: 'Never optimized', hint: 'The optimizer has never written this listing' },
  { key: 'refresh', label: 'Refresh recommended', hint: `Performing poorly: RevPAR ${Math.round((1 - RULES.poorRevparIndex) * 100)}%+ under its building peers over the last 90 days — new cover photo, re-order, re-optimize` },
  { key: 'staleOptimized', label: 'Optimize again', hint: `Every 3 months: optimized more than ${RULES.staleOptimizeDays} days ago, or an optimize score under ${RULES.lowScore}` },
  { key: 'captions', label: 'Captions missing', hint: `${RULES.captionGapMin}+ photos (or ${Math.round(RULES.captionGapShare * 100)}%) with no real caption — blank, a file name, a camera number` },
  { key: 'unanalyzed', label: 'Photos to re-order', hint: `Every 3 months: photo analysis (order, cover, captions) never run or older than ${RULES.staleAnalysisDays} days` },
  { key: 'blocked', label: 'Blocked now', hint: 'Out of service today on the Guesty calendar (not auto-blocked by a sibling booking)' },
]
export function rowInTile(r: AdminRow, tile: TileKey, today: string): boolean {
  switch (tile) {
    case 'all': return true
    case 'liveAll': return r.active && !MAJORS.some(k => r.channels[k] && PROBLEM.indexOf(r.channels[k].verdict) >= 0)
    case 'notForSale': return r.active && MAJORS.some(k => r.channels[k] && NOT_FOR_SALE.indexOf(r.channels[k].verdict) >= 0)
    case 'notConnected': return r.active && MAJORS.some(k => r.channels[k] && r.channels[k].verdict === 'missing')
    case 'offline': return !r.active
    case 'replyOwed': return r.active && r.reviews.owed > 0
    case 'lowReviews': return r.active && r.reviews.low30 > 0
    case 'refresh': return r.active && performance(r).state === 'poor'
    case 'neverOptimized': return r.active && optimizeState(r, today) === 'never'
    case 'staleOptimized': { const s = optimizeState(r, today); return r.active && (s === 'stale' || s === 'low') }
    case 'captions': return r.active && photoFlags(r.photos, today).indexOf('captions') >= 0
    case 'unanalyzed': { const f = photoFlags(r.photos, today); return r.active && (f.indexOf('unanalyzed') >= 0 || f.indexOf('stale-analysis') >= 0) }
    case 'blocked': return !!(r.blocked && !r.blocked.linked)
  }
  return false
}
export function tileCounts(rows: AdminRow[], today: string): Record<TileKey, number> {
  const out = {} as Record<TileKey, number>
  const keys: TileKey[] = ['all', 'liveAll', 'notForSale', 'notConnected', 'offline', 'replyOwed', 'lowReviews', 'refresh', 'neverOptimized', 'staleOptimized', 'captions', 'unanalyzed', 'blocked']
  for (const k of keys) out[k] = rows.filter(r => rowInTile(r, k, today)).length
  return out
}

// ── The channel strip: active listings per channel per verdict ──────────────────────────────────
export type ChannelCount = { key: string; label: string; live: number; stale: number; suspended: number; failed: number; disconnected: number; missing: number; unknown: number }
export function channelCounts(rows: AdminRow[], keys: string[]): ChannelCount[] {
  return keys.map(k => {
    const c: ChannelCount = { key: k, label: channelLabel(k), live: 0, stale: 0, suspended: 0, failed: 0, disconnected: 0, missing: 0, unknown: 0 }
    for (const r of rows) {
      if (!r.active) continue
      const cell = r.channels[k]; if (!cell) continue
      ;(c as any)[cell.verdict] = ((c as any)[cell.verdict] || 0) + 1
    }
    return c
  })
}

// ── Do now ──────────────────────────────────────────────────────────────────────────────────────
const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
/** Within one severity: money first (a listing not for sale), then the reply clock, then the refresh, then the rest. */
const KIND_RANK: Record<WorkKind, number> = { channel: 0, reply: 1, refresh: 2, blocked: 3, optimize: 4, photos: 5 }

/**
 * Every line the administrator should act on, worst first. Channel trouble leads (a listing that is
 * not for sale earns nothing today), then replies that are about to close, then long blocks, then
 * the optimization and photo work that compounds over weeks. Offline-in-Guesty listings are a
 * section of the page, not a to-do: taking a listing offline is usually a decision, not a fault.
 */
export function worklist(rows: AdminRow[], today: string): WorkItem[] {
  const out: WorkItem[] = []
  // A channel nobody has connected across a quarter of the book (Expedia on 130 listings) is one
  // decision for the portfolio, not 130 lines that bury the seven listings that stopped selling.
  const activeN = rows.filter(r => r.active).length
  const missingBy: Record<string, number> = {}
  for (const r of rows) { if (!r.active) continue; for (const k of MAJORS) if (r.channels[k] && r.channels[k].verdict === 'missing') missingBy[k] = (missingBy[k] || 0) + 1 }
  const rollout = new Set(MAJORS.filter(k => (missingBy[k] || 0) >= RULES.channelRolloutMin && (missingBy[k] || 0) / Math.max(1, activeN) >= RULES.channelRolloutShare))
  for (const k of Array.from(rollout)) {
    out.push({
      listingId: '', name: 'Portfolio', building: '', market: '', kind: 'channel', channel: k, severity: 'low',
      title: channelLabel(k) + ' — not connected on ' + missingBy[k] + ' of ' + activeN + ' active listings',
      why: 'No ' + channelLabel(k) + ' integration on most of the book: a rollout to decide, not a fault on each listing. The Listings tab lists them under "Not connected".',
      verb: 'Review', href: '/channels?channel=' + encodeURIComponent(k) + '&problems=1',
    })
  }
  for (const r of rows) {
    if (!r.active) continue
    const base = { listingId: r.id, name: r.name, building: r.building, market: r.market }
    for (const k of MAJORS) {
      const c = r.channels[k]; if (!c || PROBLEM.indexOf(c.verdict) < 0) continue
      if (c.verdict === 'missing' && rollout.has(k)) continue
      const sinceTxt = c.since ? ' · since ' + String(c.since).slice(0, 10) : ''
      const detail = c.verdict === 'suspended' ? (c.approval ? 'Airbnb approval: ' + c.approval : 'Airbnb is not selling it')
        : c.verdict === 'missing' ? 'No ' + channelLabel(k) + ' integration on the listing in Guesty'
        : 'Guesty reports the connection ' + (c.status || c.verdict)
      out.push({
        ...base, kind: 'channel', channel: k,
        severity: c.verdict === 'missing' ? 'medium' : 'high',
        title: channelLabel(k) + ' — ' + VERDICT_WORD[c.verdict],
        why: detail + sinceTxt + (c.lastBookingAt ? ' · last booking ' + String(c.lastBookingAt).slice(0, 10) : ''),
        verb: 'Check', href: '/channels?listing=' + encodeURIComponent(r.id) + '&problems=1',
      })
    }
    if (r.reviews.owed > 0) {
      out.push({
        ...base, kind: 'reply',
        severity: r.reviews.owedLow > 0 ? 'high' : 'medium',
        title: plural(r.reviews.owed, 'review') + ' waiting for a reply' + (r.reviews.owedLow ? ' · ' + plural(r.reviews.owedLow, 'low review') : ''),
        why: 'Replies close about ' + RULES.replyWindowDays + ' days after the review' + (r.reviews.last ? ' · newest ' + String(r.reviews.last).slice(0, 10) : ''),
        verb: 'Reply', href: '/listings/' + encodeURIComponent(r.id) + '#reviews',
      })
    }
    const perf = performance(r)
    if (perf.state === 'poor') {
      const steps = refreshSteps(r, today)
      const cv = coverVerdict(r.cover)
      out.push({
        ...base, kind: 'refresh',
        severity: cv.weak || !r.cover || optimizeState(r, today) !== 'ok' ? 'high' : 'medium',
        title: 'Underperforming — ' + perf.why.split(' (')[0].replace(/ over 90 days$/, '') + ' · refresh',
        why: perf.why + '. ' + steps.length + ' steps: ' + steps.map(x => x.replace(/ [—(].*$/, '')).join(' · '),
        steps,
        verb: 'Refresh', href: '/listings/' + encodeURIComponent(r.id) + '#photos',
      })
    }
    if (r.blocked && !r.blocked.linked && r.blocked.nights >= RULES.longBlockNights) {
      out.push({
        ...base, kind: 'blocked', severity: 'medium',
        title: 'Blocked ' + (r.blocked.openEnded ? 'with no end date' : plural(r.blocked.nights, 'night')) + ' — ' + r.blocked.reason,
        why: 'Out of service since ' + r.blocked.from + (r.blocked.openEnded ? ' and still blocked at the end of the window' : ''),
        verb: 'Review', href: '/blocked',
      })
    }
    const os = optimizeState(r, today)
    if (os !== 'ok') {
      out.push({
        ...base, kind: 'optimize',
        severity: os === 'stale' ? 'low' : 'medium',
        title: os === 'never' ? 'Never optimized' : os === 'low' ? 'Optimize score ' + r.score : 'Optimized ' + agoShort(r.lastOptimized, today) + ' ago',
        why: os === 'never' ? 'The optimizer has never written this listing' + (r.score != null ? ' · score ' + r.score : '')
          : os === 'low' ? 'Under ' + RULES.lowScore + ' — title, description, photos, amenities or settings are costing visibility'
          : 'Every 3 months: more than ' + RULES.staleOptimizeDays + ' days since the last pass' + (r.score != null ? ' · score ' + r.score : ''),
        verb: 'Optimize', href: '/listings/' + encodeURIComponent(r.id) + '#content',
      })
    }
    const pf = photoFlags(r.photos, today)
    if (pf.length) {
      const bits: string[] = []
      if (pf.indexOf('few') >= 0) bits.push('only ' + plural(r.photos.count, 'photo'))
      if (pf.indexOf('captions') >= 0) bits.push(r.photos.noCaption + ' without a caption')
      if (pf.indexOf('unanalyzed') >= 0) bits.push('never analyzed')
      if (pf.indexOf('stale-analysis') >= 0) bits.push('analyzed ' + agoShort(r.photos.analyzedAt, today) + ' ago')
      out.push({
        ...base, kind: 'photos',
        severity: pf.indexOf('few') >= 0 ? 'medium' : 'low',
        title: 'Photos — ' + bits.join(', '),
        why: 'Guests verify the home in the photos: ' + RULES.minPhotos + '+ real shots, every one captioned, the order and cover re-checked by the analysis every 3 months',
        verb: 'Photos', href: '/listings/' + encodeURIComponent(r.id) + '#photos',
      })
    }
  }
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.building.localeCompare(b.building) || a.name.localeCompare(b.name))
}

/** How much a row needs a person — the board's default sort. */
export function rowWeight(r: AdminRow, today: string): number {
  let w = 0
  if (!r.active) return -1
  for (const k of MAJORS) { const c = r.channels[k]; if (!c) continue; if (NOT_FOR_SALE.indexOf(c.verdict) >= 0) w += 100; else if (c.verdict === 'missing') w += 40 }
  w += r.reviews.owedLow * 60 + r.reviews.owed * 25 + r.reviews.low30 * 10
  const ps = performance(r).state
  w += ps === 'poor' ? 50 : ps === 'watch' ? 12 : 0
  if (r.blocked && !r.blocked.linked) w += 30
  const os = optimizeState(r, today)
  w += os === 'never' ? 20 : os === 'low' ? 18 : os === 'stale' ? 8 : 0
  for (const f of photoFlags(r.photos, today)) w += f === 'few' ? 15 : f === 'captions' ? 8 : 5
  return w
}
