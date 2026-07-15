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
import { computeScore, rollupBuilding, buildingSlug, band, bandUi } from '@/lib/optimize-score'
import { Building2, BedDouble, Users, Wrench, MapPin, ArrowRight, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

// Heavy: pulls every listing's Guesty `raw` to compute scores. Cache the rollup across requests and
// recompute at most every 2 minutes so the portfolio page loads instantly instead of recomputing each hit.
const getPortfolioData = unstable_cache(async () => {
  const sb = supabaseAdmin()
  // SLIM raw: full `raw` for 285 listings is tens of MB — cold hits (every deploy resets the
  // cache) took 10s+ and the page looked dead. Pull only the sub-fields computeScore reads.
  const [{ data: listings }, { data: work }, { data: revs }] = await Promise.all([
    sb.from('guesty_listings')
      .select("id, title, nickname, building, unit, status, bedrooms, max_occupancy, address_city, amenities, pictures, pub:raw->publicDescription, pub2:raw->publicDescriptions, terms:raw->terms, integrations:raw->integrations, photoScore:raw->_photoScore, minN:raw->defaultListingMinNights, ib:raw->instantBookable, ib2:raw->instantBook, ci:raw->>defaultCheckInTime, ci2:raw->>checkInTime, co:raw->>defaultCheckOutTime, co2:raw->>checkOutTime, cancel:raw->>cancellationPolicy, prices:raw->prices, airbnbCancel:raw->airbnb->>cancellationPolicy, bookingCancel:raw->bookingcom->>cancellationPolicy")
      .limit(1000),
    sb.from('field_requests').select('building').in('status', ['open', 'in_progress']).limit(1000),
    sb.from('guesty_reviews').select('listing_id, rating, excluded_from_score').limit(20000),
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
  ;(revs ?? []).forEach((r: any) => { if (r.excluded_from_score) return; if (r.rating == null) return; const id = String(r.listing_id); _sum[id] = (_sum[id] || 0) + Number(r.rating); _cnt[id] = (_cnt[id] || 0) + 1 })
  const _sib: Record<string, string[]> = {}
  ;(listings ?? []).forEach((l: any) => { const bb = rollupBuilding(l.building); if (!bb) return; const arr = _sib[bb] || (_sib[bb] = []); const am = Array.isArray(l.amenities) ? l.amenities : []; for (const a of am) if (!arr.includes(a)) arr.push(a) })
  const workByBuilding: Record<string, number> = {}
  ;(work ?? []).forEach((w: any) => {
    const b = rollupBuilding(w.building)
    if (b && b !== 'Unassigned') workByBuilding[b] = (workByBuilding[b] || 0) + 1
  })

  type B = { name: string; city?: string; unitCount: number; beds: number; sleeps: number; active: number; scores: number[] }
  const map = new Map<string, B>()
  ;(listings ?? []).forEach((l: any) => {
    const name = rollupBuilding(l.building)
    if (!map.has(name)) map.set(name, { name, city: l.address_city || undefined, unitCount: 0, beds: 0, sleeps: 0, active: 0, scores: [] })
    const b = map.get(name)!
    b.unitCount += 1
    b.beds += Number(l.bedrooms) || 0
    b.sleeps += Number(l.max_occupancy) || 0
    const dead = DEAD.includes(String(l.status || '').toLowerCase())
    if (!dead) {
      b.active += 1
      const isBeach = /beach/i.test(String(l.address_city || ''))
      b.scores.push(computeScore({ ...l, raw: slimRaw(l) }, { isBeach, siblingAmenities: _sib[rollupBuilding(l.building)] || [], avgRating: _cnt[String(l.id)] ? Math.round((_sum[String(l.id)] / _cnt[String(l.id)]) * 100) / 100 : null, reviewCount: _cnt[String(l.id)] || 0 }).overall)
    }
    if (!b.city && l.address_city) b.city = l.address_city
  })

  const allScores: number[] = []
  const buildings = Array.from(map.values()).map(b => {
    allScores.push(...b.scores)
    const avg = b.scores.length ? Math.round(b.scores.reduce((s, n) => s + n, 0) / b.scores.length) : null
    const weak = b.scores.filter(s => s < 60).length
    const { scores, ...rest } = b
    return { ...rest, avg, weak }
  }).sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999)) // weakest portfolios first

  const totalUnits = (listings ?? []).length
  const portfolioAvg = allScores.length ? Math.round(allScores.reduce((s, n) => s + n, 0) / allScores.length) : null
  return { buildings, workByBuilding, totalUnits, portfolioAvg }
}, ['portfolio-rollup-v1'], { revalidate: 120 })

export default async function PortfolioPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { buildings, workByBuilding, totalUnits, portfolioAvg } = await getPortfolioData()

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> Portfolio</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted mt-1">
            {buildings.length} buildings · {totalUnits} units
            {portfolioAvg != null && <> · portfolio Optimize Score <b className="text-ink">{portfolioAvg}</b></>}
          </p>
        </div>
      </header>

      {buildings.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No listings synced yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {buildings.map(b => {
            const ui = b.avg != null ? bandUi(band(b.avg)) : null
            return (
              <Link key={b.name} href={`/buildings/${buildingSlug(b.name)}`} prefetch={false}
                className="group block rounded-2xl border border-line bg-white overflow-hidden hover:border-brand-300 hover:shadow-soft transition-all">
                <div className="px-4 py-3 border-b border-line">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5 truncate">
                      <Building2 size={15} className="text-brand-600 shrink-0" /> {b.name}
                    </h2>
                    {b.avg != null && ui && (
                      <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-lg text-sm font-bold tabular-nums ring-1 shrink-0 ${ui.ring}`} title="Building Optimize Score">{b.avg}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {b.city && <p className="text-[11px] text-muted inline-flex items-center gap-1"><MapPin size={10} /> {b.city}</p>}
                    {workByBuilding[b.name] ? (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                        <Wrench size={10} /> {workByBuilding[b.name]} open
                      </span>
                    ) : null}
                    {b.weak > 0 && (
                      <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                        <AlertTriangle size={10} /> {b.weak} need work
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
                  <Mini label="Units" value={b.unitCount} />
                  <Mini label="Bedrooms" value={b.beds} Icon={BedDouble} />
                  <Mini label="Sleeps" value={b.sleeps} Icon={Users} />
                </div>

                <div className="px-4 py-2.5 flex items-center justify-between text-[11px] font-medium text-muted group-hover:text-brand-700 transition-colors">
                  <span>{ui ? ui.label : 'View units'}</span>
                  <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

function Mini({ label, value, Icon }: { label: string; value: number; Icon?: any }) {
  return (
    <div className="py-2.5">
      <div className="text-base font-bold text-ink tabular-nums inline-flex items-center gap-1 justify-center">
        {Icon && <Icon size={12} className="text-muted" />} {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-0.5">{label}</div>
    </div>
  )
}
