// Portfolio — the single entry point for buildings + units. Each building card shows a
// rolled-up Optimize Score (mean of its units), how many units need work, and open ops
// work. Click a building to drill into every unit with its own score. Scores come from
// the shared lib/optimize-score (research-backed, computed from Guesty data).
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { computeScore, rollupBuilding, buildingSlug, band, bandUi } from '@/lib/optimize-score'
import { Building2, BedDouble, Users, Wrench, MapPin, ArrowRight, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

export default async function PortfolioPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: listings }, { data: work }] = await Promise.all([
    supabase.from('guesty_listings')
      .select('id, title, nickname, building, unit, status, bedrooms, max_occupancy, address_city, amenities, pictures, raw')
      .limit(1000),
    supabase.from('field_requests').select('building').in('status', ['open', 'in_progress']).limit(1000),
  ])

  const workByBuilding: Record<string, number> = {}
  ;(work ?? []).forEach((w: any) => {
    const b = rollupBuilding(w.building)
    if (b && b !== 'Unassigned') workByBuilding[b] = (workByBuilding[b] || 0) + 1
  })

  type B = { name: string; city?: string; units: any[]; beds: number; sleeps: number; active: number; scores: number[] }
  const map = new Map<string, B>()
  ;(listings ?? []).forEach((l: any) => {
    const name = rollupBuilding(l.building)
    if (!map.has(name)) map.set(name, { name, city: l.address_city || undefined, units: [], beds: 0, sleeps: 0, active: 0, scores: [] })
    const b = map.get(name)!
    b.units.push(l)
    b.beds += Number(l.bedrooms) || 0
    b.sleeps += Number(l.max_occupancy) || 0
    const dead = DEAD.includes(String(l.status || '').toLowerCase())
    if (!dead) {
      b.active += 1
      const isBeach = /beach/i.test(String(l.address_city || ''))
      b.scores.push(computeScore(l, { isBeach }).overall)
    }
    if (!b.city && l.address_city) b.city = l.address_city
  })

  const buildings = Array.from(map.values()).map(b => {
    const avg = b.scores.length ? Math.round(b.scores.reduce((s, n) => s + n, 0) / b.scores.length) : null
    const weak = b.scores.filter(s => s < 60).length
    return { ...b, avg, weak }
  }).sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999)) // weakest portfolios first

  const totalUnits = (listings ?? []).length
  const scored = buildings.flatMap(b => b.scores)
  const portfolioAvg = scored.length ? Math.round(scored.reduce((s, n) => s + n, 0) / scored.length) : null

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
                  <Mini label="Units" value={b.units.length} />
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
