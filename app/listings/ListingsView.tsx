'use client'
import { useMemo, useState } from 'react'
import { SyncNowButton } from '@/components/SyncNowButton'

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

export function ListingsView({
  listings,
  lastSync,
  selectedTag,
  query
}: { listings: Listing[]; lastSync: string | null; selectedTag: string | null; query: string }) {
  const [tag, setTag] = useState<string | null>(selectedTag)
  const [q, setQ] = useState(query)

  // All distinct tags + buildings for the filter row
  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const l of listings) for (const t of l.tags ?? []) s.add(t)
    return Array.from(s).sort()
  }, [listings])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return listings.filter(l => {
      if (tag && !(l.tags ?? []).includes(tag)) return false
      if (needle) {
        const hay = `${l.nickname ?? ''} ${l.title ?? ''} ${l.building ?? ''} ${l.unit ?? ''} ${l.room_type ?? ''} ${(l.tags ?? []).join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [listings, tag, q])

  // Group by building
  const groups = useMemo(() => {
    const map = new Map<string, Listing[]>()
    for (const l of filtered) {
      const k = l.building || '— Unassigned —'
      const arr = map.get(k) ?? []
      arr.push(l)
      map.set(k, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  return (
    <>
      <header className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Listings</h1>
          <p className="text-sm text-slate-500">
            {lastSync
              ? <>Last synced {timeAgo(new Date(lastSync))} · {listings.length} total</>
              : <>Not synced yet — click <strong>Sync now</strong> →</>}
          </p>
        </div>
        <SyncNowButton />
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search building, unit, room type…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition text-sm"
        />
        <div className="flex flex-wrap gap-1">
          <Pill active={tag === null} onClick={() => setTag(null)} label="All" />
          {allTags.map(t => (
            <Pill key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)} label={t} />
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
          {listings.length === 0
            ? <>No listings synced yet. Click <strong>Sync now</strong> above.</>
            : 'No listings match the current filters.'}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([building, items]) => (
            <section key={building} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <header className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-baseline justify-between">
                <h2 className="font-semibold text-slate-900">{building}</h2>
                <span className="text-xs text-slate-500">{items.length} unit{items.length === 1 ? '' : 's'}</span>
              </header>
              <ul className="divide-y divide-slate-100">
                {items.map(l => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition">
                    <div className="w-12 text-xs font-mono text-slate-500">{l.unit || '—'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium text-slate-900 truncate">{l.room_type || l.nickname || l.title || 'Unnamed'}</span>
                        {(l.tags ?? []).slice(0, 4).map(t => (
                          <button
                            key={t}
                            onClick={() => setTag(tag === t ? null : t)}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ring-1 ring-inset transition ${tag === t ? 'bg-brand-500 text-white ring-brand-500' : 'bg-slate-100 text-slate-600 ring-slate-200 hover:bg-slate-200'}`}
                          >{t}</button>
                        ))}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
                        {l.bedrooms != null && <span>{l.bedrooms} bd</span>}
                        {l.bathrooms != null && <span>{l.bathrooms} ba</span>}
                        {l.max_occupancy != null && <span>sleeps {l.max_occupancy}</span>}
                        {l.address_city && <span>{l.address_city}, {l.address_state}</span>}
                      </div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${l.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {l.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function Pill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >{label}</button>
  )
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
