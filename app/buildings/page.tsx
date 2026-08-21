// Portfolio — the single entry point for buildings AND units. Three views:
//   Buildings  — rolled-up Optimize Score, guest rating and open ops work per building (unchanged)
//   All units  — every unit, searchable/sortable/filterable, with occupancy, ADR and RevPAR
//   Fix next   — the score turned into a ranked worklist, deep-linked to the panel that fixes it
//
// "All units" and "Fix next" were added 2026-08-21. /listings was retired on 2026-08-11 and
// redirects here, which left no way to reach one of 233 units without first knowing its building —
// and no money anywhere on the page. Scores come from the shared lib/optimize-score; money comes
// from lib/unit-revenue, which uses the same conventions as the Revenue page and the Botanica report.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { computeScore, rollupBuilding, ratingToStars, scoreGaps, lastOptimizedOf } from '@/lib/optimize-score'
import { BuildingGrid } from '@/components/BuildingGrid'
import { UnitTable, type UnitRow } from '@/components/UnitTable'
import { FixNext, type FixItem } from '@/components/FixNext'
import { unitRevenue, REV_WINDOWS, windowFor, windowRange } from '@/lib/unit-revenue'
import { BASES, BASIS_SHORT, BASIS_NOTE, type Basis } from '@/lib/basis'
import { Building2, Rows3, Wrench } from 'lucide-react'

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

type View = 'buildings' | 'units' | 'fix'
function viewFor(v?: string): View { return v === 'units' || v === 'fix' ? v : 'buildings' }

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
      .select("id, title, nickname, building, unit, status, bedrooms, max_occupancy, address_city, amenities, pictures, last_optimized, pub:raw->publicDescription, pub2:raw->publicDescriptions, terms:raw->terms, integrations:raw->integrations, photoScore:raw->_photoScore, lastOptRaw:raw->>_lastOptimized, minN:raw->defaultListingMinNights, ib:raw->instantBookable, ib2:raw->instantBook, ci:raw->>defaultCheckInTime, ci2:raw->>checkInTime, co:raw->>defaultCheckOutTime, co2:raw->>checkOutTime, cancel:raw->>cancellationPolicy, prices:raw->prices, airbnbCancel:raw->airbnb->>cancellationPolicy, bookingCancel:raw->bookingcom->>cancellationPolicy")
      .limit(1000),
    sb.from('field_requests').select('building').in('status', ['open', 'in_progress']).limit(1000),
    sb.from('guesty_reviews').select('listing_id, rating, created_at, excluded_from_score').limit(20000),
  ])
  // Rebuild the slim raw object computeScore expects.
  const slimRaw = (l: any) => ({
    publicDescription: l.pub, publicDescriptions: l.pub2, terms: l.terms, integrations: l.integrations,
    _photoScore: l.photoScore, _lastOptimized: l.lastOptRaw, defaultListingMinNights: l.minN, instantBookable: l.ib, instantBook: l.ib2,
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
  const units: UnitRow[] = []
  const fixes: FixItem[] = []

  ;(listings ?? []).forEach((l: any) => {
    const name = rollupBuilding(l.building)
    if (!map.has(name)) map.set(name, { name, city: l.address_city || undefined, unitCount: 0, beds: 0, sleeps: 0, active: 0, scores: [], rSum: 0, rCnt: 0, rSumP: 0, rCntP: 0 })
    const b = map.get(name)!
    b.unitCount += 1
    b.beds += Number(l.bedrooms) || 0
    b.sleeps += Number(l.max_occupancy) || 0
    const dead = DEAD.includes(String(l.status || '').toLowerCase())
    const id = String(l.id)
    const isBeach = /beach/i.test(String(l.address_city || ''))
    const listingForScore = { ...l, raw: slimRaw(l) }
    const res = computeScore(listingForScore, {
      isBeach,
      siblingAmenities: _sib[name] || [],
      avgRating: _cnt[id] ? Math.round((_sum[id] / _cnt[id]) * 100) / 100 : null,
      reviewCount: _cnt[id] || 0,
    })
    if (!dead) {
      b.active += 1
      b.scores.push(res.overall)
      // Roll ratings up by REVIEW, not by unit: sum stars / total reviews. Averaging each unit's
      // average would let a 1-review unit swing the building as hard as a 200-review one.
      // Active units only, so the card's rating and score describe the same set of units.
      b.rSum += _sum[id] || 0; b.rCnt += _cnt[id] || 0
      b.rSumP += _sumP[id] || 0; b.rCntP += _cntP[id] || 0
    }
    if (!b.city && l.address_city) b.city = l.address_city

    const title = String(l.title || l.nickname || 'Untitled unit')
    const gaps = scoreGaps(res)
    const amenities: string[] = Array.isArray(l.amenities) ? l.amenities : []
    units.push({
      id, name: title, building: name, unit: l.unit || null, dead,
      score: res.overall,
      titleLen: title.length,
      sections: res.description.sections.length,
      photos: res.photos.count,
      photoQuality: res.photos.aiQuality,
      amenities: amenities.length,
      mustFix: res.amenities.mustFix.length,
      rating: _cntP[id] ? Math.round((_sumP[id] / _cntP[id]) * 100) / 100 : null,
      reviews: _cntP[id] || 0,
      occupancy: null, adr: null, revpar: null,   // filled in from lib/unit-revenue at render
      lastOptimized: lastOptimizedOf(listingForScore).at,
      instantBook: res.settings.meta.instantRaw == null ? null : !!res.settings.meta.instant,
      topGap: gaps.length ? { label: gaps[0].label, points: gaps[0].points } : null,
    })
    if (!dead) {
      for (const g of gaps) {
        // A sub-0.5-point gap is noise on a worklist meant to be worked through in order.
        if (g.points < 0.5) continue
        fixes.push({ unitId: id, unitName: title, building: name, pillar: g.pillar, label: g.label, note: g.note, points: g.points, severity: g.severity })
      }
    }
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
    buildings, workByBuilding, totalUnits, portfolioAvg, units, fixes,
    portfolioRating: star(pSum, pCnt), portfolioReviews: pCnt,
    portfolioRatingP: star(pSumP, pCntP), portfolioReviewsP: pCntP,
  }
  // NOTE: the cache key must vary by period, or every window would serve whichever one warmed
  // the cache first. unstable_cache hashes the callback's ARGUMENTS into the key on top of these
  // keyParts, so passing periodDays in is what keeps the four windows separate. Bumped to v3
  // because the cached shape changed (units + fixes added).
}, ['portfolio-rollup-v3'], { revalidate: 120 })

// Money is a separate, heavier read (every live reservation in the window) so it gets its own,
// longer cache and only runs for the views that show it.
const getRevenue = unstable_cache(
  async (from: string, to: string, basis: Basis) => unitRevenue(from, to, basis),
  ['portfolio-revenue-v1'], { revalidate: 300 },
)

export default async function PortfolioPage({ searchParams }: { searchParams?: { d?: string; v?: string; rev?: string; b?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const period = periodFor(searchParams?.d)
  const view = viewFor(searchParams?.v)
  const revWin = windowFor(searchParams?.rev)
  const basis: Basis = (BASES as string[]).includes(String(searchParams?.b)) ? (searchParams!.b as Basis) : 'gross'

  const [{
    buildings, workByBuilding, totalUnits, portfolioAvg, units, fixes,
    portfolioRating, portfolioReviews, portfolioRatingP, portfolioReviewsP,
  }, access] = await Promise.all([getPortfolioData(period.days), getAccess()])

  // Bulk AI runs cost real money and write drafts — same gate as the optimizer itself.
  const canEdit = atLeast(access.levels['optimize'], 'edit')

  let unitsWithMoney = units
  let revenueNote: string | null = null
  if (view === 'units') {
    const { from, to } = windowRange(revWin.days, new Date().toISOString().slice(0, 10))
    try {
      const rev = await getRevenue(from, to, basis)
      unitsWithMoney = units.map(u => {
        const r = rev[u.id]
        return r ? { ...u, occupancy: r.occupancy, adr: r.adr, revpar: r.revpar } : u
      })
      const covered = units.filter(u => rev[u.id]).length
      if (covered === 0) revenueNote = 'No reservations found in this window — the occupancy, ADR and RevPAR columns are empty, not zero.'
    } catch {
      revenueNote = 'Could not load revenue for this window. Quality columns are still accurate; the money columns are blank.'
    }
  }

  const buildingNames = Array.from(new Set(units.map(u => u.building))).sort((a, b) => a.localeCompare(b))

  const TABS: { key: View; label: string; Icon: any; href: string }[] = [
    { key: 'buildings', label: 'Buildings', Icon: Building2, href: '/buildings' },
    { key: 'units', label: 'All units', Icon: Rows3, href: '/buildings?v=units' },
    { key: 'fix', label: 'Fix next', Icon: Wrench, href: '/buildings?v=fix' },
  ]

  return (
    <Shell>
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
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

        {/* Rating window. Only the guest rating follows this — Optimize Score is all-time. */}
        <nav className="inline-flex rounded-xl border border-line bg-white p-0.5 shrink-0" aria-label="Rating period">
          {PERIODS.map(p => {
            const on = p.key === period.key
            const qs = new URLSearchParams()
            if (p.key !== DEFAULT_PERIOD) qs.set('d', p.key)
            if (view !== 'buildings') qs.set('v', view)
            if (revWin.key !== '90') qs.set('rev', revWin.key)
            if (basis !== 'gross') qs.set('b', basis)
            return (
              <Link key={p.key} href={`/buildings${qs.toString() ? `?${qs}` : ''}`} prefetch={false}
                aria-current={on ? 'page' : undefined}
                className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${on ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                {p.label}
              </Link>
            )
          })}
        </nav>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <nav className="inline-flex rounded-xl border border-line bg-white p-1" aria-label="Portfolio view">
          {TABS.map(t => {
            const qs = new URLSearchParams()
            if (t.key !== 'buildings') qs.set('v', t.key)
            if (period.key !== DEFAULT_PERIOD) qs.set('d', period.key)
            if (t.key === 'units') { if (revWin.key !== '90') qs.set('rev', revWin.key); if (basis !== 'gross') qs.set('b', basis) }
            const on = t.key === view
            return (
              <Link key={t.key} href={`/buildings${qs.toString() ? `?${qs}` : ''}`} prefetch={false}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                <t.Icon size={14} /> {t.label}
              </Link>
            )
          })}
        </nav>

        {view === 'units' && (
          <>
            <nav className="inline-flex rounded-xl border border-line bg-white p-0.5" aria-label="Revenue window">
              {REV_WINDOWS.map(w => {
                const qs = new URLSearchParams({ v: 'units' })
                if (period.key !== DEFAULT_PERIOD) qs.set('d', period.key)
                if (w.key !== '90') qs.set('rev', w.key)
                if (basis !== 'gross') qs.set('b', basis)
                const on = w.key === revWin.key
                return (
                  <Link key={w.key} href={`/buildings?${qs}`} prefetch={false}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${on ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                    {w.label}
                  </Link>
                )
              })}
            </nav>
            <nav className="inline-flex rounded-xl border border-line bg-white p-0.5" aria-label="Revenue basis">
              {BASES.map(bk => {
                const qs = new URLSearchParams({ v: 'units' })
                if (period.key !== DEFAULT_PERIOD) qs.set('d', period.key)
                if (revWin.key !== '90') qs.set('rev', revWin.key)
                if (bk !== 'gross') qs.set('b', bk)
                const on = bk === basis
                return (
                  <Link key={bk} href={`/buildings?${qs}`} prefetch={false} title={BASIS_NOTE[bk]}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${on ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                    {BASIS_SHORT[bk]}
                  </Link>
                )
              })}
            </nav>
          </>
        )}
      </div>

      {revenueNote && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">{revenueNote}</div>
      )}

      {view === 'buildings' && (
        buildings.length === 0
          ? <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No listings synced yet.</div>
          : <BuildingGrid buildings={buildings} workByBuilding={workByBuilding} periodLabel={period.label} />
      )}

      {view === 'units' && (
        <UnitTable
          units={unitsWithMoney}
          buildings={buildingNames}
          periodLabel={period.label.toLowerCase()}
          revLabel={revWin.label.toLowerCase()}
          basisLabel={BASIS_SHORT[basis]}
          canEdit={canEdit}
        />
      )}

      {view === 'fix' && <FixNext items={fixes} buildings={buildingNames} />}
    </Shell>
  )
}
