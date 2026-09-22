// Portfolio — the single entry point for buildings AND units. Three views:
//   Buildings  — rolled-up Optimize Score, guest rating and open ops work per building (unchanged)
//   All units  — every unit, searchable/sortable/filterable, with occupancy, ADR and RevPAR
//   Fix next   — the score turned into a ranked worklist, deep-linked to the panel that fixes it
//   Health     — the weighted Health Score board (was its own /health tab until the September audit)
//   Bulk copy  — Other notes across whole properties (canEdit only; was a button above Buildings)
//
// "All units" and "Fix next" were added 2026-08-21. /listings was retired on 2026-08-11 and
// redirects here, which left no way to reach one of 233 units without first knowing its building —
// and no money anywhere on the page. Scores come from the shared lib/optimize-score; money comes
// from lib/unit-revenue, which uses the same conventions as the Revenue page and the Botanica report.
import { redirect } from 'next/navigation'
import { unitLabel, unitNumber } from '@/lib/unit-label'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { pageRows } from '@/lib/db-page'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess, canSeeMoney } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { computeScore, rollupBuilding, ratingToStars, scoreGaps, lastOptimizedOf } from '@/lib/optimize-score'
import { BuildingGrid } from '@/components/BuildingGrid'
import { BulkListingCopy } from '@/components/BulkListingCopy'
import { UnitTable, type UnitRow } from '@/components/UnitTable'
import { FixNext, type FixItem } from '@/components/FixNext'
import { HealthBoard } from '@/components/HealthBoard'
import { unitRevenue, REV_WINDOWS, windowFor, windowRange } from '@/lib/unit-revenue'
import { BASES, BASIS_SHORT, BASIS_NOTE, type Basis } from '@/lib/basis'
import { LeanHead, Pill, LeanEmpty } from '@/components/lean'
import { AlertTriangle } from 'lucide-react'

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

type View = 'buildings' | 'units' | 'fix' | 'health' | 'copy'
function viewFor(v?: string): View { return v === 'units' || v === 'fix' || v === 'health' || v === 'copy' ? v : 'buildings' }

// Heavy: pulls every listing's Guesty `raw` to compute scores. Cache the rollup across requests and
// recompute at most every 2 minutes so the portfolio page loads instantly instead of recomputing each hit.
const getPortfolioData = unstable_cache(async (periodDays: number | null) => {
  const sb = supabaseAdmin()
  // Start of the selected rating window. null = all time (no cutoff).
  const sinceIso = periodDays == null ? null : new Date(Date.now() - periodDays * 86400_000).toISOString()
  // SLIM raw: full `raw` for 285 listings is tens of MB — cold hits (every deploy resets the
  // cache) took 10s+ and the page looked dead. Pull only the sub-fields computeScore reads.
  const [{ data: listings }, { data: work }, revsPage] = await Promise.all([
    sb.from('guesty_listings')
      .select("id, title, nickname, building, unit, status, bedrooms, max_occupancy, address_city, amenities, pictures, last_optimized, pub:raw->publicDescription, pub2:raw->publicDescriptions, terms:raw->terms, integrations:raw->integrations, photoScore:raw->_photoScore, lastOptRaw:raw->>_lastOptimized, minN:raw->defaultListingMinNights, ib:raw->instantBookable, ib2:raw->instantBook, ci:raw->>defaultCheckInTime, ci2:raw->>checkInTime, co:raw->>defaultCheckOutTime, co2:raw->>checkOutTime, cancel:raw->>cancellationPolicy, prices:raw->prices, airbnbCancel:raw->airbnb->>cancellationPolicy, bookingCancel:raw->bookingcom->>cancellationPolicy")
      .limit(1000),
    sb.from('field_requests').select('building').in('status', ['open', 'in_progress']).limit(1000),
    // PAGED, and ORDERED. `.limit(20000)` returned 1,000 of 3,760 reviews — an arbitrary 27% sample
    // with no ordering at all, averaged into every building's star rating on this page. See
    // lib/db-page.ts. Ordering by id is what makes the page boundaries stable; without it PostgREST
    // repeats and skips rows across pages.
    pageRows((a, b) => sb.from('guesty_reviews').select('id, listing_id, rating, created_at, excluded_from_score').order('id').range(a, b), 20),
  ])
  const revs = revsPage.rows
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

    const title = String(l.title || l.nickname || 'Untitled unit')   // marketing title — scored below
    const opsName = unitLabel(l)                                      // what a human reads: "Arya 1704/1"
    const gaps = scoreGaps(res)
    const amenities: string[] = Array.isArray(l.amenities) ? l.amenities : []
    units.push({
      id, name: opsName, marketingTitle: title, building: name, unit: unitNumber(l), dead,
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
        fixes.push({ unitId: id, unitName: opsName, building: name, pillar: g.pillar, label: g.label, note: g.note, points: g.points, severity: g.severity })
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
  let view = viewFor(searchParams?.v)
  const revWin = windowFor(searchParams?.rev)
  const basis: Basis = (BASES as string[]).includes(String(searchParams?.b)) ? (searchParams!.b as Basis) : 'gross'

  const [{
    buildings, workByBuilding, totalUnits, portfolioAvg, units, fixes,
    portfolioRating, portfolioReviews, portfolioRatingP, portfolioReviewsP,
  }, access] = await Promise.all([getPortfolioData(period.days), getAccess()])

  // Bulk AI runs cost real money and write drafts — same gate as the optimizer itself.
  const canEdit = atLeast(access.levels['optimize'], 'edit')
  // The Health view keeps the `health` permission key it had as a page: anyone who could open
  // /health sees the tab here, anyone who could not is shown Buildings instead of a blank.
  const canHealth = atLeast(access.levels['health'], 'view')
  if (view === 'health' && !canHealth) view = 'buildings'
  if (view === 'copy' && !canEdit) view = 'buildings'

  let unitsWithMoney = units
  let revenueNote: string | null = null
  if (view === 'units') {
    const { from, to } = windowRange(revWin.days, new Date().toISOString().slice(0, 10))
    try {
      const rev = await getRevenue(from, to, basis)
      // ADR / RevPAR are dollar amounts: canSeeMoney only (2026-09-18 audit). Occupancy is a
      // percentage and stays. Stripped HERE, server-side, so the amounts never reach the browser.
      const showMoney = canSeeMoney(access)
      unitsWithMoney = units.map(u => {
        const r = rev[u.id]
        return r ? { ...u, occupancy: r.occupancy, adr: showMoney ? r.adr : null, revpar: showMoney ? r.revpar : null } : u
      })
      const covered = units.filter(u => rev[u.id]).length
      if (covered === 0) revenueNote = 'No reservations in this window — money columns are empty, not zero.'
    } catch {
      revenueNote = 'Revenue did not load — quality columns are fine, money columns are blank.'
    }
  }

  const buildingNames = Array.from(new Set(units.map(u => u.building))).sort((a, b) => a.localeCompare(b))

  // Tabs are LINKS, not client state: the Units view is the only one that pays for the revenue
  // read above, so the view has to be in the URL for the server to know.
  const hrefFor = (v: View) => {
    const qs = new URLSearchParams()
    if (v !== 'buildings') qs.set('v', v)
    if (period.key !== DEFAULT_PERIOD) qs.set('d', period.key)
    if (v === 'units') { if (revWin.key !== '90') qs.set('rev', revWin.key); if (basis !== 'gross') qs.set('b', basis) }
    return `/buildings${qs.toString() ? `?${qs}` : ''}`
  }
  const fixUnits = new Set(fixes.map(f => f.unitId)).size
  const TABS: { key: View; label: string; n?: number | null; title?: string }[] = [
    { key: 'buildings', label: 'Buildings', n: buildings.length },
    { key: 'units', label: 'Units', n: units.filter(u => !u.dead).length },
    { key: 'fix', label: 'Fix next', n: fixUnits, title: 'Units with an open Optimize Score gap' },
    ...(canHealth ? [{ key: 'health' as View, label: 'Health', title: 'Weighted Health Score per unit' }] : []),
    // Other notes is house boilerplate chosen by whole properties (Jon, 2026-09-16); Guest access,
    // Neighborhood and Getting around are edited on each property's own page.
    ...(canEdit ? [{ key: 'copy' as View, label: 'Bulk copy', title: 'Bulk edit Other notes across properties' }] : []),
  ]
  const seg = (on: boolean) => `px-2 py-1 rounded-lg text-[12px] font-semibold transition-colors ${on ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`

  return (
    <Shell>
      <LeanHead title="Properties">
        <Pill title={`${buildings.length} buildings · ${totalUnits} units`}>{totalUnits} units</Pill>
        {portfolioAvg != null && <Pill tone="brand" title="Portfolio Optimize Score: average of every active unit (all time)">Score {portfolioAvg}</Pill>}
        {portfolioRating != null && <Pill tone="amber" title={`Guest rating, all time · ${portfolioReviews} reviews`}>{portfolioRating.toFixed(2)}★ all</Pill>}
        <Pill tone={portfolioRatingP != null ? 'amber' : 'slate'} title={portfolioRatingP != null ? `Guest rating over ${period.label.toLowerCase()} · ${portfolioReviewsP} reviews` : `No reviews in ${period.label.toLowerCase()}`}>
          {portfolioRatingP != null ? `${portfolioRatingP.toFixed(2)}★` : '—'} {period.key === 'all' ? 'all' : period.key === '365' ? '12m' : period.key + 'd'}
        </Pill>
        {/* Rating window. Only the guest rating follows this — Optimize Score is all-time. */}
        <nav className="inline-flex rounded-xl border border-line bg-white p-0.5" aria-label="Rating period">
          {PERIODS.map(p => {
            const on = p.key === period.key
            const qs = new URLSearchParams()
            if (p.key !== DEFAULT_PERIOD) qs.set('d', p.key)
            if (view !== 'buildings') qs.set('v', view)
            if (revWin.key !== '90') qs.set('rev', revWin.key)
            if (basis !== 'gross') qs.set('b', basis)
            return (
              <Link key={p.key} href={`/buildings${qs.toString() ? `?${qs}` : ''}`} prefetch={false}
                aria-current={on ? 'page' : undefined} title={`Rating over ${p.label.toLowerCase()} (Optimize Score is always all-time)`} className={seg(on)}>
                {p.key === 'all' ? 'All' : p.key === '365' ? '12m' : p.key + 'd'}
              </Link>
            )
          })}
        </nav>
      </LeanHead>

      <div className="lh-actions flex items-center gap-2 flex-wrap mb-3">
        <nav className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px] max-w-full overflow-x-auto" aria-label="Portfolio view">
          {TABS.map(t => {
            const on = t.key === view
            return (
              <Link key={t.key} href={hrefFor(t.key)} prefetch={false} title={t.title}
                aria-current={on ? 'page' : undefined}
                className={`px-2.5 sm:px-3 py-1.5 font-semibold border-l border-line first:border-l-0 whitespace-nowrap ${on ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
                {t.label}{t.n ? <span className="ml-1 opacity-70 tabular-nums">{t.n}</span> : null}
              </Link>
            )
          })}
        </nav>

        {view === 'units' && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <nav className="inline-flex rounded-xl border border-line bg-white p-0.5" aria-label="Revenue window">
              {REV_WINDOWS.map(w => {
                const qs = new URLSearchParams({ v: 'units' })
                if (period.key !== DEFAULT_PERIOD) qs.set('d', period.key)
                if (w.key !== '90') qs.set('rev', w.key)
                if (basis !== 'gross') qs.set('b', basis)
                return <Link key={w.key} href={`/buildings?${qs}`} prefetch={false} title="Window for occupancy, ADR and RevPAR" className={seg(w.key === revWin.key)}>{w.label}</Link>
              })}
            </nav>
            <nav className="inline-flex rounded-xl border border-line bg-white p-0.5" aria-label="Revenue basis">
              {BASES.map(bk => {
                const qs = new URLSearchParams({ v: 'units' })
                if (period.key !== DEFAULT_PERIOD) qs.set('d', period.key)
                if (revWin.key !== '90') qs.set('rev', revWin.key)
                if (bk !== 'gross') qs.set('b', bk)
                return <Link key={bk} href={`/buildings?${qs}`} prefetch={false} title={BASIS_NOTE[bk]} className={seg(bk === basis)}>{BASIS_SHORT[bk]}</Link>
              })}
            </nav>
          </div>
        )}
      </div>

      {revenueNote && (
        <p className="mb-3 text-[12px] text-amber-800 flex items-center gap-1.5"><AlertTriangle size={12} className="shrink-0" /> {revenueNote}</p>
      )}

      {view === 'copy' && <BulkListingCopy scope="portfolio" defaultOpen />}

      {view === 'buildings' && (
        buildings.length === 0
          ? <LeanEmpty>No listings synced yet.</LeanEmpty>
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
          showMoney={canSeeMoney(access)}
        />
      )}

      {view === 'fix' && <FixNext items={fixes} buildings={buildingNames} />}

      {view === 'health' && <HealthBoard />}
    </Shell>
  )
}
