'use client'
// Client UI for the Revenue Center (/revenue). Lens switcher (total / gross accom / net accom /
// cleaning / parking / other fees), KPI strip with prior-period deltas, revenue mix, forward
// pacing, channel mix, struggling-listing board and a sortable per-unit / per-building table.
import { useMemo, useState } from 'react'
import { RangeFilter } from '@/components/RangeFilter'
import type { RevenueData, UnitRow } from '@/app/revenue/page'
import {
  DollarSign, TrendingUp, TrendingDown, BedDouble, Percent, Sparkles, Building2, Ban, Wallet,
  Search, AlertTriangle, CarFront, Layers, ArrowUpDown, ChevronUp, ChevronDown, CalendarClock, Minus
} from 'lucide-react'

type Lens = 'total' | 'gross' | 'net' | 'cleaning' | 'parking' | 'other'
const LENSES: { key: Lens; label: string; note: string }[] = [
  { key: 'total', label: 'Total revenue', note: 'Accommodation + cleaning + parking + other fees' },
  { key: 'gross', label: 'Gross accom', note: 'Room revenue before channel fees (guest-paid)' },
  { key: 'net', label: 'Net accom', note: 'Room revenue after channel/OTA fees' },
  { key: 'cleaning', label: 'Cleaning fees', note: 'Cleaning fees collected (Expedia bundles split out)' },
  { key: 'parking', label: 'Parking fees', note: 'Parking add-ons from reservation invoices' },
  { key: 'other', label: 'Other fees', note: 'Pets, early check-in, resort & misc add-on fees' },
]

function lensOf(u: { grossAccom: number; netAccom: number; cleaning: number; parking: number; other: number; total: number }, l: Lens): number {
  if (l === 'gross') return u.grossAccom
  if (l === 'net') return u.netAccom
  if (l === 'cleaning') return u.cleaning
  if (l === 'parking') return u.parking
  if (l === 'other') return u.other
  return u.total
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`
  return `${sign}$${Math.round(abs).toLocaleString()}`
}
function fmtExact(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString()
}
function pct(n: number): string { return `${Math.round(n * 100)}%` }

function Delta({ cur, prev, money }: { cur: number; prev: number; money?: boolean }) {
  if (!Number.isFinite(prev) || prev === 0) return <span className="text-[11px] text-muted">—</span>
  const d = money ? (cur - prev) / Math.abs(prev) : cur - prev
  const up = d > 0.001, down = d < -0.001
  const cls = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-muted'
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  const label = money ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : `${d > 0 ? '+' : ''}${Math.round(d * 100)}pts`
  return <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${cls}`}><Icon size={11} />{label} vs prior</span>
}

export function RevenueCenter({ data }: { data: RevenueData }) {
  const [lens, setLens] = useState<Lens>('total')
  const [view, setView] = useState<'units' | 'buildings'>('units')
  const [q, setQ] = useState('')
  const [bld, setBld] = useState('all')
  const [mkt, setMkt] = useState('all')
  const [own, setOwn] = useState('all')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [sortKey, setSortKey] = useState('rev')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const d = data
  const lensMeta = LENSES.find(l => l.key === lens)!
  const lensTotal = lensOf(d.totals, lens)
  const adr = d.nightsSold > 0 ? lensTotal / d.nightsSold : 0
  const revpar = d.availableNights > 0 ? lensTotal / d.availableNights : 0
  const occ = d.availableNights > 0 ? d.occupiedNights / d.availableNights : 0
  const prevOcc = d.prev.availableNights > 0 ? d.prev.occupiedNights / d.prev.availableNights : 0
  const prevRev = lens === 'total' ? d.prev.total : lens === 'gross' ? d.prev.grossAccom : NaN
  const prevAdr = Number.isFinite(prevRev) && d.prev.nightsSold > 0 ? prevRev / d.prev.nightsSold : NaN
  const prevRevpar = Number.isFinite(prevRev) && d.prev.availableNights > 0 ? prevRev / d.prev.availableNights : NaN

  const buildings = useMemo(() => {
    const s: string[] = []
    for (const u of d.units) if (s.indexOf(u.building) < 0) s.push(u.building)
    return s.sort()
  }, [d.units])

  const owners = useMemo(() => {
    const s: string[] = []
    for (const u of d.units) if (s.indexOf(u.owner) < 0) s.push(u.owner)
    return s.sort()
  }, [d.units])

  const flagged = useMemo(() => d.units.filter(u => u.flags.length >= 2).sort((a, b) => b.flags.length - a.flags.length || a.total - b.total), [d.units])
  const vacant = useMemo(() => d.units.filter(u => u.nightsSold === 0), [d.units])

  const rows = useMemo(() => {
    let r = d.units
    if (q.trim()) { const t = q.trim().toLowerCase(); r = r.filter(u => u.name.toLowerCase().includes(t) || u.building.toLowerCase().includes(t)) }
    if (bld !== 'all') r = r.filter(u => u.building === bld)
    if (mkt !== 'all') r = r.filter(u => u.market === mkt)
    if (own !== 'all') r = r.filter(u => u.owner === own)
    if (onlyFlagged) r = r.filter(u => u.flags.length >= 2)
    return r
  }, [d.units, q, bld, mkt, own, onlyFlagged])

  type BRow = UnitRow & { unitCount: number }
  const bRows: BRow[] = useMemo(() => {
    const m: Record<string, BRow> = {}
    for (const u of rows) {
      const b = m[u.building] = m[u.building] || { ...u, id: u.building, name: u.building, unitCount: 0, nightsSold: 0, bookings: 0, grossAccom: 0, netAccom: 0, cleaning: 0, parking: 0, other: 0, total: 0, prevTotal: 0, occ: 0, prevOcc: 0, otb30: 0, flags: [] as string[] }
      b.unitCount += 1
      b.nightsSold += u.nightsSold; b.bookings += u.bookings
      b.grossAccom += u.grossAccom; b.netAccom += u.netAccom; b.cleaning += u.cleaning; b.parking += u.parking; b.other += u.other
      b.total += u.total; b.prevTotal += u.prevTotal
      b.occ += u.occ; b.prevOcc += u.prevOcc; b.otb30 += u.otb30
      if (u.flags.length >= 2) b.flags = b.flags.concat([u.name])
    }
    const out = Object.keys(m).map(k => m[k])
    for (const b of out) { b.occ /= b.unitCount; b.prevOcc /= b.unitCount; b.otb30 /= b.unitCount }
    return out
  }, [rows])

  const sorted = useMemo(() => {
    const list: (UnitRow & { unitCount?: number })[] = view === 'units' ? rows.slice() : bRows.slice()
    const val = (u: UnitRow): number | string => {
      if (sortKey === 'name') return u.name.toLowerCase()
      if (sortKey === 'building') return u.building.toLowerCase()
      if (sortKey === 'owner') return u.owner.toLowerCase()
      if (sortKey === 'occ') return u.occ
      if (sortKey === 'nights') return u.nightsSold
      if (sortKey === 'adr') return u.nightsSold > 0 ? lensOf(u, lens) / u.nightsSold : 0
      if (sortKey === 'revpar') return lensOf(u, lens) / d.days
      if (sortKey === 'otb') return u.otb30
      if (sortKey === 'flags') return u.flags.length
      if (sortKey === 'delta') return u.prevTotal > 0 ? (u.total - u.prevTotal) / u.prevTotal : -Infinity
      return lensOf(u, lens)
    }
    list.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number)
      return sortDir === 'asc' ? c : -c
    })
    return list
  }, [rows, bRows, view, sortKey, sortDir, lens, d.days])

  function th(key: string, label: string, right?: boolean) {
    const active = sortKey === key
    return (
      <th className={`px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted whitespace-nowrap cursor-pointer select-none hover:text-ink ${right ? 'text-right' : 'text-left'}`}
        onClick={() => { if (active) setSortDir(s => s === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir(key === 'name' || key === 'building' ? 'asc' : 'desc') } }}>
        <span className="inline-flex items-center gap-0.5">{label}{active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ArrowUpDown size={10} className="opacity-40" />}</span>
      </th>
    )
  }

  const mix = [
    { label: 'Gross accom', v: d.totals.grossAccom, cls: 'bg-brand-600' },
    { label: 'Cleaning', v: d.totals.cleaning, cls: 'bg-brand-400' },
    { label: 'Parking', v: d.totals.parking, cls: 'bg-amber-400' },
    { label: 'Other fees', v: d.totals.other, cls: 'bg-emerald-400' },
  ]
  const mixTotal = d.totals.total || 1
  const chMax = d.channels.reduce((m, c) => Math.max(m, c.revenue), 0) || 1
  const channelFees = d.totals.grossAccom - d.totals.netAccom

  return (
    <>
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><TrendingUp size={13} /> Money</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Revenue Center</h1>
          <p className="text-sm text-muted mt-1">{d.from} to {d.to} · {d.days} days · {d.bookings.toLocaleString()} stays touching the range · revenue prorated per night</p>
        </div>
        <RangeFilter from={d.from} to={d.to} />
      </header>

      {/* Lens switcher */}
      <div className="mb-4 flex items-center gap-1.5 flex-wrap">
        {LENSES.map(l => (
          <button key={l.key} onClick={() => setLens(l.key)}
            className={`text-[12px] font-semibold rounded-lg px-3 py-1.5 border transition-all ${lens === l.key ? 'bg-brand-600 border-brand-600 text-white shadow-sm' : 'bg-white border-line text-muted hover:text-brand-700 hover:border-brand-200'}`}>
            {l.label}
          </button>
        ))}
        <span className="text-[11px] text-muted ml-1">{lensMeta.note}</span>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Kpi label={lensMeta.label} value={fmtMoney(lensTotal)} Icon={DollarSign} accent extra={<Delta cur={lensTotal} prev={prevRev} money />} />
        <Kpi label="ADR" value={fmtMoney(adr)} Icon={TrendingUp} sub="per night sold" extra={<Delta cur={adr} prev={prevAdr} money />} />
        <Kpi label="Occupancy" value={pct(occ)} Icon={Percent} sub={`${d.occupiedNights.toLocaleString()} / ${d.availableNights.toLocaleString()} nights`} extra={<Delta cur={occ} prev={prevOcc} />} />
        <Kpi label="RevPAR" value={fmtMoney(revpar)} Icon={BedDouble} sub="rev / available night" extra={<Delta cur={revpar} prev={prevRevpar} money />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Kpi small label="Gross accom" value={fmtMoney(d.totals.grossAccom)} Icon={DollarSign} />
        <Kpi small label="Net accom" value={fmtMoney(d.totals.netAccom)} Icon={Wallet} sub={`${fmtMoney(channelFees)} channel fees`} />
        <Kpi small label="Cleaning" value={fmtMoney(d.totals.cleaning)} Icon={Sparkles} />
        <Kpi small label="Parking" value={fmtMoney(d.totals.parking)} Icon={CarFront} />
        <Kpi small label="Other fees" value={fmtMoney(d.totals.other)} Icon={Layers} />
        <Kpi small label="Nights sold" value={d.nightsSold.toLocaleString()} Icon={BedDouble} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        {/* Revenue mix */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink mb-1">Revenue mix</h2>
          <p className="text-[12px] text-muted mb-3">Where the money comes from in this range.</p>
          <div className="h-3 rounded-full bg-app overflow-hidden flex mb-3">
            {mix.map((m, i) => m.v > 0 && <div key={i} className={m.cls} style={{ width: `${Math.max(1, (m.v / mixTotal) * 100)}%` }} />)}
          </div>
          <dl className="space-y-1.5 text-[13px]">
            {mix.map((m, i) => (
              <div key={i} className="flex items-center justify-between">
                <dt className="text-muted inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${m.cls}`} /> {m.label}</dt>
                <dd className="font-semibold tabular-nums text-ink">{fmtExact(m.v)} <span className="text-muted font-normal">· {Math.round((m.v / mixTotal) * 100)}%</span></dd>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-line pt-1.5 mt-1.5">
              <dt className="text-ink font-semibold">Total</dt>
              <dd className="font-bold tabular-nums text-ink">{fmtExact(d.totals.total)}</dd>
            </div>
          </dl>
        </section>

        {/* Forward pacing */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><CalendarClock size={14} /> Forward pacing</h2>
          <p className="text-[12px] text-muted mb-3">On-the-books occupancy from today.</p>
          <div className="space-y-3">
            {[{ l: 'Next 30 days', v: d.otb.d30, n: d.otb.nights30 }, { l: 'Next 60 days', v: d.otb.d60, n: d.otb.nights60 }, { l: 'Next 90 days', v: d.otb.d90, n: d.otb.nights90 }].map((r, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className="font-medium text-ink">{r.l}</span>
                  <span className="text-muted tabular-nums">{pct(r.v)} · {r.n.toLocaleString()} nights</span>
                </div>
                <div className="h-2.5 rounded-full bg-app overflow-hidden">
                  <div className={`h-full rounded-full ${r.v < 0.35 ? 'bg-amber-400' : 'bg-gradient-to-r from-brand-500 to-brand-600'}`} style={{ width: `${Math.min(100, Math.max(2, r.v * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[12px] text-muted">Booked revenue next 30d: <span className="font-semibold text-ink tabular-nums">{fmtMoney(d.otb.rev30)}</span></div>
        </section>

        {/* Channel mix */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink mb-1">Channel mix</h2>
          <p className="text-[12px] text-muted mb-3">Prorated revenue by booking source.</p>
          {d.channels.length === 0 ? (
            <div className="text-sm text-muted italic py-4 text-center">No revenue in this range.</div>
          ) : (
            <div className="space-y-2.5">
              {d.channels.slice(0, 6).map((c, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-[13px] mb-1">
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="text-muted tabular-nums">{fmtMoney(c.revenue)} · {c.count} bk · {Math.round((c.revenue / (d.totals.total || 1)) * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-app overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600" style={{ width: `${Math.max(2, (c.revenue / chMax) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Struggling + vacant */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mb-5">
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><AlertTriangle size={14} className="text-amber-500" /> Struggling listings</h2>
            <span className="text-[12px] text-muted">{flagged.length} of {d.units.length} units flagged (2+ signals)</span>
          </div>
          <p className="text-[12px] text-muted mb-3">Signals: below building peers on occupancy/ADR · bottom-10% RevPAR · declining vs prior period · under 50% occupancy · zero forward bookings.</p>
          {flagged.length === 0 ? (
            <div className="text-sm text-muted italic py-4 text-center">Nothing flagged — portfolio is pacing evenly.</div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {flagged.slice(0, 12).map(u => (
                <div key={u.id} className="rounded-xl border border-line bg-app/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-ink truncate">{u.name}</span>
                    <span className="text-[12px] text-muted tabular-nums whitespace-nowrap">{pct(u.occ)} occ · {fmtMoney(u.total)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.flags.map((f, i) => (
                      <span key={i} className="text-[10px] font-medium rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5">{f}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Ban size={14} className="text-red-500" /> Vacant units</h2>
          <p className="text-[12px] text-muted mb-3">{vacant.length} active units sold zero nights in this range.</p>
          {vacant.length === 0 ? (
            <div className="text-sm text-muted italic py-4 text-center">Every active unit sold at least one night.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
              {vacant.map(u => (
                <span key={u.id} className={`text-[11px] font-medium rounded-full border px-2.5 py-1 ${u.otb30 === 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-app border-line text-muted'}`}>
                  {u.name}{u.otb30 === 0 ? ' · no OTB' : ''}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 text-[11px] text-muted">Red = also nothing on the books for the next 30 days. Owner/maintenance blocks aren&apos;t synced yet, so some may be intentionally offline.</div>
        </section>
      </div>

      {/* Performance table */}
      <section className="rounded-2xl border border-line bg-white">
        <div className="p-4 pb-3 flex items-center gap-2 flex-wrap border-b border-line">
          <h2 className="text-sm font-bold text-ink mr-2 inline-flex items-center gap-1.5"><Building2 size={14} /> Listing performance</h2>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or building…"
              className="rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-[13px] text-ink w-52 focus:outline-none focus:border-brand-500" />
          </div>
          <select value={bld} onChange={e => setBld(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:outline-none">
            <option value="all">All buildings</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={mkt} onChange={e => setMkt(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:outline-none">
            <option value="all">All markets</option>
            <option value="Miami">Miami</option>
            <option value="Broward">Broward</option>
            <option value="North">North</option>
          </select>
          <select value={own} onChange={e => setOwn(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:outline-none max-w-[180px]">
            <option value="all">All owners</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={() => setOnlyFlagged(v => !v)}
            className={`text-[12px] font-medium rounded-lg px-2.5 py-1.5 border inline-flex items-center gap-1 ${onlyFlagged ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-line text-muted hover:text-ink'}`}>
            <AlertTriangle size={12} /> Struggling only
          </button>
          <div className="ml-auto inline-flex rounded-lg border border-line overflow-hidden">
            {(['units', 'buildings'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-[12px] font-semibold px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
                {v === 'units' ? 'Units' : 'Buildings'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-app/60">
              <tr>
                {th('name', view === 'units' ? 'Unit' : 'Building')}
                {view === 'units' && th('building', 'Building')}
                {view === 'units' && th('owner', 'Owner')}
                {th('occ', 'Occ', true)}
                {th('nights', 'Nights', true)}
                {th('adr', 'ADR', true)}
                {th('revpar', 'RevPAR', true)}
                {th('gross', 'Gross', true)}
                {th('net', 'Net', true)}
                {th('cleaning', 'Cleaning', true)}
                {th('parking', 'Parking', true)}
                {th('other', 'Other', true)}
                {th('rev', 'Total', true)}
                {th('delta', 'Δ vs prior', true)}
                {th('otb', 'OTB 30d', true)}
                {view === 'units' && th('flags', 'Flags', true)}
              </tr>
            </thead>
            <tbody>
              {sorted.map(u => {
                const uAdr = u.nightsSold > 0 ? lensOf(u, lens) / u.nightsSold : 0
                const uRevpar = lensOf(u, lens) / d.days
                const dRev = u.prevTotal > 0 ? (u.total - u.prevTotal) / u.prevTotal : null
                const struggling = view === 'units' && u.flags.length >= 2
                return (
                  <tr key={u.id} className={`border-t border-line/70 hover:bg-app/40 ${struggling ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-2.5 py-2 font-medium text-ink whitespace-nowrap max-w-[220px] truncate">{u.name}{view === 'buildings' && <span className="text-muted font-normal"> · {(u as any).unitCount} units</span>}</td>
                    {view === 'units' && <td className="px-2.5 py-2 text-muted whitespace-nowrap">{u.building}</td>}
                    {view === 'units' && <td className="px-2.5 py-2 text-muted whitespace-nowrap max-w-[160px] truncate">{u.owner}</td>}
                    <td className={`px-2.5 py-2 text-right tabular-nums font-semibold ${u.occ < 0.5 ? 'text-amber-700' : 'text-ink'}`}>{pct(u.occ)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{u.nightsSold}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-ink">{uAdr > 0 ? fmtExact(uAdr) : '—'}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmtExact(uRevpar)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.grossAccom)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.netAccom)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.cleaning)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{u.parking !== 0 ? fmtMoney(u.parking) : '—'}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-muted">{u.other !== 0 ? fmtMoney(u.other) : '—'}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums font-bold text-ink">{fmtMoney(u.total)}</td>
                    <td className={`px-2.5 py-2 text-right tabular-nums text-[12px] font-semibold ${dRev == null ? 'text-muted' : dRev > 0.001 ? 'text-emerald-600' : dRev < -0.001 ? 'text-red-600' : 'text-muted'}`}>
                      {dRev == null ? '—' : `${dRev > 0 ? '+' : ''}${Math.round(dRev * 100)}%`}
                    </td>
                    <td className={`px-2.5 py-2 text-right tabular-nums ${u.otb30 === 0 ? 'text-red-600 font-semibold' : 'text-muted'}`}>{pct(u.otb30)}</td>
                    {view === 'units' && (
                      <td className="px-2.5 py-2 text-right">
                        {u.flags.length > 0 ? (
                          <span title={u.flags.join('\n')} className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border cursor-help ${u.flags.length >= 3 ? 'bg-red-50 border-red-200 text-red-700' : u.flags.length >= 2 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-app border-line text-muted'}`}>
                            <AlertTriangle size={10} /> {u.flags.length}
                          </span>
                        ) : <span className="text-[11px] text-emerald-600 font-medium">OK</span>}
                      </td>
                    )}
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={16} className="px-4 py-8 text-center text-sm text-muted italic">No listings match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-line text-[11px] text-muted">
          {sorted.length} {view === 'units' ? 'units' : 'buildings'} · ADR &amp; RevPAR follow the selected lens ({lensMeta.label.toLowerCase()}) · hover a flag badge for reasons · Δ compares total revenue to {d.prev.from} – {d.prev.to}
        </div>
      </section>
    </>
  )
}

function Kpi({ label, value, Icon, sub, accent, extra, small }: { label: string; value: any; Icon?: any; sub?: string; accent?: boolean; extra?: any; small?: boolean }) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'border-line bg-white'}`}>
      <div className={`${small ? 'text-lg' : 'text-2xl'} font-bold tabular-nums flex items-center gap-1.5 ${accent ? 'text-brand-700' : 'text-ink'}`}>
        {Icon && <Icon size={small ? 14 : 16} className={accent ? 'text-brand-600' : 'text-muted'} />}{value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
      {extra && <div className="mt-0.5">{extra}</div>}
    </div>
  )
}
