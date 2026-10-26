// THE ADMIN DESK — the data behind /admin (Jon, 2026-10-26: "a full admin dashboard page that directs
// our administrator": listing optimization, review management, photo captions, offline and online
// listings — suspended, removed, not live — blocked units, listings on Airbnb, which OTAs are live,
// last optimized, photo analysis).
//
// Nothing new is measured here. One row per listing is ASSEMBLED from what the app already keeps:
//   channels      lib/channel-health (Guesty's raw.integrations + bookings, the same verdicts /channels draws)
//   since         eve_audits — the channel audit opens one finding per listing × channel the day a
//                 problem appears, so first_seen_at says how long it has been like this
//   score         lib/optimize-score computeScore, on the same slim fields /buildings scores with
//   last optimized  lastOptimizedOf — the last_optimized column, else raw._lastOptimized
//   photos        raw.pictures captions judged by lib/photo-order isJunkCaption; _photoScore.at is
//                 the last analysis
//   reviews       guesty_reviews, 12 months: reply owed inside the reply window, low reviews, average
// Blocked units are NOT here: that report walks Guesty's live multi-calendar (slow) and the page
// loads it on its own, so a Guesty hiccup never blanks the rest of the desk.
//
// The verdicts (which rows need a person, which tile a row counts under) live in
// lib/admin-desk-shared.ts, which is pure and tested; this file only shapes the rows.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { buildChannelHealth, readSnapshot } from './channel-health'
import { CHANNELS_CACHE_TAG } from './channel-check'
import { CHANNELS } from './channel-types'
import { computeScore, lastOptimizedOf, rollupBuilding } from './optimize-score'
import { marketOf } from './segments'
import { isLowReview } from './review-scale'
import { isJunkCaption } from './photo-order'
import { pageRows } from './db-page'
import { RULES, isCombined, unitToken, type AdminRow, type ChannelCellLite } from './admin-desk-shared'

export const ADMIN_DESK_CACHE_TAG = 'admin-desk'

const str = (v: any) => (v == null ? '' : String(v)).trim()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export type AdminDesk = {
  at: string
  today: string
  rows: AdminRow[]
  channels: { key: string; label: string; major: boolean }[]
  /** When the channel trigger last compared the picture (the "since" dates come from its audit). */
  channelCheckedAt: string | null
  /** Honest counts of what was read, for the footer. */
  read: { listings: number; reviews: number }
}

// The channel picture is the slowest read (every listing × every channel, a year of bookings); it
// is cached under the same tag /channels uses, so a Refresh there is a refresh here.
const cachedChannels = unstable_cache(async () => buildChannelHealth(), ['admin-desk-channels-v1'], { tags: [CHANNELS_CACHE_TAG], revalidate: 600 })

/** Captions as Guesty holds them: how many photos, and how many carry no real caption. */
export function captionStats(pictures: any): { count: number; noCaption: number } {
  const pics: any[] = Array.isArray(pictures) ? pictures : []
  let noCaption = 0
  for (const p of pics) if (isJunkCaption(str(p && typeof p === 'object' ? p.caption : ''))) noCaption++
  return { count: pics.length, noCaption }
}

async function assemble(): Promise<AdminDesk> {
  const sb = supabaseAdmin()
  const today = ymd(new Date())
  const since365 = new Date(Date.now() - 365 * 86400000).toISOString()

  // Listings — the optimize score's slim fields (the same list /api/listing-health selects) plus the
  // pictures array for captions and the two "last" stamps. Never the whole raw blob.
  const listings: any[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await sb.from('guesty_listings')
      .select('id, title, nickname, building, unit, status, address_city, amenities, pictures, last_optimized, photo_score, lastOpt:raw->>_lastOptimized, pics:raw->pictures, pidx:raw->_photoIndex, rawPub:raw->publicDescription, rawPubs:raw->publicDescriptions, rawTerms:raw->terms, rawPrices:raw->prices, rawInts:raw->integrations, rawIb:raw->instantBookable, rawIb2:raw->instantBook, rawCi:raw->>defaultCheckInTime, rawCi2:raw->>checkInTime, rawCo:raw->>defaultCheckOutTime, rawCo2:raw->>checkOutTime, rawPs:raw->_photoScore, rawCp:raw->>cancellationPolicy, rawAirbnb:raw->airbnb, rawBcom:raw->bookingcom, rawTitle:raw->>title, rawMinN:raw->defaultListingMinNights, rawAmen:raw->amenities')
      .order('id').range(from, from + 999)
    if (error) throw new Error('guesty_listings: ' + error.message)
    listings.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  // Reviews — twelve months, paged. `dismissed` is read separately because the column arrived later
  // than the table and a missing column must not empty the desk.
  const reviews: any[] = []
  for (let from = 0; from < 30000; from += 1000) {
    const { data, error } = await sb.from('guesty_reviews')
      .select('listing_id, rating, channel, has_reply, created_at, excluded_from_score')
      .gte('created_at', since365).order('created_at', { ascending: false }).range(from, from + 999)
    if (error) throw new Error('guesty_reviews: ' + error.message)
    reviews.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const dismissed = new Set<string>()
  try {
    const { rows: dz } = await pageRows<any>((a, b) => sb.from('guesty_reviews').select('id').eq('dismissed', true).gte('created_at', since365).order('id').range(a, b))
    for (const r of dz) dismissed.add(str(r.id))
  } catch { /* pre-migration: nothing dismissed */ }
  // The dismissed set is by review id, but the main read has no id to save bytes — re-read the owed
  // candidates' ids only when something is dismissed at all.
  let owedIds: Map<string, Set<string>> | null = null
  if (dismissed.size) {
    owedIds = new Map()
    const sinceWindow = new Date(Date.now() - RULES.replyWindowDays * 86400000).toISOString()
    const { rows: cand } = await pageRows<any>((a, b) => sb.from('guesty_reviews').select('id, listing_id').eq('has_reply', false).gte('created_at', sinceWindow).order('id').range(a, b))
    for (const r of cand) {
      const lid = str(r.listing_id); if (!lid) continue
      if (!owedIds.has(lid)) owedIds.set(lid, new Set())
      if (!dismissed.has(str(r.id))) owedIds.get(lid)!.add(str(r.id))
    }
  }

  // Since-dates: the channel audit's open findings, one per listing × channel.
  const since: Record<string, string> = {}
  try {
    const { rows: au } = await pageRows<any>((a, b) => sb.from('eve_audits').select('id, first_seen_at, status').like('id', 'channel:%').neq('status', 'resolved').order('id').range(a, b))
    for (const a of au) {
      const parts = str(a.id).split(':')   // channel:<listingId>:<platform>
      if (parts.length >= 3) since[parts[1] + ':' + parts.slice(2).join(':')] = str(a.first_seen_at)
    }
  } catch { /* no audit table yet: no since dates */ }

  // PERFORMANCE (Jon, 2026-10-26: "if a unit is performing poorly, recommend a refresh"). The last
  // 90 settled days, the same way /buildings scores the revenue pillar: nights and value prorated
  // into the window, RevPAR per available night, indexed against the building's median over its
  // earning units. Bookings made are counted by created_at so a unit that just went live reads
  // "no numbers yet" rather than "poor".
  const occDays = 90
  const occStart = ymd(new Date(Date.now() - occDays * 86400000))
  const occNights: Record<string, number> = {}
  const occRev: Record<string, number> = {}
  const made90: Record<string, number> = {}
  {
    const winStart = new Date(occStart + 'T00:00:00Z').getTime(), winEnd = new Date(today + 'T00:00:00Z').getTime()
    const { rows: stays } = await pageRows<any>((a, b) => sb.from('guesty_reservations')
      .select('id, listing_id, check_in, check_out, status, money_total, nights, created_at')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_out', occStart).lte('check_in', today)
      .order('id').range(a, b), 40)
    for (const r of stays) {
      const id = str(r.listing_id); if (!id) continue
      const ci = new Date(String(r.check_in).slice(0, 10) + 'T00:00:00Z').getTime()
      const co = new Date(String(r.check_out).slice(0, 10) + 'T00:00:00Z').getTime()
      if (isNaN(ci) || isNaN(co)) continue
      const nights = Math.round((Math.min(co, winEnd) - Math.max(ci, winStart)) / 86400000)
      if (nights > 0) {
        occNights[id] = (occNights[id] || 0) + nights
        const total = Number(r.money_total) || 0, stayNights = Number(r.nights) || 0
        occRev[id] = (occRev[id] || 0) + (stayNights > 0 ? total * (nights / stayNights) : total)
      }
      if (str(r.created_at).slice(0, 10) >= occStart) made90[id] = (made90[id] || 0) + 1
    }
  }
  const median = (nums: number[]): number | null => { const a = nums.filter(n => n > 0).slice().sort((x, y) => x - y); if (a.length < 2) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
  // Combined listings (the whole apartment sold alongside its halves) are judged by their halves,
  // never by their own calendar — and they do not set the building's median either.
  const tokensBy: Record<string, string[]> = {}
  for (const l of listings) { const b = rollupBuilding(l.building, str(l.nickname) || str(l.title) || str(l.id)); (tokensBy[b] = tokensBy[b] || []).push(unitToken(str(l.nickname) || str(l.title) || str(l.id))) }
  const combinedIds = new Set<string>()
  for (const l of listings) { const nm = str(l.nickname) || str(l.title) || str(l.id); const b = rollupBuilding(l.building, nm); if (isCombined(nm, tokensBy[b] || [])) combinedIds.add(str(l.id)) }
  const revparBy: Record<string, number> = {}
  const peersBy: Record<string, number[]> = {}
  for (const l of listings) {
    const id = str(l.id); if (str(l.status).toLowerCase() !== 'active') continue
    const b = rollupBuilding(l.building, str(l.nickname) || str(l.title) || id)
    const rp = (occRev[id] || 0) / occDays
    revparBy[id] = rp
    if (rp > 0 && !combinedIds.has(id)) (peersBy[b] = peersBy[b] || []).push(rp)
  }
  const medianBy: Record<string, number | null> = {}
  for (const b of Object.keys(peersBy)) medianBy[b] = median(peersBy[b])

  const [health, snap] = await Promise.all([cachedChannels(), readSnapshot()])
  const healthById = new Map<string, any>()
  for (const l of health.listings) healthById.set(l.id, l)
  for (const l of health.inactive) healthById.set(l.id, l)

  // Reviews per listing.
  const windowStart = ymd(new Date(Date.now() - RULES.replyWindowDays * 86400000))
  const lowStart = ymd(new Date(Date.now() - RULES.lowReviewDays * 86400000))
  const revBy = new Map<string, { sum: number; n: number; owed: number; owedLow: number; low30: number; last: string | null }>()
  for (const r of reviews) {
    const lid = str(r.listing_id); if (!lid) continue
    const g = revBy.get(lid) || { sum: 0, n: 0, owed: 0, owedLow: 0, low30: 0, last: null }
    const day = str(r.created_at).slice(0, 10)
    const rating = r.rating != null && r.rating !== '' ? Number(r.rating) : null
    const low = rating != null && isLowReview(rating, r.channel)
    if (rating != null && !r.excluded_from_score) { g.sum += rating; g.n++ }
    if (!g.last || day > g.last) g.last = day
    if (day >= lowStart && low) g.low30++
    if (!r.has_reply && day >= windowStart) {
      // With nothing dismissed, every unreplied review in the window is owed; otherwise only the ids
      // the second read kept.
      const owed = owedIds ? (owedIds.get(lid)?.size || 0) > 0 : true
      if (owed) {
        if (!owedIds) { g.owed++; if (low) g.owedLow++ }
      }
    }
    revBy.set(lid, g)
  }
  // When dismissals exist the owed count is the kept ids (low split re-derived from the rows).
  if (owedIds) {
    for (const [lid, ids] of Array.from(owedIds.entries())) {
      const g = revBy.get(lid) || { sum: 0, n: 0, owed: 0, owedLow: 0, low30: 0, last: null }
      g.owed = ids.size
      g.owedLow = reviews.filter(r => str(r.listing_id) === lid && !r.has_reply && str(r.created_at).slice(0, 10) >= windowStart && r.rating != null && isLowReview(Number(r.rating), r.channel)).length
      if (g.owedLow > g.owed) g.owedLow = g.owed
      revBy.set(lid, g)
    }
  }

  const rows: AdminRow[] = listings.map((l: any) => {
    const id = str(l.id)
    const name = str(l.nickname) || str(l.title) || id
    const building = rollupBuilding(l.building, name)
    const market = marketOf(l.building, l.address_city, name)
    const active = str(l.status).toLowerCase() === 'active'
    const h = healthById.get(id)
    const channels: Record<string, ChannelCellLite> = {}
    for (const ch of CHANNELS) {
      const c = h?.cells?.[ch.key]
      channels[ch.key] = c
        ? { verdict: c.verdict, status: c.status, approval: c.approval, url: c.url, lastBookingAt: c.lastBookingAt, bookings90d: c.bookings90d, since: since[id + ':' + ch.key] || (ch.key === 'airbnb2' ? since[id + ':airbnb2:approval'] : undefined) || null }
        : { verdict: 'missing', status: null, approval: null, url: null, lastBookingAt: null, bookings90d: 0, since: null }
    }
    const rv = revBy.get(id)
    const avg = rv && rv.n ? Math.round((rv.sum / rv.n) * 100) / 100 : null
    const slim = { ...l, raw: { publicDescription: l.rawPub, publicDescriptions: l.rawPubs, terms: l.rawTerms, prices: l.rawPrices, integrations: l.rawInts, instantBookable: l.rawIb, instantBook: l.rawIb2, defaultCheckInTime: l.rawCi, checkInTime: l.rawCi2, defaultCheckOutTime: l.rawCo, checkOutTime: l.rawCo2, _photoScore: l.rawPs, cancellationPolicy: l.rawCp, airbnb: l.rawAirbnb, bookingcom: l.rawBcom, title: l.rawTitle, defaultListingMinNights: l.rawMinN, amenities: l.rawAmen, _lastOptimized: l.lastOpt } }
    let score: number | null = null
    try { score = computeScore(slim, { avgRating: avg, reviewCount: rv ? rv.n : 0 }).overall } catch { score = null }
    const caps = captionStats(l.pics)
    const ps = (l.photo_score && typeof l.photo_score === 'object') ? l.photo_score : (l.rawPs && typeof l.rawPs === 'object' ? l.rawPs : null)
    return {
      id, name, building, market, active, guestyStatus: str(l.status) || '(none)',
      channels, verdict: h ? h.verdict : 'missing',
      score,
      lastOptimized: lastOptimizedOf(slim).at,
      photos: { count: caps.count || (Array.isArray(l.pictures) ? l.pictures.length : 0), noCaption: caps.noCaption, analyzedAt: ps && ps.at ? str(ps.at) : null, photoScore: ps && Number.isFinite(Number(ps.score)) ? Number(ps.score) : null },
      reviews: { avg, count: rv ? rv.n : 0, owed: rv ? rv.owed : 0, owedLow: rv ? rv.owedLow : 0, low30: rv ? rv.low30 : 0, last: rv ? rv.last : null },
      perf: active ? (() => {
        const peers = (peersBy[building] || []).length
        const med = medianBy[building]
        const rp = revparBy[id] || 0
        return { bookings90: made90[id] || 0, occ90: Math.min(1, (occNights[id] || 0) / occDays), revparIndex: med && med > 0 ? Math.round((rp / med) * 100) / 100 : null, peers, ...(combinedIds.has(id) ? { combined: true } : {}) }
      })() : null,
      cover: (() => {
        const pics: any[] = Array.isArray(l.pics) ? l.pics : []
        const first = pics[0] && typeof pics[0] === 'object' ? pics[0] : null
        const idx = l.pidx && typeof l.pidx === 'object' ? l.pidx : null
        const e = first && idx ? idx[str(first._id)] : null
        return e ? { quality: Number.isFinite(Number(e.quality)) ? Number(e.quality) : null, kind: e.kind ? str(e.kind) : null, shotType: e.shotType ? str(e.shotType) : null, category: e.category ? str(e.category) : null } : null
      })(),
      blocked: null,
    }
  }).sort((a, b) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name))

  return {
    at: new Date().toISOString(), today, rows,
    channels: CHANNELS.map(c => ({ key: c.key, label: c.label, major: c.major })),
    channelCheckedAt: snap ? snap.at : null,
    read: { listings: listings.length, reviews: reviews.length },
  }
}

/** The desk, cached five minutes; POST /api/admin-desk/refresh (or any channel refresh) busts it. */
export const buildAdminDesk = unstable_cache(assemble, ['admin-desk-v1'], { tags: [ADMIN_DESK_CACHE_TAG, CHANNELS_CACHE_TAG], revalidate: 300 })
