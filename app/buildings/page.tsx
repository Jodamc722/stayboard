import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { Building2, BedDouble, Users, Wrench, MapPin } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

export default async function BuildingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: listings }, { data: work }] = await Promise.all([
    supabase.from('guesty_listings')
      .select('id, title, nickname, building, unit, status, bedrooms, max_occupancy, address_city')
      .limit(1000),
    supabase.from('field_requests').select('building').in('status', ['open', 'in_progress']).limit(1000),
  ])

  // Count open work per building (field_requests.building).
  const workByBuilding: Record<string, number> = {}
  ;(work ?? []).forEach((w: any) => {
    const b = (w.building || '').trim()
    if (b) workByBuilding[b] = (workByBuilding[b] || 0) + 1
  })

  // Group listings by building.
  type B = { name: string; city?: string; units: any[]; beds: number; sleeps: number; active: number }
  const map = new Map<string, B>()
  ;(listings ?? []).forEach((l: any) => {
    const name = (l.building || '').trim() || 'Unassigned'
    if (!map.has(name)) map.set(name, { name, city: l.address_city || undefined, units: [], beds: 0, sleeps: 0, active: 0 })
    const b = map.get(name)!
    b.units.push(l)
    b.beds += Number(l.bedrooms) || 0
    b.sleeps += Number(l.max_occupancy) || 0
    if (!DEAD.includes(String(l.status || '').toLowerCase())) b.active += 1
    if (!b.city && l.address_city) b.city = l.address_city
  })

  const buildings = Array.from(map.values()).sort((a, b) => b.units.length - a.units.length)
  const totalUnits = (listings ?? []).length

  const unitLabel = (l: any) => (l.unit || l.nickname || l.title || '').toString().replace(/^.*?([#]?\s*\d+\w*)$/, '$1') || (l.nickname || l.title || 'Unit')

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> Portfolio</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Buildings</h1>
          <p className="text-sm text-muted mt-1">{buildings.length} buildings · {totalUnits} units across the portfolio.</p>
        </div>
      </header>

      {buildings.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No listings synced yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {buildings.map(b => (
            <section key={b.name} className="rounded-2xl border border-line bg-white overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-line">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5 truncate">
                    <Building2 size={15} className="text-brand-600 shrink-0" /> {b.name}
                  </h2>
                  {workByBuilding[b.name] ? (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1 shrink-0">
                      <Wrench size={10} /> {workByBuilding[b.name]} open
                    </span>
                  ) : null}
                </div>
                {b.city && <p className="text-[11px] text-muted mt-0.5 inline-flex items-center gap-1"><MapPin size={10} /> {b.city}</p>}
              </div>

              <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
                <Mini label="Units" value={b.units.length} />
                <Mini label="Bedrooms" value={b.beds} Icon={BedDouble} />
                <Mini label="Sleeps" value={b.sleeps} Icon={Users} />
              </div>

              <div className="px-4 py-3 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  {b.units.slice(0, 30).map((l: any) => {
                    const dead = DEAD.includes(String(l.status || '').toLowerCase())
                    return (
                      <span key={l.id} title={l.title || l.nickname}
                        className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${dead ? 'bg-app text-muted line-through' : 'bg-brand-50 text-brand-700'}`}>
                        {unitLabel(l)}
                      </span>
                    )
                  })}
                  {b.units.length > 30 && <span className="text-[11px] text-muted px-1">+{b.units.length - 30} more</span>}
                </div>
              </div>

              <Link href={`/listings`} className="px-4 py-2.5 border-t border-line text-[11px] font-semibold text-brand-700 hover:bg-app">
                Open in Properties →
              </Link>
            </section>
          ))}
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
