// Portfolio — the single entry point for buildings + units. Each building card shows a
// rolled-up Optimize Score (mean of its units), how many units need work, and open ops
// work. Click a building to drill into every unit with its own score. Scores come from
// the shared lib/optimize-score (research-backed, computed from Guesty data).
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { computeScore, rollupBuilding, ratingToStars } from '@/lib/optimize-score'
import { BuildingGrid } from '@/components/BuildingGrid'
import { Building2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

// Guest-rating windows for the "rating in the period selected" column (Jon 2026-08-06).
// `days: null` = all time. Kept to a few presets on purpose: each one is its own cache entry.
const PERIODS = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: null as number | null },
]
const DEFAULT_PERIOD = '90'
function periodFor(v?: string) { return PERIODS.find(p => p.key === v) || PERIODS.find(p => p.key === DEFAULT_PERIOD)! }

// Heavy: pulls every listing's Guesty `raw` to compute scores. Cache the rollup across requests and
// recompute at most every 2 minutes so the portfolio page loads instantly instead of recomputing each hit.
const getPortfolioData = unstable_cache(async (periodDays: number | null) => {
  const sb = supabaseAdmin()
  // Start of the selected rating window. null = all time (no cutoff).
  const sinceIso = periodDays == null ? null : new Date(Date.now() - periodDays * 86400_000).toISOString()
  // SLIM raw: full `raw` for 285 listings is tens of MB — cold hits (every deploy resets the
  // cache) took 10s+ and the page looked dead. Pull only the sub-fields computeScore reads.
  const [{ data: listings }, { data: work }, { data: revs }] = await Promise.all([
    sb.from('guesty_listings')
      .select("id, title, nickname, building, unit, status, bedrooms, max_occupancy, address_city, amenities, pictures, pub:raw->publicDescription, pub2:raw->publicDescriptions, terms:raw->terms, integrations:raw->integrations, photoScore:raw->_photoScore, minN:raw->defaultListingMinNights, ib:raw->instantBookable, ib2:raw->instantBook, ci:raw->>defaultCheckInTime, ci2:raw->>checkInTime, co:raw->>defaultCheckOutTime, co2:raw->>checkOutTime, cancel:raw->>cancellationPolicy, prices:raw->prices, airbnbCancel:raw->airbnb->>cancellationPolicy, bookingCancel:raw->bookingcom->>cancellationPolicy")
      .limit(1000),
    sb.from('field_requests').select('building').in('status', ['open', 'in_progress']).limit(1000),
    sb.from('guesty_reviews').select('listing_id, rating, created_at, excluded_from_score').limit(20000),
  ])
  // Rebuild the slim raw object computeScore expects.
  const slimRaw = (l: any) => ({
    publicDescription: l.pub, publicDescriptions: l.pub2, terms: l.terms, integrations: l.integrations,
    _photoScore: l.photoScore, defaultListingMinNights: l.minN, instantBookable: l.ib, instantBook: l.ib2,
    defaultCheckInTime: l.ci, checkInTime: l.ci2, defaultCheckOutTime: l.co, checkOutTime: l.co2,
    cancellationPolicy: l.cancel, prices: l.prices,
    airbnb: { cancellationPolicy: l.airbnbCancel }, bookingcom: { cancellationPolicy: l.bookingCancel },
  })

  const _cnt: Record<string, number> = {}
  const _sum: Record<string, number> = {}
  // Same, but only reviews inside the selected window — drives the period rating on each card.
  const _cntP: Record<string, number> = {}
  const _sumP: Record<string, number> = {}
  // Normalize every rating to 0-5 stars before averaging - a Booking 9/10 must not average in as 9.
  ;(revs ?? []).forEach((r: any) => {
    if (r.excluded_from_score) return
    const st = ratingToStars(r.rating); if (st == null) return
    const id = String(r.listing_id)
    _sum[id] = (_sum[id] || 0) + st; _cnt[id] = (_cnt[id] || 0) + 1
    // A review with no created_at can't be placed in a window — it still counts all-time.
    if (sinceIso && (!r.created_at || String(r.created_at) < sinceIso)) return
    _sumP[id] = (_sumP[id] || 0) + st; _cntP[id] = (_cntP[id] || 0) + 1
  })
  const _sib: Record<string, string[]> = {}
  ;(listings ?? []).forEach((l: any) => { const bb = rollupBuilding(l.building); if (!bb) return; const arr = _sib[bb] || (_sib[bb] = []); const am = Array.isArray(l.amenities) ? l.amenities : []; for (const a of am) if (!arr.includes(a)) arr.push(a) })
  const workByBuilding: Record<string, number> = {}
  ;(work ?? []).forEach((w: any) => {
    const b = rollupBuilding(w.building)
    if (b && b !== 'Unassigned') workByBuilding[b] = (workByBuilding[b] || 0) + 1
  })

  type B = {
    name: string; city?: string; unitCount: number; beds: number; sleeps: number; active: number; scores: number[]
    rSum: number; rCnt: number; rSumP: number; rCntP: number
  }
  const map = new Map<string, B>()
  ;(listings ?? []).forEach((l: any) => {
    const name = rollupBuilding(l.building)
    if (!map.has(name)) map.set(name, { name, city: l.address_city || undefined, unitCount: 0, beds: 0, sleeps: 0, active: 0, scores: [], rSum: 0, rCnt: 0, rSumP: 0, rCntP: 0 })
    const b = map.get(name)!
    b.unitCount += 1
    b.beds += Number(l.bedrooms) || 0
    b.sleeps += Number(l.max_occupancy) || 0
    const dead = DEAD.includes(String(l.status || '').toLowerCase())
    if (!dead) {
      b.active += 1
      const isBeach = /beach/i.test(String(l.address_city || ''))
      b.scores.push(computeScore({ ...l, raw: slimRaw(l) }, { isBeach, siblingAmenities: _sib[rollupBuilding(l.building)] || [], avgRating: _cnt[String(l.id)] ? Math.round((_sum[String(l.id)] / _cnt[String(l.id)]) * 100) / 100 : null, reviewCount: _cnt[String(l.id)] || 0 }).overall)
      // Roll ratings up by REVIEW, not by unit: sum stars / total reviews. Averaging each unit's
      // average would let a 1-review unit swing the building as hard as a 200-review one.
      // Active units only, so the card's rating and score describe the same set of units.
      const id = String(l.id)
      b.rSum += _sum[id] || 0; b.rCnt += _cnt[id] || 0
      b.rSumP += _sumP[id] || 0; b.rCntP += _cntP[id] || 0
    }
    if (!b.city && l.address_city) b.city = l.address_city
  })

  const allScores: number[] = []
  let pSum = 0, pCnt = 0, pSumP = 0, pCntP = 0
  const star = (sum: number, cnt: number) => (cnt ? Math.round((sum / cnt) * 100) / 100 : null)
  const buildings = Array.from(map.values()).map(b => {
    allScores.push(...b.scores)
    pSum += b.rSum; pCnt += b.rCnt; pSumP += b.rSumP; pCntP += b.rCntP
    const avg = b.scores.length ? Math.round(b.scores.reduce((s, n) => s + n, 0) / b.scores.length) : null
    const weak = b.scores.filter(s => s < 60).length
    const { scores, rSum, rCnt, rSumP, rCntP, ...rest } = b
    return {
      ...rest, avg, weak,
      rating: star(rSum, rCnt), reviewCount: rCnt,           // all time
      ratingP: star(rSumP, rCntP), reviewCountP: rCntP,      // selected window
    }
  }).sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999)) // weakest portfolios first

  const totalUnits = (listings ?? []).length
  const portfolioAvg = allScores.length ? Math.round(allScores.reduce((s, n) => s + n, 0) / allScores.length) : null
  return {
    buildings, workByBuilding, totalUnits, portfolioAvg,
    portfolioRating: star(pSum, pCnt), portfolioReviews: pCnt,
    portfolioRatingP: star(pSumP, pCntP), portfolioReviewsP: pCntP,
  }
  // NOTE: the cache key must vary by period, or every window would serve whichever one warmed
  // the cache first. unstable_cache hashes the callback's ARGUMENTS into the key on top of these
  // keyParts, so passing periodDays in is what keeps the four windows separate. Bumped to v2
  // because the cached shape changed (rating fields added).
}, ['portfolio-rollup-v2'], { revalidate: 120 })

export default async function PortfolioPage({ searchParams }: { searchParams?: { d?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const period = periodFor(searchParams?.d)
  const {
    buildings, workByBuilding, totalUnits, portfolioAvg,
    portfolioRating, portfolioReviews, portfolioRatingP, portfolioReviewsP,
  } = await getPortfolioData(period.days)

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> Portfolio</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Properties</h1>
          <p className="text-sm text-muted mt-1">
            {buildings.length} buildings · {totalUnits} units
            {portfolioAvg != null && <> · portfolio Optimize Score <b className="text-ink">{portfolioAvg}</b></>}
            {portfolioRating != null && (
              <> · guest rating <b className="text-ink">{portfolioRating.toFixed(2)}★</b> all time
                {portfolioRatingP != null
                  ? <> · <b className="text-ink">{portfolioRatingP.toFixed(2)}★</b> in {period.label.toLowerCase()} ({portfolioReviewsP})</>
                  : <> · no reviews in {period.label.toLowerCase()}</>}
              </>
            )}
          </p>
        </div>

        {/* Rating window. Only the period rating follows this — Optimize Score is all-time. */}
        <nav className="inline-flex rounded-xl border border-line bg-white p-0.5 shrink-0" aria-label="Rating period">
          {PERIODS.map(p => {
            const on = p.key === period.key
            return (
              <Link key={p.key} href={p.key === DEFAULT_PERIOD ? '/buildings' : `/buildings?d=${p.key}`} prefetch={false}
                aria-current={on ? 'page' : undefined}
                className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${on ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                {p.label}
              </Link>
            )
          })}
        </nav>
      </header>

      {buildings.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No listings synced yet.</div>
      ) : (
        <BuildingGrid buildings={buildings} workByBuilding={workByBuilding} periodLabel={period.label} />
      )}
    </Shell>
  )
}
