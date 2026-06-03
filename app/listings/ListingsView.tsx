'use client'
import { useMemo, useState } from 'react'
import { SyncNowButton } from '@/components/SyncNowButton'
import { parseListing, bedroomBucket, normalizeBuilding } from '@/lib/parse-listing'
import { Search, ChevronDown, X, MapPin, Bed, Bath, Users } from 'lucide-react'

type Listing = {
  id: string
  title: string | null
  nickname: string | null
  building: string | null
  unit: string | null
  room_type: string | null
  tags: string[] | null
  address_city: string | null
  address_state: string | null
  bedrooms: number | null
  bathrooms: number | null
  max_occupancy: number | null
  status: string | null
  amenities: string[] | null
}

type Filters = {
  q: string
  status: 'all' | 'active' | 'inactive'
  city: string | null
  bedroom: string | null
  building: string | null
}

export function ListingsView({
  listings, lastSync
}: { listings: Listing[]; lastSync: string | null }) {
  const [f, setF] = useState<Filters>({ q: '', status: 'all', city: null, bedroom: null, building: null })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const enriched = useMemo(() => listings.map(l => {
    const p = parseListing(l.nickname, l.title)
    return {
      ...l,
      building: normalizeBuilding(l.building || p.building),
      unit: l.unit || p.unit,
      room_type: l.room_type || p.room_type,
      bedBucket: bedroomBucket(l.room_type || p.room_type, l.bedrooms)
    }
  }), [listings])

  const cities = useMemo(() => {
    const s = new Set<string>(); enriched.forEach(l => l.address_city && s.add(l.address_city))
    return Array.from(s).sort()
  }, [enriched])
  const buildings = useMemo(() => {
    const s = new Set<string>(); enriched.forEach(l => l.building && s.add(l.building))
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [enriched])

  const filtered = useMemo(() => {
    const needle = f.q.trim().toLowerCase()
    return enriched.filter(l => {
      if (f.status !== 'all' && l.status !== f.status) return false
      if (f.city && l.address_city !== f.city) return false
      if (f.bedroom && l.bedBucket !== f.bedroom) return false
      if (f.building && l.building !== f.building) return false
      if (needle) {
        const hay = `${l.nickname ?? ''} ${l.title ?? ''} ${l.building ?? ''} ${l.unit ?? ''} ${l.room_type ?? ''} ${l.address_city ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [enriched, f])

  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>()
    filtered.forEach(l => {
      const key = l.building || 'Other'
      const arr = m.get(key) ?? []; arr.push(l); m.set(key, arr as any)
    })
    const out = Array.from(m.entries())
    out.forEach(([, items]) => items.sort((a: any, b: any) =>
      (a.unit || '').localeCompare(b.unit || '', undefined, { numeric: true }) ||
      (a.nickname || '').localeCompare(b.nickname || '')
    ))
    out.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    return out
  }, [filtered])

  const totalShown = filtered.length
  const anyFilter = !!(f.q || f.status !== 'all' || f.city || f.bedroom || f.building)

  return (
    <>
      <header className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Properties</h1>
          <p className="text-sm text-muted mt-1">
            {lastSync ? <>Last synced {timeAgo(new Date(lastSync))} · </> : null}
            <strong className="text-ink/80">{listings.length}</strong> total
            {totalShown !== listings.length && <> · <strong className="text-ink/80">{totalShown}</strong> shown</>}
          </p>
        </div>
        <SyncNowButton />
      </header>

      <div className="bg-white rounded-2xl border border-line shadow-soft p-2 mb-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none" />
          <input
            type="search"
            value={f.q}
            onChange={e => setF({ ...f, q: e.target.value })}
            placeholder="Search building, unit, city…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition bg-white"
          />
        </div>

        <Segmented value={f.status} onChange={(v: any) => setF({ ...f, status: v })} options={[
          { v: 'all', l: 'All' }, { v: 'active', l: 'Active' }, { v: 'inactive', l: 'Inactive' }
        ]} />

        <Dropdown placeholder="Bedrooms" value={f.bedroom} onChange={v => setF({ ...f, bedroom: v })}
          options={[null, 'Studio', '1BR', '2BR', '3BR', '4BR+', 'Other'].map(o => ({ v: o, l: o ?? 'Any bedrooms' }))} />
        {cities.length > 1 && (
          <Dropdown placeholder="City" value={f.city} onChange={v => setF({ ...f, city: v })}
            options={[{ v: null, l: 'All cities' }, ...cities.map(c => ({ v: c, l: c }))]} />
        )}
        <Dropdown placeholder="Building" value={f.building} onChange={v => setF({ ...f, building: v })}
          options={[{ v: null, l: 'All buildings' }, ...buildings.map(b => ({ v: b, l: b }))]} />

        {anyFilter && (
          <button onClick={() => setF({ q: '', status: 'all', city: null, bedroom: null, building: null })}
            className="text-xs text-muted hover:text-ink px-2 py-1 inline-flex items-center gap-1">
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line p-16 text-center text-muted shadow-soft">
          {listings.length === 0
            ? <>No properties synced yet. Click <strong>Sync now</strong> above.</>
            : 'No properties match the current filters.'}
        </div>
      ) : (
        <div className="space-y-3 animate-slide-up">
          {groups.map(([building, items]) => {
            const isCollapsed = collapsed[building]
            const activeCount = items.filter(i => i.status === 'active').length
            return (
              <section key={building} className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden">
                <button
                  onClick={() => setCollapsed({ ...collapsed, [building]: !isCollapsed })}
                  className="w-full px-5 py-3 bg-white hover:bg-app/60 border-b border-line flex items-center justify-between text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <ChevronDown size={16} className={`text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <h2 className="font-semibold text-ink text-base tracking-tight">{building}</h2>
                    <span className="text-xs text-muted bg-app px-2 py-0.5 rounded-md font-medium">{items.length}</span>
                  </div>
                  {activeCount !== items.length && (
                    <span className="text-[11px] text-muted">{activeCount}/{items.length} active</span>
                  )}
                </button>
                {!isCollapsed && (
                  <ul className="divide-y divide-line/60">
                    {items.map(l => (
                      <li key={l.id} className="group flex items-center gap-4 px-5 py-3 hover:bg-app/40 transition-colors">
                        <div className="w-14 flex-shrink-0 text-center">
                          <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-xs font-mono font-semibold">
                            {l.unit || '—'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-medium text-ink truncate">
                              {l.room_type || l.nickname || 'Unnamed'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted font-semibold tracking-wide uppercase">
                              {l.bedBucket}
                            </span>
                          </div>
                          <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {l.bedrooms != null && <span className="inline-flex items-center gap-1"><Bed size={11}/>{l.bedrooms}</span>}
                            {l.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={11}/>{Number(l.bathrooms)}</span>}
                            {l.max_occupancy != null && <span className="inline-flex items-center gap-1"><Users size={11}/>{l.max_occupancy}</span>}
                            {l.address_city && <span className="inline-flex items-center gap-1"><MapPin size={11}/>{l.address_city}{l.address_state ? `, ${l.address_state}` : ''}</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold uppercase tracking-wide ring-1 ring-inset ${l.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
                          {l.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-app">
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${value === o.v ? 'bg-white text-ink shadow-soft' : 'text-muted hover:text-ink'}`}
        >{o.l}</button>
      ))}
    </div>
  )
}

function Dropdown({ value, placeholder, options, onChange }:
  { value: string | null; placeholder: string; options: { v: string | null; l: string }[]; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="text-xs px-2.5 py-2 rounded-lg border border-line bg-white text-ink focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={String(o.v)} value={o.v ?? ''}>{o.l}</option>)}
    </select>
  )
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
