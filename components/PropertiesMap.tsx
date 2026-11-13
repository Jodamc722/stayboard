'use client'
// The properties map: every building as a pin with its unit count, the homes being onboarded in gold, a list to
// search and jump from, and the units behind each pin.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { StayMap, type MapPoint } from './StayMap'

type Unit = { id: string; name: string; building: string; address: string; city: string; lat: number; lng: number; bd: number | null; ba: number | null; acc: number | null; pic: string }
type Onb = { code: string; name: string; address: string; stage: string; lat: number; lng: number }
type Place = { id: string; name: string; address: string; city: string; lat: number; lng: number; units: Unit[]; onb?: Onb }
const lab = 'text-[10.5px] uppercase tracking-[0.16em] text-muted font-semibold'

export function PropertiesMap() {
  const [data, setData] = useState<{ units: Unit[]; unplaced: number; onboarding: Onb[] } | null>(null)
  const [err, setErr] = useState(''); const [q, setQ] = useState(''); const [sel, setSel] = useState<string | null>(null)
  useEffect(() => { fetch('/api/map', { cache: 'no-store' }).then(r => r.json()).then(d => (d?.ok ? setData(d) : setErr(d?.message || d?.error || 'Could not load the map.'))).catch(() => setErr('Could not load the map.')) }, [])
  const places = useMemo<Place[]>(() => {
    if (!data) return []
    const m = new Map<string, Place>()
    for (const u of data.units) {
      // a building is its name; a unit with no building stands at its own coordinates
      const k = u.building ? 'b:' + u.building : 'p:' + u.lat.toFixed(4) + ',' + u.lng.toFixed(4)
      const p = m.get(k) || { id: k, name: u.building || u.name, address: u.address, city: u.city, lat: 0, lng: 0, units: [] }
      p.units.push(u); m.set(k, p)
    }
    const out = Array.from(m.values())
    for (const p of out) { p.lat = p.units.reduce((a, u) => a + u.lat, 0) / p.units.length; p.lng = p.units.reduce((a, u) => a + u.lng, 0) / p.units.length; p.units.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }
    out.sort((a, b) => b.units.length - a.units.length || a.name.localeCompare(b.name))
    for (const o of data.onboarding) out.push({ id: 'o:' + o.code, name: o.name, address: o.address, city: '', lat: o.lat, lng: o.lng, units: [], onb: o })
    return out
  }, [data])
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? places.filter(p => (p.name + ' ' + p.address + ' ' + p.city + ' ' + p.units.map(u => u.name).join(' ')).toLowerCase().includes(s)) : places }, [places, q])
  const points: MapPoint[] = shown.map(p => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name + (p.onb ? ' · onboarding' : ' · ' + p.units.length + (p.units.length === 1 ? ' unit' : ' units')), count: p.onb ? undefined : p.units.length, kind: p.onb ? 'onboarding' : 'live' }))
  const cur = places.find(p => p.id === sel) || null
  const live = places.filter(p => !p.onb)
  const gmaps = (p: Place) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.address || p.lat + ',' + p.lng)

  if (err) return <p className="p-8 text-muted">{err}</p>
  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mb-4">
        <div className="mr-auto"><p className={lab}>Properties</p><h1 className="font-serif text-[34px] leading-none text-ink mt-1">Map</h1></div>
        {data ? <p className="text-[13px] text-muted"><b className="text-ink">{live.length}</b> {live.length === 1 ? 'property' : 'properties'} · <b className="text-ink">{data.units.length}</b> units{data.onboarding.length ? <> · <b style={{ color: '#8C6D3A' }}>{data.onboarding.length}</b> onboarding</> : null}{data.unplaced ? <> · {data.unplaced} with no map location in Guesty</> : null}</p> : null}
        <Link href="/buildings" className="text-[13px] font-semibold text-ink underline">Properties list</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="order-2 lg:order-1 min-w-0">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a building, unit or street" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] text-ink mb-3" />
          {cur ? (
            <div className="rounded-2xl border border-line bg-white p-4 mb-3">
              <div className="flex items-start gap-2"><div className="mr-auto min-w-0"><p className={lab}>{cur.onb ? 'Onboarding · ' + cur.onb.stage : cur.units.length + (cur.units.length === 1 ? ' unit' : ' units')}</p><h2 className="font-serif text-[22px] leading-tight text-ink mt-0.5">{cur.name}</h2>{cur.address ? <p className="text-[12.5px] text-muted mt-0.5">{cur.address}</p> : null}</div><button type="button" onClick={() => setSel(null)} className="text-muted text-[18px] leading-none" aria-label="Close">×</button></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12.5px] font-semibold"><a href={gmaps(cur)} target="_blank" rel="noreferrer" className="underline text-ink">Open in Google Maps</a>{cur.onb ? <Link href={'/owner-onboarding/' + cur.onb.code} className="underline text-ink">Open the onboarding</Link> : null}</div>
              {cur.units.length ? <ul className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-line">{cur.units.map(u => <li key={u.id}><Link href={'/listings/' + u.id} className="flex items-center gap-3 py-2 hover:bg-app rounded-lg px-1">{u.pic ? <img src={u.pic} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" loading="lazy" /> : <span className="w-11 h-11 rounded-lg bg-app shrink-0" />}<span className="min-w-0"><span className="block text-[13.5px] font-semibold text-ink truncate">{u.name}</span><span className="block text-[12px] text-muted">{[u.bd === 0 ? 'Studio' : u.bd != null ? u.bd + ' BR' : '', u.ba != null ? u.ba + ' BA' : '', u.acc != null ? 'sleeps ' + u.acc : ''].filter(Boolean).join(' · ')}</span></span></Link></li>)}</ul> : null}
            </div>
          ) : null}
          {!data ? <p className="text-[13px] text-muted">Loading the properties…</p> : !shown.length ? <p className="text-[13px] text-muted">Nothing matches that search.</p> : (
            <ul className="rounded-2xl border border-line bg-white divide-y divide-line max-h-[52vh] lg:max-h-[calc(100vh-330px)] overflow-y-auto">
              {shown.map(p => <li key={p.id}><button type="button" onClick={() => setSel(p.id)} className={'w-full text-left px-3 py-2.5 flex items-center gap-3 ' + (sel === p.id ? 'bg-app' : 'hover:bg-app')}>
                <span className="grid place-items-center min-w-[28px] h-7 px-1.5 rounded-full text-white text-[12px] font-semibold shrink-0" style={{ background: p.onb ? '#8C6D3A' : '#14161B' }}>{p.onb ? '•' : p.units.length}</span>
                <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-ink truncate">{p.name}</span><span className="block text-[12px] text-muted truncate">{p.onb ? 'Onboarding · ' + p.onb.stage : p.city || p.address}</span></span></button></li>)}
            </ul>
          )}
        </div>
        <div className="order-1 lg:order-2 min-w-0 lg:sticky lg:top-4 self-start w-full">
          <StayMap points={points} selected={sel} onSelect={setSel} height="min(72vh, 760px)" />
          <p className="text-[11.5px] text-muted mt-2">Dark pins are live properties with their unit count; gold pins are homes being onboarded. Tap a pin or a name.</p>
        </div>
      </div>
    </div>
  )
}
