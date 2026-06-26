// Portfolio Health - the v2 master model. Per listing: master health (review/ops health +
// optimize score), per-OTA breakdown, and ranked actionable issues. Rolls up to buildings
// (0.70*mean + 0.30*worst-quartile). Excludes orphaned (unmapped) reviews from scoring.
// Reads persisted tables (fast, Guesty-independent). Logged-in users only.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeListingHealth, rollupBuildingHealth, type HealthReview } from '@/lib/health-score'
import { rollupBuilding } from '@/lib/optimize-score'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const SKIP_BUILDINGS = ['waves']

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
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

    const [revRows, { data: listings }, { data: work }] = await Promise.all([
      fetchAllReviews(),
      sb.from('guesty_listings')
        .select('id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, pictures, address_city, raw')
        .limit(2000),
      sb.from('field_requests').select('building, priority, status').in('status', ['open', 'in_progress']).limit(2000),
    ])

    // Open ops weight per rolled-up building.
    const openByBuilding: Record<string, number> = {}
    ;(work ?? []).forEach((w: any) => {
      const b = rollupBuilding(w.building)
      if (!b || b === 'Unassigned') return
      const weight = String(w.priority).toLowerCase() === 'high' || w.priority === 1 ? 2 : 1
      openByBuilding[b] = (openByBuilding[b] || 0) + weight
    })

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

    const scored = active.map((l: any) => {
      const building = rollupBuilding(l.building)
      const reviews = byListing.get(l.id) || []
      const h = computeListingHealth(l, reviews, { openWork: openByBuilding[building] || 0 })
      return {
        id: l.id,
        name: l.title || l.nickname || l.id,
        building: building !== 'Unassigned' ? building : null,
        unit: l.unit || null,
        score: h.score,
        band: h.band,
        unrated: h.unrated,
        optimizeScore: h.optimizeScore,
        avgStars: h.review.avgStars,
        reviewCount: h.review.count,
        responseRate: h.review.responseRate,
        recurring: h.review.recurring,
        topIssue: h.review.topIssue,
        breakdown: h.breakdown,
        channels: h.channels.map(c => ({ label: c.label, score: c.score, band: c.band, avgStars: c.avgStars, reviewCount: c.reviewCount, responseRate: c.responseRate, badge: c.badge })),
        issues: h.issues.map(i => ({ severity: i.severity, title: i.title, action: i.action, owner: i.owner })),
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

    const rated = scored.filter((s: any) => !s.unrated)
    const withReviews = scored.filter((s: any) => s.reviewCount > 0)
    const count = (b: string) => scored.filter((s: any) => s.band === b).length
    const summary = {
      listings: scored.length,
      avgScore: rated.length ? Math.round(rated.reduce((s: number, x: any) => s + x.score, 0) / rated.length) : 0,
      elite: count('elite'), healthy: count('healthy'), watch: count('watch'), atRisk: count('risk'), critical: count('critical'), neutral: count('neutral'),
      avgResponse: withReviews.length ? Math.round(withReviews.reduce((s: number, x: any) => s + (x.responseRate || 0), 0) / withReviews.length) : null,
      reviewsAnalyzed: (revRows ?? []).length,
      openActions: scored.reduce((s: number, x: any) => s + x.issues.length, 0),
    }

    const dataPending = ['Conversion / CTR', 'Price vs. comps', 'Calendar openness', 'Live badge status', 'Acceptance & host-cancellation rate']
    return NextResponse.json({ summary, listings: scored, buildings, dataPending })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 200 })
  }
}
