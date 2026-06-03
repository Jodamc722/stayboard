'use client'
import { useMemo, useState } from 'react'
import { SyncNowButton } from '@/components/SyncNowButton'
import { parseListing, bedroomBucket, normalizeBuilding } from '@/lib/parse-listing'

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
  listings,
  lastSync
}: { listings: Listing[]; lastSync: string | null }) {
  const [f, setF] = useState<Filters>({
    q: '', status: 'all', city: null, bedroom: null, building: null
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Re-parse building/unit/room_type at render time so DB updates aren't required
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

  // Aggregate values for filter dropdowns
  const cities = useMemo(() => {
    const s = new Set<string>()
    enriched.forEach(l => l.address_city && s.add(l.address_city))
    return Array.from(s).sort()
  }, [enriched])
  const buildings = useMemo(() => {
    const s = new Set<string>()
    enriched.forEach(l => l.building && s.add(l.building))
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [enriched])
  const bedrooms = ['Studio', '1BR', '2BR', '3BR', '4BR+', 'Other']

  // Filter
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

  // Group by building, building sort is natural-numeric
  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>()
    filtered.forEach(l => {
      const key = l.building || 'Other'
      const arr = m.get(key) ?? []
      arr.push(l)
      m.set(key, arr as any)
    })
    // Sort buildings naturally; sort units within each building
    const out = Array.from(m.entries())
    out.forEach(([, items]) => {
      items.sort((a: any, b: any) =>
        (a.unit || '').localeCompare(b.unit || '', undefined, { numeric: true }) ||
        (a.nickname || '').localeCompare(b.nickname || '')
      )
    })
    out.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    return out
  }, [filtered])

  const totalShown = filtered.length

  return (
    <>
      {/* Header */}
      <header className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Properties</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {lastSync ? <>Last synced {timeAgo(new Date(lastSync))} · </> : null}
            <strong className="text-slate-700">{listings.length}</strong> total
            {totalShown !== listings.length && <> · <strong className="text-slate-700">{totalShown}</strong> shown</>}
          </p>
        </div>
        <SyncNowButton />
      </header>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mb-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M9 17a8 8 0 100-16 8 8 0 000 16zm9 1l-4-4"/></svg>
          </span>
          <input
            type="search"
            value={f.q}
            onChange={e => setF({ ...f, q: e.target.value })}
            placeholder="Search building, unit, city…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition"
          />
        </div>

        {/* Status segmented */}
        <Segmented
          options={[
            { val: 'all',      label: 'All'      },
            { val: 'active',   label: 'Active'   },
            { val: 'inactive', label: 'Inactive' }
          ]}
          value={f.status}
          onChange={(v) => setF({ ...f, status: v as Filters['status'] })}
        />

        {/* Bedrooms dropdown */}
        <Select
          value={f.bedroom}
          placeholder="Bedrooms"
          options={[{ val: null, label: 'Any bedrooms' }, ...bedrooms.map(b => ({ val: b, label: b }))]}
          onChange={(v) => setF({ ...f, bedroom: v })}
        />

        {/* City dropdown */}
        {cities.length > 1 && (
          <Select
            value={f.city}
            placeholder="City"
            options={[{ val: null, label: 'All cities' }, ...cities.map(c => ({ val: c, label: c }))]}
            onChange={(v) => setF({ ...f, city: v })}
          />
        )}

        {/* Building dropdown */}
        <Select
          value={f.building}
          placeholder="Building"
          options={[{ val: null, label: 'All buildings' }, ...buildings.map(b => ({ val: b, label: b }))]}
          onChange={(v) => setF({ ...f, building: v })}
        />

        {(f.q || f.status !== 'all' || f.city || f.bedroom || f.building) && (
          <button
            onClick={() => setF({ q: '', status: 'all', city: null, bedroom: null, building: null })}
            className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
          >Clear</button>
        )}
      </div>

      {/* Empty */}
      {groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          {listings.length === 0
            ? <>No properties synced yet. Click <strong>Sync now</strong> above.</>
            : 'No properties match the current filters.'}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([building, items]) => {
            const isCollapsed = collapsed[building]
            const activeCount = items.filter(i => i.status === 'active').length
            return (
              <section key={building} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => setCollapsed({ ...collapsed, [building]: !isCollapsed })}
                  className="w-full px-4 py-3 bg-slate-50/50 hover:bg-slate-50 border-b border-slate-200 flex items-center justify-between text-left transition"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▾</span>
                    <h2 className="font-semibold text-slate-900">{building}</h2>
                    <span className="text-xs text-slate-500">{items.length} {items.length === 1 ? 'unit' : 'units'}</span>
                  </div>
                  {activeCount !== items.length && (
                    <span className="text-[10px] text-slate-500">{activeCount}/{items.length} active</span>
                  )}
                </button>
                {!isCollapsed && (
                  <ul className="divide-y divide-slate-100">
                    {items.map(l => (
                      <li key={l.id} className="group flex items-center gap-4 px-4 py-2.5 hover:bg-slate-50/70 transition">
                        <div className="w-14 flex-shrink-0">
                          <span className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-mono font-medium">
                            {l.unit || '—'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-medium text-slate-900 truncate">
                              {l.room_type || l.nickname || 'Unnamed'}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                              {l.bedBucket}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            {l.bedrooms != null && <span>{l.bedrooms} bd</span>}
                            {l.bathrooms != null && <span>{Number(l.bathrooms)} ba</span>}
                            {l.max_occupancy != null && <span>sleeps {l.max_occupancy}</span>}
                            {l.address_city && <span className="text-slate-400">·</span>}
                            {l.address_city && <span>{l.address_city}{l.address_state ? `, ${l.address_state}` : ''}</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${l.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20' : 'bg-slate-100 text-slate-500'}`}>
                          {l.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
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

function Segmented<T extends string>({
  options, value, onChange
}: { options: { val: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-slate-100">
      {options.map(o => (
        <button
          key={o.val}
          onClick={() => onChange(o.val)}
          className={`text-xs px-2.5 py-1.5 rounded-md font-medium transition ${value === o.val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
        >{o.label}</button>
      ))}
    </div>
  )
}

function Select({ value, placeholder, options, onChange }:
  { value: string | null; placeholder: string; options: { val: string | null; label: string }[]; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={String(o.val)} value={o.val ?? ''}>{o.label}</option>)}
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
