// Per-listing Health / Ranking score.
// Pulls the live Guesty review backlog (reusing the shared cached token), joins it
// with guesty_listings (content completeness) and field_requests (operational load),
// then scores every unit 0-100 on the signals we actually have data for today.
// Factors still pending deeper Guesty integration (conversion, price-vs-comps, calendar
// openness, badges, host-cancellation rate) are surfaced as "dataPending" so the model
// can grow into the full OTA-visibility weighting later.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

function pickArray(d: any): any[] {
  const dd = d?.data ?? d
  if (Array.isArray(dd)) return dd
  if (Array.isArray(dd?.reviews)) return dd.reviews
  if (Array.isArray(dd?.results)) return dd.results
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.reviews)) return d.reviews
  return []
}

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
    const { data: tok } = await sb
      .from('guesty_tokens')
      .select('access_token, expires_at')
      .eq('id', 'singleton')
      .maybeSingle()

    const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now())

    // Pull the live review backlog (skip-paginated). If the token is warming we still
    // return listing scores built on the non-review signals so the page is never empty.
    let raw: any[] = []
    if (valid) {
      const token = tok!.access_token
      for (let page = 0; page < 12; page++) {
        const r = await fetch(`${BASE}/reviews?limit=100&skip=${page * 100}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          cache: 'no-store',
        })
        if (!r.ok) break
        const batch = pickArray(await r.json())
        if (!batch.length) break
        raw = raw.concat(batch)
        if (batch.length < 100) break
      }
    }

    type Rev = { listingId: string | null; rating: number | null; content: string; created_at: string | null; hasReply: boolean }
    const reviews: Rev[] = raw.map((v: any) => {
      const rr = v.rawReview || v.raw || {}
      const rating =
        v.rating ?? v.overallRating ??
        rr.overall_rating ?? rr.overallRating ?? rr.rating ?? rr.score ?? rr.average_score ??
        v.publicReview?.rating ?? null
      const content =
        rr.public_review ?? rr.publicReview ?? rr.comments ?? rr.review ?? rr.text ??
        rr.positive ?? rr.review_text ?? rr.content ??
        v.publicReview?.text ?? v.content ?? v.text ?? v.comments ?? ''
      const reply =
        rr.host_response ?? rr.response ?? rr.owner_response ?? rr.reply ?? rr.private_feedback ??
        v.response ?? v.reply ?? v.hostResponse ?? v.ownerResponse ?? null
      const replies = v.reviewReplies ?? rr.reviewReplies ?? rr.review_replies ?? rr.replies ?? null
      const repliedViaArr = Array.isArray(replies) && replies.some((x: any) =>
        !x?.status || ['COMPLETED', 'PENDING', 'PUBLISHED', 'SENT', 'DONE'].includes(String(x.status).toUpperCase()))
      return {
        listingId: v.listingId ?? v.listing?._id ?? rr.listing_id ?? null,
        rating: typeof rating === 'number' ? rating : (rating != null && rating !== '' ? Number(rating) : null),
        content: String(typeof content === 'string' ? content : '').slice(0, 600),
        created_at: v.createdAt ?? rr.created_at ?? v.updatedAt ?? v.date ?? null,
        hasReply: repliedViaArr || !!(reply && String(reply).trim()),
      }
    }).filter((x) => x.listingId)

    // Listings + operational load.
    const [{ data: listings }, { data: work }] = await Promise.all([
      sb.from('guesty_listings')
        .select('id, title, nickname, building, unit, status, bedrooms, bathrooms, max_occupancy, amenities, address_city')
        .limit(2000),
      sb.from('field_requests').select('building, priority, status').in('status', ['open', 'in_progress']).limit(2000),
    ])

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

    const scored = (listings ?? [])
      .filter((l: any) => !DEAD.includes(String(l.status || '').toLowerCase()))
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

        // Recurring-issue scan on negative reviews (normalised rating <= 3.5, or no rating but negative words).
        const themeHits: Record<string, number> = {}
        revs.forEach((r) => {
          const n = norm5(r.rating)
          const text = r.content.toLowerCase()
          if (!text) return
          const negative = (n != null && n <= 3.5)
          for (const [theme, kws] of Object.entries(THEMES)) {
            if (kws.some((k) => text.includes(k))) {
              // Count strongly on low-rated reviews; ignore positive-only mentions.
              if (negative) themeHits[theme] = (themeHits[theme] || 0) + 1
            }
          }
        })
        const recurring = Object.entries(themeHits).filter(([, c]) => c >= 2).map(([t]) => t)
        const singles = Object.entries(themeHits).filter(([, c]) => c === 1).map(([t]) => t)
        const topIssue = Object.entries(themeHits).sort((a, b) => b[1] - a[1])[0]?.[0] || null

        // ---- Subscores ----
        // Review quality (35): 4.0 -> 0, 4.9 -> full. Unrated listings get a neutral 60%.
        const reviewSub = avg == null ? 35 * 0.6 : Math.max(0, Math.min(1, (avg - 4.0) / 0.9)) * 35
        // Response rate (20). Unrated/no-reviews neutral 60%.
        const respSub = respRate == null ? 20 * 0.6 : respRate * 20
        // Glitch freedom (20): start full, -5 per recurring theme, -1.5 per single mention.
        const penalty = Math.min(20, recurring.length * 5 + singles.length * 1.5)
        const glitchSub = 20 - penalty
        // Content completeness (15): 7 checks.
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
        const contentSub = (checks.filter(Boolean).length / checks.length) * 15
        // Operational load (10): inverse of weighted open work on the building.
        const openW = l.building ? (openByBuilding[(l.building || '').trim()] || 0) : 0
        const opsSub = Math.max(0, 10 - Math.min(10, openW * 2))

        const score = Math.round(reviewSub + respSub + glitchSub + contentSub + opsSub)

        return {
          id: l.id,
          name: l.nickname || l.title || l.id,
          building: l.building || null,
          unit: l.unit || null,
          score,
          band: score >= 80 ? 'good' : score >= 60 ? 'watch' : 'risk',
          avgRating: avg != null ? Math.round(avg * 100) / 100 : null,
          reviewCount: revs.length,
          ratedCount,
          responseRate: respRate != null ? Math.round(respRate * 100) : null,
          recurring,
          topIssue,
          openWork: openW,
          breakdown: {
            review: Math.round(reviewSub),
            response: Math.round(respSub),
            glitch: Math.round(glitchSub),
            content: Math.round(contentSub),
            ops: Math.round(opsSub),
          },
        }
      })
      .sort((a, b) => a.score - b.score) // worst first — the units that need attention

    const withReviews = scored.filter((s) => s.reviewCount > 0)
    const summary = {
      listings: scored.length,
      avgScore: scored.length ? Math.round(scored.reduce((s, x) => s + x.score, 0) / scored.length) : 0,
      atRisk: scored.filter((s) => s.band === 'risk').length,
      watch: scored.filter((s) => s.band === 'watch').length,
      good: scored.filter((s) => s.band === 'good').length,
      avgResponse: withReviews.length ? Math.round(withReviews.reduce((s, x) => s + (x.responseRate || 0), 0) / withReviews.length) : null,
      reviewsAnalyzed: reviews.length,
      warming: !valid,
    }

    const dataPending = ['Conversion / CTR', 'Price vs. comps', 'Calendar openness', 'OTA badges', 'Host-cancellation rate']

    return NextResponse.json({ summary, listings: scored, dataPending })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 200 })
  }
}
