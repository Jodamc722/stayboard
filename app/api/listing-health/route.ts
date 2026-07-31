// Portfolio Health - the v2 master model. Per listing: master health (review/ops health +
// optimize score), per-OTA breakdown, and ranked actionable issues. Rolls up to buildings
// (0.70*mean + 0.30*worst-quartile). Excludes orphaned (unmapped) reviews from scoring.
// Reads persisted tables (fast, Guesty-independent). Logged-in users only.
import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeListingHealth, rollupBuildingHealth, type HealthReview } from '@/lib/health-score'
import { openWorkByListing } from '@/lib/open-work'
import { rollupBuilding } from '@/lib/optimize-score'
import { marketOf, isLux, isVendorManaged, MARKETS } from '@/lib/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const SKIP_BUILDINGS = ['waves']

// Cached 5 min (tag 'listing-health') - this compute walks every listing + full review set and was
// the slowest endpoint in the app (~3s per request); /health data tolerates 5-min staleness.
const computeHealth = unstable_cache(async () => {
    const sb = supabaseAdmin()

    const fetchAllReviews = async () => {
      let all: any[] = []
      for (let from = 0; from < 20000; from += 1000) {
        const { data } = await sb.from('guesty_reviews')
          .select('listing_id, rating, content, has_reply, created_at, channel')
          .eq('excluded_from_score', false)
          .range(from, from + 999)
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < 1000) break
      }
      return all
    }

    // Occupancy over the last 90 days, for the Listing Performance score. Paged (PostgREST caps at 1000).
    const occStart = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 90 * 86400000))
    const occToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
    const fetchOccResv = async () => {
      let all: any[] = []
      for (let from = 0; from < 30000; from += 1000) {
        const { data } = await sb.from('guesty_reservations')
          .select('listing_id, check_in, check_out, status')
          .in('status', ['confirmed', 'checked_in', 'checked_out'])
          .gte('check_out', occStart).lte('check_in', occToday)
          .order('check_out', { ascending: false })
          .range(from, from + 999)
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < 1000) break
      }
      return all
    }

    const [revRows, { data: listings }, work, occResv] = await Promise.all([
      fetchAllReviews(),
      // PERF: select ONLY the raw sub-fields computeOptimizeScore reads (publicDescription, terms,
      // integrations, instant-book, times, _photoScore, cancellation) — not the full raw blob.
      sb.from('guesty_listings')
        .select('id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, pictures, address_city, rawPub:raw->publicDescription, rawPubs:raw->publicDescriptions, rawTerms:raw->terms, rawPrices:raw->prices, rawInts:raw->integrations, rawIb:raw->instantBookable, rawIb2:raw->instantBook, rawCi:raw->>defaultCheckInTime, rawCi2:raw->>checkInTime, rawCo:raw->>defaultCheckOutTime, rawCo2:raw->>checkOutTime, rawPs:raw->_photoScore, rawCp:raw->>cancellationPolicy, rawAirbnb:raw->airbnb, rawBcom:raw->bookingcom, rawTitle:raw->>title, rawMinN:raw->defaultListingMinNights, rawAmen:raw->amenities')
        .limit(2000),
      openWorkByListing(sb),
      fetchOccResv(),
    ])

    // ---- Occupancy per unit (last 90d) + peer index vs its building ----
    const OCC_WINDOW = 90
    const winStart = new Date(occStart + 'T00:00:00Z').getTime()
    const winEnd = new Date(occToday + 'T00:00:00Z').getTime()
    const occNights: Record<string, number> = {}
    for (const r of (occResv || []) as any[]) {
      const id = String(r.listing_id || ''); if (!id) continue
      const ci = new Date(String(r.check_in).slice(0, 10) + 'T00:00:00Z').getTime()
      const co = new Date(String(r.check_out).slice(0, 10) + 'T00:00:00Z').getTime()
      if (isNaN(ci) || isNaN(co)) continue
      const from = Math.max(ci, winStart), to = Math.min(co, winEnd)
      const nights = Math.round((to - from) / 86400000)
      if (nights > 0) occNights[id] = (occNights[id] || 0) + nights
    }
    const occPctByListing: Record<string, number> = {}
    for (const id of Object.keys(occNights)) occPctByListing[id] = Math.min(1, occNights[id] / OCC_WINDOW)

    // Open ops weight PER UNIT (listing_id) — a unit's own backlog, not the whole building's.
    const openByListing = work || {}

    // Bucket reviews by listing.
    const byListing = new Map<string, HealthReview[]>()
    ;(revRows ?? []).forEach((r: any) => {
      if (!r.listing_id) return
      const arr = byListing.get(r.listing_id) || []
      arr.push({ rating: r.rating != null && r.rating !== '' ? Number(r.rating) : null, channel: r.channel, content: r.content, created_at: r.created_at, hasReply: !!r.has_reply })
      byListing.set(r.listing_id, arr)
    })

    const active = (listings ?? []).filter((l: any) =>
      !DEAD.includes(String(l.status || '').toLowerCase()) &&
      !SKIP_BUILDINGS.includes(rollupBuilding(l.building).toLowerCase()))
    // Only reviews still attached to an ACTIVE listing count — reviews on delisted/replaced/archived
    // units are ignored for scoring AND for the "reviews analyzed" stat (they'd inflate the number
    // with reputation that no longer belongs to a live listing).
    const activeIds = new Set((active as any[]).map(l => String(l.id)))
    const activeReviewCount = (revRows ?? []).filter((r: any) => r.listing_id && activeIds.has(String(r.listing_id))).length

    // Building median occupancy over the EARNING units (occ>0) — the "typical" performer to index
    // against. A building needs 2+ earning units to peer-compare; otherwise occIndex is null and
    // Listing Performance falls back to content + reputation.
    const occByBuilding: Record<string, number[]> = {}
    for (const l of active as any[]) {
      const b = rollupBuilding(l.building)
      const p = occPctByListing[String(l.id)]
      if (p != null && p > 0) (occByBuilding[b] ||= []).push(p)
    }
    const bMedianOcc: Record<string, number> = {}
    for (const b of Object.keys(occByBuilding)) {
      const arr = occByBuilding[b].slice().sort((x, y) => x - y)
      if (arr.length < 2) continue
      const mid = Math.floor(arr.length / 2)
      bMedianOcc[b] = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
    }

    const scored = active.map((l: any) => {
      const building = rollupBuilding(l.building)
      const reviews = byListing.get(l.id) || []
      const occPct = occPctByListing[String(l.id)] ?? null
      const med = bMedianOcc[building]
      const occIndex = med && med > 0 && occPct != null ? occPct / med : null
      // Rebuild the slim raw object from the sub-field selects (same shape computeOptimizeScore expects).
      const slim = { ...l, raw: { publicDescription: l.rawPub, publicDescriptions: l.rawPubs, terms: l.rawTerms, prices: l.rawPrices, integrations: l.rawInts, instantBookable: l.rawIb, instantBook: l.rawIb2, defaultCheckInTime: l.rawCi, checkInTime: l.rawCi2, defaultCheckOutTime: l.rawCo, checkOutTime: l.rawCo2, _photoScore: l.rawPs, cancellationPolicy: l.rawCp, airbnb: l.rawAirbnb, bookingcom: l.rawBcom, title: l.rawTitle, defaultListingMinNights: l.rawMinN, amenities: l.rawAmen } }
      const h = computeListingHealth(slim, reviews, { openWork: openByListing[String(l.id)] || 0, occIndex, occPct })
      const nm = l.title || l.nickname || l.id
      const lux = isLux(l.building || building, nm)
      const market = marketOf(l.building || building, l.address_city, nm)
      const vendorManaged = isVendorManaged(l.building || building, nm)
      return {
        id: l.id,
        name: nm,
        internalName: l.nickname || l.unit || null,
        building: building !== 'Unassigned' ? building : null,
        unit: l.unit || null,
        city: l.address_city || null,
        market,
        tier: lux ? 'Lux' : 'Other',
        lux,
        vendorManaged,
        score: h.score,
        band: h.band,
        pillars: h.pillars,
        unrated: h.unrated,
        optimizeScore: h.optimizeScore,
        avgStars: h.review.avgStars,
        reviewCount: h.review.count,
        lowConfidence: h.review.lowConfidence,
        responseRate: h.review.responseRate,
        recurring: h.review.recurring,
        topIssue: h.review.topIssue,
        breakdown: h.breakdown,
        channels: h.channels.map(c => ({ label: c.label, score: c.score, band: c.band, avgStars: c.avgStars, reviewCount: c.reviewCount, responseRate: c.responseRate, badge: c.badge })),
        issues: h.issues.map(i => ({ key: i.key, severity: i.severity, title: i.title, action: i.action, owner: i.owner, gain: i.gain })),
      }
    }).sort((a: any, b: any) => (a.unrated ? 1 : 0) - (b.unrated ? 1 : 0) || a.score - b.score)

    // Building rollups.
    const byBuilding = new Map<string, { name: string; scores: number[]; units: number }>()
    scored.forEach((s: any) => {
      const name = s.building || 'Unassigned'
      const g: { name: string; scores: number[]; units: number } = byBuilding.get(name) || { name, scores: [], units: 0 }
      g.units += 1
      if (!s.unrated) g.scores.push(s.score)
      byBuilding.set(name, g)
    })
    const buildings = Array.from(byBuilding.values()).map(g => {
      const r = rollupBuildingHealth(g.scores)
      return { name: g.name, units: g.units, score: r.score, band: r.band, mean: r.mean, weak: r.weak, min: r.min }
    }).sort((a, b) => (a.score ?? 999) - (b.score ?? 999))

    // ---- Flattened, prioritized PORTFOLIO ACTION list (each listing's issues, tagged w/ market+tier) ----
    const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const actions = scored.flatMap((l: any) =>
      (l.issues || []).map((i: any) => ({
        listingId: l.id, listing: l.name, building: l.building, unit: l.unit,
        market: l.market, tier: l.tier, lux: l.lux, vendorManaged: l.vendorManaged,
        score: l.score, band: l.band,
        key: i.key, severity: i.severity, title: i.title, action: i.action, owner: i.owner, gain: i.gain || 0,
      }))
    ).sort((a: any, b: any) =>
      (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
      (b.gain - a.gain) ||
      (a.score - b.score)
    )

    // ---- Segment summary: counts + avg score by market x tier ----
    const segKey = (m: string, t: string) => m + ' · ' + t
    const segMap = new Map<string, { market: string; tier: string; units: number; scoreSum: number; rated: number; criticalActions: number; openActions: number }>()
    for (const l of scored as any[]) {
      const k = segKey(l.market, l.tier)
      const g = segMap.get(k) || { market: l.market, tier: l.tier, units: 0, scoreSum: 0, rated: 0, criticalActions: 0, openActions: 0 }
      g.units += 1
      if (!l.unrated) { g.scoreSum += l.score; g.rated += 1 }
      g.openActions += (l.issues || []).length
      g.criticalActions += (l.issues || []).filter((i: any) => i.severity === 'critical' || i.severity === 'high').length
      segMap.set(k, g)
    }
    const segments = Array.from(segMap.values())
      .map(g => ({ market: g.market, tier: g.tier, units: g.units, avgScore: g.rated ? Math.round(g.scoreSum / g.rated) : null, openActions: g.openActions, criticalActions: g.criticalActions }))
      .sort((a, b) => MARKETS.indexOf(a.market as any) - MARKETS.indexOf(b.market as any) || (a.tier === 'Lux' ? -1 : 1))

    // distinct cities seen (to refine the Broward/Miami map if needed)
    const cityCount: Record<string, number> = {}
    for (const l of scored as any[]) { const c = l.city || '(none)'; cityCount[c] = (cityCount[c] || 0) + 1 }

    const rated = scored.filter((s: any) => !s.unrated)
    const withReviews = scored.filter((s: any) => s.reviewCount > 0)
    const count = (b: string) => scored.filter((s: any) => s.band === b).length
    const avgOf = (pick: (x: any) => number | null) => { const v = scored.map(pick).filter((n: any) => n != null) as number[]; return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0 }
    const summary = {
      listings: scored.length,
      avgScore: scored.length ? Math.round(scored.reduce((s: number, x: any) => s + x.score, 0) / scored.length) : 0,
      // Pillar averages for the header (the overall score leads; these show where the portfolio stands).
      avgOps: avgOf((x: any) => x.pillars.ops),
      avgListing: avgOf((x: any) => x.pillars.listing),
      avgRevenue: avgOf((x: any) => x.pillars.revenue),
      elite: count('elite'), healthy: count('healthy'), watch: count('watch'), atRisk: count('risk'), critical: count('critical'), neutral: count('neutral'),
      avgResponse: withReviews.length ? Math.round(withReviews.reduce((s: number, x: any) => s + (x.responseRate || 0), 0) / withReviews.length) : null,
      reviewsAnalyzed: activeReviewCount,
      openActions: scored.reduce((s: number, x: any) => s + x.issues.length, 0),
    }

    const dataPending = ['Conversion / CTR', 'Price vs. comps', 'Calendar openness', 'Live badge status', 'Acceptance & host-cancellation rate']
    return { summary, listings: scored, buildings, actions, segments, cities: cityCount, dataPending }
}, ['listing-health-v1'], { tags: ['listing-health'], revalidate: 300 })

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const full: any = await computeHealth()
    // SLIM — what the KPI home page needs. The full payload carries every listing with its per-channel
    // breakdown and issue list (hundreds of KB); the home page only shows the weakest units and the
    // highest-value fixes, so shipping the rest over the wire on every home load is pure waste.
    if (/[?&]slim=1/.test(String(req.url || ''))) {
      const worst = (full.listings || [])
        .filter((l: any) => !l.unrated)
        .slice(0, 12)
        .map((l: any) => ({
          id: l.id, name: l.name, building: l.building, market: l.market, tier: l.tier,
          score: l.score, band: l.band, optimizeScore: l.optimizeScore,
          avgStars: l.avgStars, reviewCount: l.reviewCount, responseRate: l.responseRate,
          topIssue: l.topIssue, issues: (l.issues || []).slice(0, 2),
        }))
      return NextResponse.json({
        summary: full.summary,
        worst,
        actions: (full.actions || []).slice(0, 12),
        buildings: (full.buildings || []).slice(0, 8),
      })
    }
    return NextResponse.json(full)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 200 })
  }
}
