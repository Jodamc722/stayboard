'use client'
// BASE RATES, THE FULL LIST (Jon, 2026-11-18: "the base rates should show on admin page, by listing. Full list…
// with it opening to the unit"). Every active listing with the base price Guesty holds for it, its weekend base,
// and what its nights actually sold for over the last 12 months. A row opens the unit's page. Read-only here:
// base prices are changed per property, on the property page's Base prices panel (which checks the calendar first).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, RefreshCw } from 'lucide-react'
import { LeanPick, LeanEmpty, Tag } from '@/components/lean'

type Unit = { id: string; name: string; building: string; bedrooms: number | null; base: number | null; weekendBase: number | null; booked: number | null; nights: number; basis: 'own' | 'building' | 'none' }
type Sort = 'name' | 'building' | 'high' | 'low' | 'gap'
const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString())
const beds = (n: number | null) => (n == null ? '' : n === 0 ? 'Studio' : n + ' BR')
/** How far the base sits from the booked night, as a share of the booked night. Null when either is missing. */
const gapOf = (u: Unit) => (u.base && u.booked ? (u.base - u.booked) / u.booked : null)

export function AdminBaseRates() {
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [q, setQ] = useState(''); const [building, setBuilding] = useState('all'); const [sort, setSort] = useState<Sort>('building'); const [show, setShow] = useState<'all' | 'off' | 'none'>('all')
  const load = () => { setBusy(true); setErr(''); fetch('/api/base-price?all=1', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) setUnits(j.units || []); else setErr(j?.error || 'Could not load the base rates.') }).catch(() => setErr('Could not load the base rates.')).finally(() => setBusy(false)) }
  useEffect(load, [])
  const buildings = useMemo(() => Array.from(new Set((units || []).map(u => u.building).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [units])
  const off = (u: Unit) => { const g = gapOf(u); return g != null && Math.abs(g) >= 0.3 }
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const byName = (a: Unit, b: Unit) => a.name.localeCompare(b.name, undefined, { numeric: true })
    return (units || [])
      .filter(u => (building === 'all' || u.building === building) && (!s || (u.name + ' ' + u.building).toLowerCase().includes(s)) && (show === 'all' || (show === 'off' ? off(u) : u.base == null)))
      .sort((a, b) => sort === 'name' ? byName(a, b)
        : sort === 'high' ? (b.base ?? -1) - (a.base ?? -1) || byName(a, b)
        : sort === 'low' ? (a.base ?? 1e9) - (b.base ?? 1e9) || byName(a, b)
        : sort === 'gap' ? Math.abs(gapOf(b) ?? -1) - Math.abs(gapOf(a) ?? -1) || byName(a, b)
        : a.building.localeCompare(b.building) || byName(a, b))
  }, [units, q, building, sort, show])
  const nOff = (units || []).filter(off).length, nNone = (units || []).filter(u => u.base == null).length

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or building…" aria-label="Find a unit or building" className="w-56 max-w-full rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" />
          </div>
          {buildings.length > 1 ? <select value={building} onChange={e => setBuilding(e.target.value)} aria-label="Building" className="max-w-[220px] rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink"><option value="all">All buildings ({buildings.length})</option>{buildings.map(b => <option key={b} value={b}>{b}</option>)}</select> : null}
          <LeanPick size="sm" value={show} onPick={setShow} options={[{ v: 'all', label: <>All <span className="opacity-60 tabular-nums">{units?.length ?? ''}</span></> }, { v: 'off', label: <>Far from booked <span className="opacity-60 tabular-nums">{nOff}</span></>, title: 'Base price 30% or more above or below what the nights sold for' }, { v: 'none', label: <>No base price <span className="opacity-60 tabular-nums">{nNone}</span></> }]} />
          <span className="ml-auto flex items-center gap-1.5 flex-wrap"><span className="text-[11px] text-muted">Sort</span>
            <LeanPick size="sm" value={sort} onPick={setSort} options={[{ v: 'building', label: 'Building' }, { v: 'name', label: 'Unit' }, { v: 'high', label: 'Highest base' }, { v: 'low', label: 'Lowest base' }, { v: 'gap', label: 'Biggest gap', title: 'Base price furthest from the booked night' }]} />
            <button type="button" onClick={load} disabled={busy} title="Read the list again" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[12px] font-medium text-ink disabled:opacity-50"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh</button>
          </span>
        </div>
      </div>
      <p className="px-1 text-[11.5px] text-muted">{list.length} listing{list.length === 1 ? '' : 's'} · <b>Base</b> and <b>Weekend</b> are what Guesty holds now, as of the last listings sync · <b>Booked</b> is the median night sold over the last 12 months · click a listing to open its unit page. To change a base price, use Base prices on the property’s page.</p>
      {err ? <LeanEmpty>{err}</LeanEmpty> : !units ? <LeanEmpty>Reading every listing’s base rate…</LeanEmpty> : list.length === 0 ? <LeanEmpty>No listing matches.</LeanEmpty> : (
        <div className="rounded-2xl border border-line bg-white overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted border-b border-line">
              <th className="py-2 pl-4 pr-2 font-semibold">Listing</th><th className="px-2 font-semibold">Building</th><th className="px-2 font-semibold">Size</th>
              <th className="px-2 text-right font-semibold">Base</th><th className="px-2 text-right font-semibold">Weekend</th><th className="px-2 text-right font-semibold">Booked</th><th className="pl-2 pr-4 font-semibold" />
            </tr></thead>
            <tbody>{list.map(u => { const g = gapOf(u); const href = '/listings/' + encodeURIComponent(u.id); return (
              <tr key={u.id} className="border-b border-line/70 last:border-0 hover:bg-app/60">
                <td className="py-0 pl-4 pr-2"><Link href={href} className="block py-2 font-semibold text-ink hover:underline">{u.name || 'Unnamed listing'}</Link></td>
                <td className="px-2 text-muted">{u.building || '—'}</td>
                <td className="px-2 text-muted whitespace-nowrap">{beds(u.bedrooms)}</td>
                <td className="px-2 text-right tabular-nums font-semibold text-ink">{money(u.base)}</td>
                <td className="px-2 text-right tabular-nums text-ink">{money(u.weekendBase)}</td>
                <td className="px-2 text-right tabular-nums text-muted" title={u.basis === 'own' ? u.nights + ' nights sold in the last 12 months' : u.basis === 'building' ? 'Too few nights of its own: the same size in its building' : 'No booked nights to go on'}>{money(u.booked)}{u.basis === 'building' ? '*' : ''}</td>
                <td className="pl-2 pr-4 whitespace-nowrap">{u.base == null ? <Tag tone="rose">No base price</Tag> : g != null && Math.abs(g) >= 0.3 ? <Tag tone="amber" title="Base price against the booked night">{g > 0 ? '+' : '−'}{Math.round(Math.abs(g) * 100)}% vs booked</Tag> : null}</td>
              </tr>) })}</tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted border-t border-line">* too few nights of its own, so the booked figure is the same size of unit in its building.</p>
        </div>
      )}
    </div>
  )
}
