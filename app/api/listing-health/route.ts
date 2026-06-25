// Per-listing Health / Ranking score.
// Reads the PERSISTED guesty_reviews table (kept fresh by the 15-min sync) instead of
// live-pulling Guesty on every request — so the page loads instantly and never depends
// on the Guesty token being warm. Joins reviews with guesty_listings (content
// completeness) and field_requests (operational load), then scores every unit 0-100.
// Factors still pending deeper Guesty integration (conversion, price-vs-comps, calendar
// openness, badges, host-cancellation rate) are surfaced as "dataPending".
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Guesty channels rate on different scales (Airbnb 1-5, Booking 1-10, some 1-100).
// Normalise everything to a 0-5 scale so ratings are comparable across listings.
function norm5(r: number | null): number | null {
  if (r == null || isNaN(r)) return null
  if (r > 10) return Math.max(0, Math.min(5, r / 20))   // 0-100
  if (r > 5) return Math.max(0, Math.min(5, r / 2))     // 0-10
  return Math.max(0, Math.min(5, r))                    // 0-5
}

// Recurring-issue themes — scanned only on lower-rated / negative reviews.
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

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const sb = supabaseAdmin()

    // Reviews come from the persisted table now — fast and Guesty-independent.
    // Listings + operational load loaded in parallel.
    const [{ data: revRows }, { data: listings }, { data: work }] = await Promise.all([
      sb.from('guesty_reviews')
        .select('listing_id, rating, content, has_reply, created_at')
        .limit(5000),
      sb.from('guesty_listings')
        .select('id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, address_city')
        .limit(2000),
      sb.from('field_requests').select('building, priority, status').in('status', ['open', 'in_progress']).limit(2000),
    ])

    type Rev = { listingId: string | null; rating: number | null; content: string; created_at: string | null; hasReply: boolean }
    const reviews: Rev[] = (revRows ?? []).map((r: any) => ({
      listingId: r.listing_id ?? null,
      rating: r.rating != null && r.rating !== '' ? Number(r.rating) : null,
      content: String(r.content || '').slice(0, 600),
      created_at: r.created_at ?? null,
      hasReply: !!r.has_reply,
    })).filter((x) => x.listingId)

    const openByBuilding: Record<string, number> = {}
    ;(work ?? []).forEach((w: any) => {
      const b = (w.building || '').trim()
      if (!b) return
      const weight = String(w.priority).toLowerCase() === 'high' || w.priority === 1 ? 2 : 1
      openByBuilding[b] = (openByBuilding[b] || 0) + weight
    })

    // Bucket reviews by listing.
    const byListing = new Map<string, Rev[]>()
    reviews.forEach((r) => {
      const arr = byListing.get(r.listingId!) || []
      arr.push(r)
      byListing.set(r.listingId!, arr)
    })

    const now = Date.now()
    const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
    const SKIP_BUILDINGS = ['waves'] // deactivated buildings

    const scored = (listings ?? [])
      .filter((l: any) => !DEAD.includes(String(l.status || '').toLowerCase()) && !SKIP_BUILDINGS.includes(String(l.building || '').trim().toLowerCase()))
      .map((l: any) => {
        const revs = byListing.get(l.id) || []

        // Recency-weighted normalised rating (weight halves every 12 months).
        let wSum = 0, wrSum = 0
        revs.forEach((r) => {
          const n = norm5(r.rating)
          if (n == null) return
          const ageMo = r.created_at ? (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30) : 12
          const w = Math.pow(0.5, Math.max(0, ageMo) / 12)
          wSum += w; wrSum += w * n
        })
        const ratedCount = revs.filter((r) => norm5(r.rating) != null).length
        const avg = wSum > 0 ? wrSum / wSum : null

        // Response rate.
        const replied = revs.filter((r) => r.hasReply).length
        const respRate = revs.length ? replied / revs.length : null

        // Recurring-issue scan on negative reviews.
        const themeHits: Record<string, number> = {}
        revs.forEach((r) => {
          const n = norm5(r.rating)
          const text = r.content.toLowerCase()
          if (!text) return
          const negative = (n != null && n <= 3.5)
          for (const [theme, kws] of Object.entries(THEMES)) {
            if (kws.some((k) => text.includes(k))) {
              if (negative) themeHits[theme] = (themeHits[theme] || 0) + 1
            }
          }
        })
        const recurring = Object.entries(themeHits).filter(([, c]) => c >= 2).map(([t]) => t)
        const singles = Object.entries(themeHits).filter(([, c]) => c === 1).map(([t]) => t)
        const topIssue = Object.entries(themeHits).sort((a, b) => b[1] - a[1])[0]?.[0] || null

        // ---- Subscores (only score where there's real data; no phantom credit) ----
        const hasReviews = revs.length > 0
        const reviewSub = (hasReviews && avg != null) ? Math.max(0, Math.min(1, (avg - 4.0) / 1.0)) * 40 : 0
        const volumeSub = hasReviews ? Math.min(1, revs.length / 20) * 15 : 0
        const respSub = (hasReviews && respRate != null) ? respRate * 15 : 0
        const penalty = Math.min(15, recurring.length * 5 + singles.length * 1.5)
        const glitchSub = hasReviews ? 15 - penalty : 0
        const amen = Array.isArray(l.amenities) ? l.amenities.length : 0
        const checks = [
          !!(l.title || l.nickname),
          amen >= 8,
          Number(l.bedrooms) > 0,
          Number(l.bathrooms) > 0,
          Number(l.max_occupancy) > 0,
          !!l.address_city,
          !!l.building,
        ]
        const contentSub = (checks.filter(Boolean).length / checks.length) * 10
        const openW = l.building ? (openByBuilding[(l.building || '').trim()] || 0) : 0
        const opsSub = Math.max(0, 5 - Math.min(5, openW))
        const score: number | null = hasReviews
          ? Math.round(reviewSub + volumeSub + respSub + glitchSub + contentSub + opsSub)
          : null

        // ---- Action plan (derived from this listing's own data) ----
        const actions: string[] = []
        recurring.forEach((th) => actions.push('Recurring "' + th + '" complaints - schedule a targeted fix and QA inspection.'))
        if (hasReviews && respRate != null && respRate < 0.8) actions.push('Reply faster - ' + replied + '/' + revs.length + ' reviews answered (' + Math.round(respRate * 100) + '%). Clear the backlog.')
        if (hasReviews && avg != null && avg < 4.6) actions.push('Rating ' + avg.toFixed(2) + '/5 is below the 4.6 target - address the top guest issues to lift it.')
        if (hasReviews && revs.length < 5) actions.push('Only ' + revs.length + ' review(s) - drive more stays and review requests to build OTA ranking.')
        if (contentSub < 8) actions.push('Complete the listing content (amenities, beds/baths, city) to improve OTA conversion.')
        if (openW > 0) actions.push('Close ' + openW + ' weighted open maintenance item(s) on this building.')
        if (!hasReviews) actions.push('No reviews yet - drive first stays and request reviews to start building OTA ranking.')

        return {
          id: l.id,
          name: l.nickname || l.title || l.id,
          building: l.building || null,
          unit: l.unit || null,
          score,
          band: !hasReviews ? 'neutral' : (score as number) >= 80 ? 'good' : (score as number) >= 60 ? 'watch' : 'risk',
          unrated: !hasReviews,
          actions,
          avgRating: avg != null ? Math.round(avg * 100) / 100 : null,
          reviewCount: revs.length,
          ratedCount,
          responseRate: respRate != null ? Math.round(respRate * 100) : null,
          recurring,
          topIssue,
          openWork: openW,
          breakdown: {
            review: Math.round(reviewSub),
            volume: Math.round(volumeSub),
            response: Math.round(respSub),
            glitch: Math.round(glitchSub),
            content: Math.round(contentSub),
            ops: Math.round(opsSub),
          },
        }
      })
      .sort((a, b) => (a.score == null ? 1 : 0) - (b.score == null ? 1 : 0) || (a.score ?? 0) - (b.score ?? 0))

    const withReviews = scored.filter((s) => s.reviewCount > 0)
    const summary = {
      listings: scored.length,
      avgScore: (() => { const rated = scored.filter((s) => s.score != null); return rated.length ? Math.round(rated.reduce((s, x) => s + (x.score as number), 0) / rated.length) : 0 })(),
      atRisk: scored.filter((s) => s.band === 'risk').length,
      watch: scored.filter((s) => s.band === 'watch').length,
      good: scored.filter((s) => s.band === 'good').length,
      neutral: scored.filter((s) => s.band === 'neutral').length,
      unrated: scored.filter((s) => s.unrated).length,
      avgResponse: withReviews.length ? Math.round(withReviews.reduce((s, x) => s + (x.responseRate || 0), 0) / withReviews.length) : null,
      reviewsAnalyzed: reviews.length,
      warming: false,
    }

    const dataPending = ['Conversion / CTR', 'Price vs. comps', 'Calendar openness', 'OTA badges', 'Host-cancellation rate']

    return NextResponse.json({ summary, listings: scored, dataPending })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 200 })
  }
}
