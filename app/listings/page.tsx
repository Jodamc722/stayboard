import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { Building2, BedDouble, Bath, Users, MapPin, Tag } from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

// Roll unit-level building names up to their parent property.
// e.g. "Botanica 6108" → "Botanica", "Oasis Mahogany" → "Oasis", "Arya 1704" → "Arya".
const PARENTS = ['Botanica', 'Oasis', 'Arya']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
function rollupBuilding(raw?: string | null): string {
  const b = (raw || '').trim()
  if (!b) return 'Unassigned'
  const lower = b.toLowerCase()
  for (const p of PARENTS) {
    if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  }
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

export default async function ListingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, room_type, tags, address_city, address_state, bedrooms, bathrooms, max_occupancy, status, amenities')
    .limit(1000)

  const listings = rows ?? []

  // KPIs
  const totalUnits = listings.length
  const activeUnits = listings.filter((l: any) => !DEAD.includes(String(l.status || '').toLowerCase())).length
  const totalBedrooms = listings.reduce((s: number, l: any) => s + (Number(l.bedrooms) || 0), 0)
  const totalSleeps = listings.reduce((s: number, l: any) => s + (Number(l.max_occupancy) || 0), 0)
  const buildingSet = new Set<string>()
  listings.forEach((l: any) => {
    const b = rollupBuilding(l.building)
    if (b && b !== 'Unassigned') buildingSet.add(b)
  })
  const totalBuildings = buildingSet.size

  // Sort: active first, then by rolled-up building, then by title.
  const sorted = [...listings].sort((a: any, b: any) => {
    const aDead = DEAD.includes(String(a.status || '').toLowerCase())
    const bDead = DEAD.includes(String(b.status || '').toLowerCase())
    if (aDead !== bDead) return aDead ? 1 : -1
    const ab = rollupBuilding(a.building).toLowerCase()
    const bb = rollupBuilding(b.building).toLowerCase()
    if (ab !== bb) return ab.localeCompare(bb)
    return String(a.title || a.nickname || '').localeCompare(String(b.title || b.nickname || ''))
  })

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Building2 size={13} /> Portfolio</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Properties</h1>
          <p className="text-sm text-muted mt-1">{totalUnits} units · {activeUnits} active · {totalBuildings} buildings across the portfolio.</p>
        </div>
      </header>

      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Kpi label="Total units" value={totalUnits} />
        <Kpi label="Active units" value={activeUnits} accent />
        <Kpi label="Bedrooms" value={totalBedrooms} Icon={BedDouble} />
        <Kpi label="Sleeps" value={totalSleeps} Icon={Users} />
        <Kpi label="Buildings" value={totalBuildings} Icon={Building2} />
      </div>

      {/* Grid */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">No listings synced yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((l: any) => (
            <PropertyCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </Shell>
  )
}

function PropertyCard({ l }: { l: any }) {
  const dead = DEAD.includes(String(l.status || '').toLowerCase())
  const name = l.title || l.nickname || 'Untitled unit'
  const parent = rollupBuilding(l.building)
  const building = parent !== 'Unassigned' ? parent : null
  const place = [l.address_city, l.address_state].filter(Boolean).join(', ')

  const tags: string[] = Array.isArray(l.tags) ? l.tags : []
  const amenities: string[] = Array.isArray(l.amenities) ? l.amenities : []

  return (
    <section className={`rounded-2xl border border-line bg-white overflow-hidden flex flex-col ${dead ? 'opacity-70' : ''}`}>
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-start justify-between gap-2">
          <h2 className={`font-semibold text-ink text-sm leading-snug ${dead ? 'line-through text-muted' : ''}`}>
            {name}
          </h2>
          {dead && (
            <span className="text-[10px] font-semibold text-muted bg-app px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide">
              {String(l.status || 'inactive')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted">
          {building && (
            <span className="inline-flex items-center gap-1">
              <Building2 size={11} className="text-brand-600" /> {building}{l.unit ? ` · ${l.unit}` : ''}
            </span>
          )}
          {place && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} /> {place}
            </span>
          )}
        </div>
      </div>

      {/* Spec chips */}
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
        <Spec label="Beds" value={Number(l.bedrooms) || 0} Icon={BedDouble} />
        <Spec label="Baths" value={Number(l.bathrooms) || 0} Icon={Bath} />
        <Spec label="Sleeps" value={Number(l.max_occupancy) || 0} Icon={Users} />
      </div>

      {/* Room type + tags + amenities */}
      <div className="px-4 py-3 flex-1 flex flex-col gap-2">
        {l.room_type && (
          <div>
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700">
              {l.room_type}
            </span>
          </div>
        )}
        {(tags.length > 0 || amenities.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 4).map((t, i) => (
              <span key={`t-${i}`} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-app text-muted inline-flex items-center gap-1">
                <Tag size={9} /> {t}
              </span>
            ))}
            {amenities.slice(0, 4).map((a, i) => (
              <span key={`a-${i}`} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-app text-muted">
                {a}
              </span>
            ))}
            {amenities.length > 4 && (
              <span className="text-[11px] text-muted px-1">+{amenities.length - 4} more</span>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function Kpi({ label, value, Icon, accent }: { label: string; value: number; Icon?: any; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'bg-white border-line'}`}>
      <div className={`text-2xl font-bold tabular-nums flex items-center gap-1.5 ${accent ? 'text-brand-700' : 'text-ink'}`}>
        {Icon && <Icon size={16} className={accent ? 'text-brand-600' : 'text-muted'} />} {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}

function Spec({ label, value, Icon }: { label: string; value: number; Icon?: any }) {
  return (
    <div className="py-2.5">
      <div className="text-base font-bold text-ink tabular-nums inline-flex items-center gap-1 justify-center">
        {Icon && <Icon size={12} className="text-muted" />} {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-0.5">{label}</div>
    </div>
  )
}
