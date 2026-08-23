'use client'
// Revenue Center v3 — STR-style reporting in three tabs:
//   Overview    — headline trio (Occ / ADR / RevPAR, room-revenue basis) + money waterfall
//                 (Gross → OTA fees → Net → Commission → Owner payout) + revenue trend +
//                 forward 90-day pacing + channel mix.
//   Performance — every unit indexed against its BUILDING COMP SET (leave-one-out):
//                 Occ Index, ADR Index, RGI (RevPAR index). 100 = at pace, <90 losing share.
//   Actions     — the daily checks ranked by estimated $/month left on the table.
// The scope bar (search / building / owner / market / struggling) filters every tab.
// Charts: single measure per chart, single brand hue, thin rounded marks, native tooltips.
import { useMemo, useState } from 'react'
import { RangeFilter } from '@/components/RangeFilter'
import type { RevenueData, UnitRow, Rec } from '@/app/revenue/page'
import {
  DollarSign, TrendingUp, TrendingDown, BedDouble, Percent, Sparkles, Building2, Wallet,
  Search, AlertTriangle, CarFront, Layers, ArrowUpDown, ChevronUp, ChevronDown, CalendarClock,
  Minus, Users, ClipboardCheck, X, Filter, Gauge
} from 'lucide-react'

type Tab = 'overview' | 'performance' | 'actions'

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
function mdLabel(iso: string): string {
  const m = Number(iso.slice(5, 7)), dd = Number(iso.slice(8, 10))
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MO[m - 1]} ${dd}`
}

function Delta({ cur, prev, money }: { cur: number; prev: number; money?: boolean }) {
  if (!Number.isFinite(prev) || prev === 0) return <span className="text-[11px] text-muted">—</span>
  const d = money ? (cur - prev) / Math.abs(prev) : cur - prev
  const up = d > 0.001, down = d < -0.001
  const cls = up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-muted'
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  const label = money ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : `${d > 0 ? '+' : ''}${Math.round(d * 100)}pts`
  return <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${cls}`}><Icon size={11} />{label} vs prior</span>
}

const SEV: Record<Rec['severity'], { dot: string; chip: string; label: string }> = {
  red: { dot: 'bg-red-500', chip: 'bg-red-50 border-red-200 text-red-700', label: 'Act today' },
  amber: { dot: 'bg-amber-400', chip: 'bg-amber-50 border-amber-200 text-amber-700', label: 'This week' },
  info: { dot: 'bg-brand-400', chip: 'bg-brand-50 border-brand-200 text-brand-700', label: 'Watch' },
}

// Index chip: 100 = at pace with the comp set. Status colors carry state, value is the label.
function IdxChip({ v }: { v: number | null }) {
  if (v == null) return <span className="text-[11px] text-muted">—</span>
  const cls = v >= 100 ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : v >= 90 ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-red-50 border-red-200 text-red-700'
  return <span className={`inline-block min-w-[38px] text-center text-[11px] font-semibold rounded-full border px-1.5 py-0.5 tabular-nums ${cls}`}>{Math.round(v)}</span>
}

// ---- Revenue trend: one measure (total collected $), thin rounded bars, weekly rollup on long ranges ----
function RevTrend({ daily }: { daily: { d: string; rev: number; nights: number }[] }) {
  const pts = useMemo(() => {
    if (daily.length <= 62) return daily.map(x => ({ label: mdLabel(x.d), rev: x.rev, nights: x.nights, span: 1 }))
    const out: { label: string; rev: number; nights: number; span: number }[] = []
    for (let i = 0; i < daily.length; i += 7) {
      const wk = daily.slice(i, i + 7)
      out.push({ label: `wk of ${mdLabel(wk[0].d)}`, rev: wk.reduce((s, x) => s + x.rev, 0), nights: wk.reduce((s, x) => s + x.nights, 0), span: wk.length })
    }
    return out
  }, [daily])
  const W = 720, H = 150, padB = 18, padT = 14
  const max = Math.max(1, ...pts.map(p => p.rev))
  const n = pts.length
  const gap = n > 90 ? 1 : 2
  const bw = Math.max(2, (W - n * gap) / n)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Revenue by day">
      {[0.5, 1].map(f => (
        <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" className="text-line" strokeWidth={1} opacity={0.6} />
      ))}
      <text x={2} y={y(max) - 4} className="fill-current text-muted" fontSize={10}>{fmtMoney(max)}{pts[0] && pts[0].span > 1 ? ' / wk' : ' / day'}</text>
      {pts.map((p, i) => (
        <rect key={i} x={i * (bw + gap)} y={y(p.rev)} width={bw} height={Math.max(1, H - padB - y(p.rev))} rx={Math.min(2, bw / 2)}
          fill="currentColor" className="text-brand-500 hover:text-brand-700">
          <title>{`${p.label} · ${fmtExact(p.rev)} · ${p.nights.toLocaleString()} nights`}</title>
        </rect>
      ))}
      <text x={2} y={H - 5} className="fill-current text-muted" fontSize={10}>{pts[0]?.label}</text>
      <text x={W - 2} y={H - 5} textAnchor="end" className="fill-current text-muted" fontSize={10}>{pts[n - 1]?.label}</text>
    </svg>
  )
}

// ---- Forward pacing: booked occupancy per day for the next 90 days ----
function PaceChart({ fwdDaily, activeUnits }: { fwdDaily: { d: string; nights: number }[]; activeUnits: number }) {
  const W = 720, H = 150, padB = 18, padT = 10
  const n = fwdDaily.length || 1
  const x = (i: number) => (i / Math.max(1, n - 1)) * W
  const y = (occ: number) => padT + (H - padT - padB) * (1 - Math.min(1, occ))
  const occs = fwdDaily.map(p => (activeUnits > 0 ? p.nights / activeUnits : 0))
  const line = occs.map((o, i) => `${x(i).toFixed(1)},${y(o).toFixed(1)}`).join(' ')
  const area = `0,${H - padB} ${line} ${W},${H - padB}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Forward booked occupancy, next 90 days">
      {[0.5, 1].map(f => (
        <line key={f} x1={0} x2={W} y1={y(f)} y2={y(f)} stroke="currentColor" className="text-line" strokeWidth={1} opacity={0.6} />
      ))}
      <text x={2} y={y(1) - 2} className="fill-current text-muted" fontSize={10}>100%</text>
      <text x={2} y={y(0.5) - 2} className="fill-current text-muted" fontSize={10}>50%</text>
      <polygon points={area} fill="currentColor" className="text-brand-500" opacity={0.12} />
      <polyline points={line} fill="none" stroke="currentColor" className="text-brand-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {fwdDaily.map((p, i) => (
        <rect key={i} x={x(i) - W / n / 2} y={0} width={W / n} height={H - padB} fill="transparent">
          <title>{`${mdLabel(p.d)} · ${pct(activeUnits > 0 ? p.nights / activeUnits : 0)} booked · ${p.nights} nights`}</title>
        </rect>
      ))}
      {[0, 30, 60, 89].map(i => fwdDaily[i] && (
        <text key={i} x={x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === 89 ? 'end' : 'middle'} className="fill-current text-muted" fontSize={10}>
          {i === 0 ? 'Today' : `+${i + 1 === 90 ? 90 : i}d`}
        </text>
      ))}
    </svg>
  )
}

// ---- Money waterfall row ----
function FlowRow({ label, value, base, kind, note }: { label: string; value: number; base: number; kind: 'base' | 'minus' | 'sub' | 'total' | 'plus'; note?: string }) {
  const w = base > 0 ? Math.min(100, (Math.abs(value) / base) * 100) : 0
  const bar = kind === 'minus' ? 'bg-ink/15' : kind === 'plus' ? 'bg-brand-300' : kind === 'total' ? 'bg-emerald-500' : 'bg-brand-600'
  const strong = kind === 'base' || kind === 'sub' || kind === 'total'
  // PHONE: a 176px label + a 96px number left about seven pixels of bar on a 375px screen, so the
  // waterfall had no waterfall in it. Below 640px the label and the money share the first line and
  // the bar gets the whole of the second; from 640px it is the original single row.
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 py-[5px]">
      <div className={`min-w-0 sm:w-44 sm:shrink-0 text-[13px] ${strong ? 'font-semibold text-ink' : 'text-muted'}`}>{kind === 'minus' ? '−  ' : kind === 'plus' ? '+  ' : ''}{label}</div>
      <div className="order-last sm:order-none w-full sm:w-auto sm:flex-1 h-3 rounded-full bg-app overflow-hidden"><div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(value !== 0 ? 1.5 : 0, w)}%` }} /></div>
      <div className={`ml-auto sm:ml-0 w-24 shrink-0 text-right tabular-nums text-[13px] ${strong ? 'font-bold text-ink' : 'text-muted'}`}>{kind === 'minus' ? `−${fmtExact(Math.abs(value))}` : fmtExact(value)}</div>
      {note && <div className="hidden xl:block w-40 shrink-0 text-[11px] text-muted truncate">{note}</div>}
    </div>
  )
}

export function RevenueCenter({ data }: { data: RevenueData }) {
  const d = data
  const [tab, setTab] = useState<Tab>('overview')
  const [view, setView] = useState<'units' | 'buildings' | 'owners'>('units')
  const [q, setQ] = useState('')
  const [bld, setBld] = useState('all')
  const [mkt, setMkt] = useState('all')
  const [own, setOwn] = useState('all')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [showMoney, setShowMoney] = useState(false)
  const [sortKey, setSortKey] = useState('rgi')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  // ---- building comp sets from ALL units (a filter must not shrink the comp set) ----
  const comps = useMemo(() => {
    const agg: Record<string, { count: number; nights: number; gross: number }> = {}
    let pNights = 0, pGross = 0, pCount = 0
    for (const u of d.units) {
      const a = agg[u.building] = agg[u.building] || { count: 0, nights: 0, gross: 0 }
      a.count += 1; a.nights += u.nightsSold; a.gross += u.grossAccom
      pCount += 1; pNights += u.nightsSold; pGross += u.grossAccom
    }
    return { agg, portfolio: { count: pCount, nights: pNights, gross: pGross } }
  }, [d.units])

  // Leave-one-out indices vs the unit's building peers (needs 3+ units in the building).
  const idxOf = useMemo(() => {
    const cache: Record<string, { occ: number | null; adr: number | null; rgi: number | null }> = {}
    for (const u of d.units) {
      const b = comps.agg[u.building]
      if (!b || b.count < 3 || d.days <= 0) { cache[u.id] = { occ: null, adr: null, rgi: null }; continue }
      const peerNights = b.nights - u.nightsSold
      const peerGross = b.gross - u.grossAccom
      const peerAvail = (b.count - 1) * d.days
      const peerOcc = peerAvail > 0 ? peerNights / peerAvail : 0
      const peerAdr = peerNights > 0 ? peerGross / peerNights : 0
      const peerRevpar = peerAvail > 0 ? peerGross / peerAvail : 0
      const uAdr = u.nightsSold > 0 ? u.grossAccom / u.nightsSold : 0
      cache[u.id] = {
        occ: peerOcc > 0.02 ? (u.occ / peerOcc) * 100 : null,
        adr: peerAdr > 0 && uAdr > 0 ? (uAdr / peerAdr) * 100 : null,
        rgi: peerRevpar > 0 ? (u.grossAccom / d.days / peerRevpar) * 100 : null,
      }
    }
    return cache
  }, [d.units, d.days, comps])

  // ---- global scope filter ----
  const filtered = useMemo(() => {
    let r = d.units
    if (q.trim()) { const t = q.trim().toLowerCase(); r = r.filter(u => u.name.toLowerCase().includes(t) || u.building.toLowerCase().includes(t) || u.owner.toLowerCase().includes(t)) }
    if (bld !== 'all') r = r.filter(u => u.building === bld)
    if (mkt !== 'all') r = r.filter(u => u.market === mkt)
    if (own !== 'all') r = r.filter(u => u.owner === own)
    if (onlyFlagged) r = r.filter(u => u.flags.length >= 2)
    return r
  }, [d.units, q, bld, mkt, own, onlyFlagged])

  const filterCount = (q.trim() ? 1 : 0) + (bld !== 'all' ? 1 : 0) + (mkt !== 'all' ? 1 : 0) + (own !== 'all' ? 1 : 0) + (onlyFlagged ? 1 : 0)
  const scoped = filterCount > 0
  const scopeLabel = scoped
    ? [own !== 'all' ? own : '', bld !== 'all' ? bld : '', mkt !== 'all' ? mkt : '', q.trim() ? `"${q.trim()}"` : '', onlyFlagged ? 'struggling' : ''].filter(Boolean).join(' · ')
    : 'Whole portfolio'
  function clearFilters() { setQ(''); setBld('all'); setMkt('all'); setOwn('all'); setOnlyFlagged(false) }
  function focusUnit(name: string) { clearFilters(); setQ(name); setTab('performance'); setView('units') }

  // ---- KPIs from the filtered scope ----
  const k = useMemo(() => {
    let nights = 0, gross = 0, net = 0, cleaning = 0, parking = 0, other = 0, commission = 0, total = 0, prevTotal = 0, prevNights = 0, otbN = 0
    for (const u of filtered) {
      nights += u.nightsSold; gross += u.grossAccom; net += u.netAccom; cleaning += u.cleaning; commission += u.commission
      parking += u.parking; other += u.other; total += u.total
      prevTotal += u.prevTotal; prevNights += u.prevOcc * d.days; otbN += u.otb30 * 30
    }
    const avail = filtered.length * d.days
    return {
      nights, gross, net, cleaning, parking, other, commission, total, avail,
      occ: avail > 0 ? nights / avail : 0,
      prevOcc: avail > 0 ? prevNights / avail : 0,
      adr: nights > 0 ? gross / nights : 0,           // room-revenue basis (STR convention)
      revpar: avail > 0 ? gross / avail : 0,
      adrT: nights > 0 ? total / nights : 0,
      revparT: avail > 0 ? total / avail : 0,
      prevAdr: prevNights > 0 ? prevTotal / prevNights : NaN,
      prevRevparT: avail > 0 ? prevTotal / avail : NaN,
      prevTotal,
      otb30: filtered.length > 0 ? otbN / (filtered.length * 30) : 0,
    }
  }, [filtered, d.days])

  // ---- grouped rows for Buildings / Owners views (indexed vs whole portfolio) ----
  type GRow = UnitRow & { unitCount: number }
  const grouped: GRow[] = useMemo(() => {
    if (view === 'units') return filtered as GRow[]
    const keyOf = (u: UnitRow) => (view === 'buildings' ? u.building : u.owner)
    const m: Record<string, GRow> = {}
    for (const u of filtered) {
      const key = keyOf(u)
      const g = m[key] = m[key] || { ...u, id: key, name: key, unitCount: 0, nightsSold: 0, bookings: 0, grossAccom: 0, netAccom: 0, cleaning: 0, parking: 0, other: 0, commission: 0, total: 0, prevTotal: 0, occ: 0, prevOcc: 0, otb30: 0, flags: [] as string[] }
      g.unitCount += 1
      g.nightsSold += u.nightsSold; g.bookings += u.bookings
      g.grossAccom += u.grossAccom; g.netAccom += u.netAccom; g.cleaning += u.cleaning; g.parking += u.parking; g.other += u.other; g.commission += u.commission
      g.total += u.total; g.prevTotal += u.prevTotal
      g.occ += u.occ; g.prevOcc += u.prevOcc; g.otb30 += u.otb30
      if (u.flags.length >= 2) g.flags = g.flags.concat([u.name])
    }
    const out = Object.keys(m).map(kk => m[kk])
    for (const g of out) { g.occ /= g.unitCount; g.prevOcc /= g.unitCount; g.otb30 /= g.unitCount }
    return out
  }, [filtered, view])

  // Indices for a row (unit rows use building comp set; grouped rows index vs portfolio).
  const rowIdx = (u: GRow): { occ: number | null; adr: number | null; rgi: number | null } => {
    if (view === 'units') return idxOf[u.id] || { occ: null, adr: null, rgi: null }
    const p = comps.portfolio
    if (p.count === 0 || d.days <= 0) return { occ: null, adr: null, rgi: null }
    const pOcc = p.nights / (p.count * d.days)
    const pAdr = p.nights > 0 ? p.gross / p.nights : 0
    const pRevpar = p.gross / (p.count * d.days)
    const uAdr = u.nightsSold > 0 ? u.grossAccom / u.nightsSold : 0
    const uRevpar = u.grossAccom / (u.unitCount * d.days)
    return {
      occ: pOcc > 0.02 ? (u.occ / pOcc) * 100 : null,
      adr: pAdr > 0 && uAdr > 0 ? (uAdr / pAdr) * 100 : null,
      rgi: pRevpar > 0 ? (uRevpar / pRevpar) * 100 : null,
    }
  }

  const sorted = useMemo(() => {
    const list = grouped.slice()
    const val = (u: GRow): number | string => {
      const ix = rowIdx(u)
      if (sortKey === 'name') return u.name.toLowerCase()
      if (sortKey === 'building') return u.building.toLowerCase()
      if (sortKey === 'owner') return u.owner.toLowerCase()
      if (sortKey === 'occ') return u.occ
      if (sortKey === 'nights') return u.nightsSold
      if (sortKey === 'adr') return u.nightsSold > 0 ? u.grossAccom / u.nightsSold : 0
      if (sortKey === 'revpar') return u.grossAccom / ((view === 'units' ? 1 : u.unitCount) * d.days)
      if (sortKey === 'occIdx') return ix.occ ?? (sortDir === 'asc' ? 9999 : -1)
      if (sortKey === 'adrIdx') return ix.adr ?? (sortDir === 'asc' ? 9999 : -1)
      if (sortKey === 'rgi') return ix.rgi ?? (sortDir === 'asc' ? 9999 : -1)
      if (sortKey === 'otb') return u.otb30
      if (sortKey === 'flags') return u.flags.length
      if (sortKey === 'delta') return u.prevTotal > 0 ? (u.total - u.prevTotal) / u.prevTotal : -Infinity
      if (sortKey === 'gross') return u.grossAccom
      if (sortKey === 'net') return u.netAccom
      if (sortKey === 'commission') return u.commission
      if (sortKey === 'payout') return u.netAccom - u.commission
      if (sortKey === 'cleaning') return u.cleaning
      if (sortKey === 'parking') return u.parking
      if (sortKey === 'other') return u.other
      return u.total
    }
    list.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number)
      return sortDir === 'asc' ? c : -c
    })
    return list
  }, [grouped, sortKey, sortDir, view, d.days, idxOf, comps])

  function th(key: string, label: string, right?: boolean, hint?: string) {
    const active = sortKey === key
    return (
      <th key={key} title={hint} className={`px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted whitespace-nowrap cursor-pointer select-none hover:text-ink ${right ? 'text-right' : 'text-left'}`}
        onClick={() => { if (active) setSortDir(s => s === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir(key === 'name' || key === 'building' || key === 'owner' || key === 'rgi' || key === 'occIdx' || key === 'adrIdx' ? 'asc' : 'desc') } }}>
        <span className="inline-flex items-center gap-0.5">{label}{active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ArrowUpDown size={10} className="opacity-40" />}</span>
      </th>
    )
  }

  const chMax = d.channels.reduce((m, c) => Math.max(m, c.revenue), 0) || 1
  const selCls = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:border-brand-500'
  const redCount = d.recs.filter(r => r.severity === 'red').length
  const totalOpportunity = d.recs.reduce((s, r) => s + r.impact, 0)
  const laggards = useMemo(() => filtered
    .map(u => ({ u, rgi: (idxOf[u.id] || { rgi: null }).rgi }))
    .filter(x => x.rgi != null && (x.rgi as number) < 90)
    .sort((a, b) => (a.rgi as number) - (b.rgi as number)), [filtered, idxOf])

  const TABS: { key: Tab; label: string; Icon: any; badge?: number }[] = [
    { key: 'overview', label: 'Overview', Icon: Gauge },
    { key: 'performance', label: 'Performance', Icon: Building2 },
    { key: 'actions', label: 'Actions', Icon: ClipboardCheck, badge: redCount },
  ]

  return (
    <>
      <header className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><TrendingUp size={13} /> Money</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Revenue Center</h1>
          <p className="text-sm text-muted mt-1">{d.from} to {d.to} · {d.days} days · prorated per night · Δ vs {d.prev.from} – {d.prev.to}</p>
        </div>
        {/* Two date fields and six presets wrapped to three rows on a phone. One swipeable strip
            instead — the dates lead it, so they are still there without a swipe. `sm:contents`
            dissolves this wrapper above 640px, so the desktop header is untouched. */}
        <div className="lh-actions sm:contents"><RangeFilter from={d.from} to={d.to} /></div>
      </header>

      {/* Scope bar — filters every tab */}
      <div className="mb-3 rounded-2xl border border-line bg-white px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted"><Filter size={12} /> Scope</span>
        {/* On a phone the scope search wraps onto its own line — give it that whole line. */}
        <div className="relative w-full sm:w-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit, building or owner…"
            className="rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-[13px] text-ink w-full sm:w-52 focus:outline-none focus:border-brand-500" />
        </div>
        {/* Everything after the search was four more wrapped rows on a phone; one strip instead. */}
        <div className="lh-actions sm:contents flex items-center gap-2">
        <select value={bld} onChange={e => setBld(e.target.value)} className={selCls}>
          <option value="all">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={own} onChange={e => setOwn(e.target.value)} className={selCls + ' max-w-[180px]'}>
          <option value="all">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={mkt} onChange={e => setMkt(e.target.value)} className={selCls}>
          <option value="all">All markets</option>
          <option value="Miami">Miami</option>
          <option value="Broward">Broward</option>
          <option value="North">North</option>
        </select>
        <button onClick={() => setOnlyFlagged(v => !v)}
          className={`text-[12px] font-medium rounded-lg px-2.5 py-1.5 border inline-flex items-center gap-1 ${onlyFlagged ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-line text-muted hover:text-ink'}`}>
          <AlertTriangle size={12} /> Struggling only
        </button>
        <div className="ml-auto inline-flex items-center gap-2">
          <span className={`text-[12px] font-medium rounded-full px-2.5 py-1 border ${scoped ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-app border-line text-muted'}`}>
            {scopeLabel} · {filtered.length} unit{filtered.length === 1 ? '' : 's'}
          </span>
          {scoped && (
            <button onClick={clearFilters} className="text-[12px] text-muted hover:text-ink inline-flex items-center gap-0.5"><X size={12} /> Clear</button>
          )}
        </div>
        </div>
      </div>

      {/* Tabs — the three of them are wider than a phone screen. Below 640px they ride one
          swipeable line instead of stacking two rows above the first number. */}
      <div className="lh-actions mb-5 flex flex-wrap items-center gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-4 py-2 border transition-all ${tab === t.key ? 'bg-ink text-white border-ink shadow-sm' : 'bg-white border-line text-muted hover:text-ink'}`}>
            <t.Icon size={14} /> {t.label}
            {t.badge ? <span className="ml-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white px-1.5 py-0.5">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ============================== OVERVIEW ============================== */}
      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <Kpi label="Total collected" value={fmtMoney(k.total)} Icon={DollarSign} accent
              sub={`${k.nights.toLocaleString()} nights · ${fmtExact(k.adrT)} / night all-in`}
              extra={<Delta cur={k.total} prev={k.prevTotal} money />} />
            <Kpi label="Occupancy" value={pct(k.occ)} Icon={Percent}
              sub={`${k.nights.toLocaleString()} of ${k.avail.toLocaleString()} available nights`}
              extra={<Delta cur={k.occ} prev={k.prevOcc} />} />
            <Kpi label="ADR" value={fmtExact(k.adr)} Icon={TrendingUp}
              sub="room revenue per night sold"
              extra={<Delta cur={k.adrT} prev={k.prevAdr} money />} />
            <Kpi label="RevPAR" value={fmtExact(k.revpar)} Icon={BedDouble}
              sub="room revenue per available night"
              extra={<Delta cur={k.revparT} prev={k.prevRevparT} money />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
            {/* Money flow — statement-validated waterfall */}
            <section className="lg:col-span-3 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink mb-0.5 inline-flex items-center gap-1.5"><Wallet size={14} className="text-brand-600" /> Where the money goes <span className="text-[10px] font-semibold text-muted uppercase tracking-wider ml-1">{scoped ? 'scoped' : 'portfolio'}</span></h2>
              <p className="text-[12px] text-muted mb-3">Statement-validated: matches Guesty owner statements to the penny. Taxes excluded.</p>
              <FlowRow label="Gross accommodation" value={k.gross} base={k.gross} kind="base" note="guest-paid room rate" />
              <FlowRow label="OTA channel fees" value={-(k.gross - k.net)} base={k.gross} kind="minus" note={k.gross > 0 ? `${Math.round(((k.gross - k.net) / k.gross) * 100)}% of gross` : undefined} />
              <FlowRow label="Net accommodation" value={k.net} base={k.gross} kind="sub" note="owner-statement rental income" />
              <FlowRow label="Our commission" value={-k.commission} base={k.gross} kind="minus" note={k.net > 0 ? `${Math.round((k.commission / k.net) * 100)}% of net` : undefined} />
              <FlowRow label="Owner payout" value={k.net - k.commission} base={k.gross} kind="total" note="before expenses & reimbursements" />
              <div className="border-t border-line mt-2 pt-2">
                <FlowRow label="Cleaning fees" value={k.cleaning} base={k.gross} kind="plus" />
                {k.parking !== 0 && <FlowRow label="Parking fees" value={k.parking} base={k.gross} kind="plus" />}
                {k.other !== 0 && <FlowRow label="Other fees" value={k.other} base={k.gross} kind="plus" />}
                <FlowRow label="Total collected" value={k.total} base={k.gross} kind="base" note="gross accom + fees" />
              </div>
            </section>

            {/* Channel mix */}
            <section className="lg:col-span-2 rounded-2xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink mb-0.5">Channel mix <span className="text-[10px] font-semibold text-muted uppercase tracking-wider ml-1">portfolio</span></h2>
              <p className="text-[12px] text-muted mb-3">Prorated revenue by booking source. Cancel = cancelled ÷ guest bookings in this range — owner and friends-&amp;-family holds are excluded from both sides, and a channel with too few bookings to be meaningful shows no rate at all.</p>
              {d.channels.length === 0 ? (
                <div className="text-sm text-muted italic py-4 text-center">No revenue in this range.</div>
              ) : (
                <div className="space-y-2.5">
                  {d.channels.slice(0, 6).map((c, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between text-[13px] mb-1">
                        <span className="font-medium text-ink">{c.name}</span>
                        <span className="text-muted tabular-nums">
                          {fmtMoney(c.revenue)} · {Math.round((c.revenue / (d.totals.total || 1)) * 100)}%
                          {c.cancelRate != null && (
                            <span
                              className={(c.cancelRate >= 0.2 ? 'text-rose-600' : c.cancelRate >= 0.1 ? 'text-amber-600' : 'text-muted') + ' ml-1'}
                              title={`${c.cancelled} of ${c.cancelSample} guest bookings on ${c.name} cancelled in this range` + (c.ownerHolds ? ` · ${c.ownerHolds} owner/F&F booking${c.ownerHolds > 1 ? 's' : ''} excluded` : '')}
                            >
                              · {Math.round(c.cancelRate * 100)}% cancel
                            </span>
                          )}
                          {c.cancelRate == null && c.cancelSample > 0 && (
                            <span className="ml-1 text-muted/70" title={`Only ${c.cancelSample} guest booking${c.cancelSample > 1 ? 's' : ''} on ${c.name} in this range — too few to quote a cancel rate.`}>
                              · cancel n/a
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-app overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (c.revenue / chMax) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-line grid grid-cols-3 gap-2 text-center">
                {[{ l: 'OTB 30d', v: pct(d.otb.d30) }, { l: 'OTB 60d', v: pct(d.otb.d60) }, { l: 'OTB 90d', v: pct(d.otb.d90) }].map((s, i) => (
                  <div key={i}>
                    <div className="text-lg font-bold tabular-nums text-ink">{s.v}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{s.l}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-line bg-white p-5 mb-4">
            <h2 className="text-sm font-bold text-ink mb-0.5">Revenue trend <span className="text-[10px] font-semibold text-muted uppercase tracking-wider ml-1">portfolio · {d.daily.length > 62 ? 'weekly' : 'daily'}</span></h2>
            <p className="text-[12px] text-muted mb-2">Total collected per {d.daily.length > 62 ? 'week' : 'day'} across the selected range. Hover any bar.</p>
            {/* The chart is drawn in a 720-wide viewBox. Scaled into 330px of phone the axis
                labels land at about four pixels and a daily bar is under a pixel wide — so on a
                phone it keeps a real width and scrolls sideways in its own box instead. */}
            <div className="lh-hscroll -mx-5 px-5 sm:mx-0 sm:px-0">
              <div className="min-w-[560px] sm:min-w-0"><RevTrend daily={d.daily} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5 mb-4">
            <h2 className="text-sm font-bold text-ink mb-0.5 inline-flex items-center gap-1.5"><CalendarClock size={14} className="text-brand-600" /> Forward pacing <span className="text-[10px] font-semibold text-muted uppercase tracking-wider ml-1">portfolio · next 90 days</span></h2>
            <p className="text-[12px] text-muted mb-2">Booked occupancy by night from today · booked revenue next 30d: <span className="font-semibold text-ink tabular-nums">{fmtMoney(d.otb.rev30)}</span></p>
            {/* Same 720-wide viewBox as the trend chart — see the note there. */}
            <div className="lh-hscroll -mx-5 px-5 sm:mx-0 sm:px-0">
              <div className="min-w-[560px] sm:min-w-0"><PaceChart fwdDaily={d.fwdDaily} activeUnits={d.activeUnits} /></div>
            </div>
          </section>

          {/* Revenue leakage — refunds/comps logged on guest-issue cards, rolled into the money view. */}
          <section className="rounded-2xl border border-line bg-white p-5 mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-0.5">
              <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><TrendingDown size={14} className="text-rose-600" /> Revenue leakage <span className="text-[10px] font-semibold text-muted uppercase tracking-wider ml-1">refunds &amp; comps · this range</span></h2>
              <div className="text-right">
                <div className="text-2xl font-extrabold text-rose-700 tabular-nums leading-none">{fmtExact(d.leakage.total)}</div>
                <div className="text-[11px] text-muted mt-0.5">{d.leakage.count} refund{d.leakage.count === 1 ? '' : 's'} · {d.leakage.pctOfGross}% of gross{d.leakage.fixCost > 0 ? ` · ${fmtExact(d.leakage.fixCost)} fix cost` : ''}</div>
              </div>
            </div>
            <p className="text-[12px] text-muted mb-3">Guest-issue refunds logged on the board, rolled into the money view — where the portfolio is giving revenue back, by building and by cause.</p>
            {d.leakage.count === 0 ? (
              <div className="text-[13px] text-emerald-700">No refunds logged in this range.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">By building</div>
                  <div>
                    {d.leakage.byBuilding.map(b => (
                      <div key={b.building} className="flex items-center justify-between gap-2 text-[13px] border-b border-line/60 py-1.5">
                        <span className="text-ink truncate">{b.building}</span>
                        <span className="text-muted shrink-0"><b className="text-rose-700 tabular-nums">{fmtExact(b.amount)}</b> · {b.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">By cause</div>
                  <div>
                    {d.leakage.byCause.map(c => (
                      <div key={c.cause} className="flex items-center justify-between gap-2 text-[13px] border-b border-line/60 py-1.5">
                        <span className="text-ink truncate capitalize">{c.cause}</span>
                        <span className="text-muted shrink-0"><b className="text-rose-700 tabular-nums">{fmtExact(c.amount)}</b> · {c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* ============================== PERFORMANCE ============================== */}
      {tab === 'performance' && (
        <>
          <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-[12px] text-brand-800">
            <span className="font-semibold">How to read this:</span> every unit is indexed against its <span className="font-semibold">building comp set</span> (the other units in the same building). <span className="font-semibold">100 = at pace</span> · above 100 = winning share · <span className="font-semibold">below 90 = losing share</span>. RGI is the RevPAR index — the single "how are we doing" number. ADR & RevPAR use room revenue. Buildings & Owners views index against the whole portfolio.
          </div>
          <section className="rounded-2xl border border-line bg-white">
            <div className="p-4 pb-3 flex items-center gap-2 flex-wrap border-b border-line">
              <div className="lh-actions sm:contents flex items-center gap-2">
              <h2 className="text-sm font-bold text-ink mr-1 inline-flex items-center gap-1.5">
                {view === 'owners' ? <Users size={14} /> : <Building2 size={14} />} Performance
              </h2>
              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                {(['units', 'buildings', 'owners'] as const).map(v => (
                  <button key={v} onClick={() => setView(v)}
                    className={`text-[12px] font-semibold px-3 py-1.5 ${view === v ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
                    {v === 'units' ? 'Units' : v === 'buildings' ? 'Buildings' : 'Owners'}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowMoney(v => !v)}
                className={`text-[12px] font-medium rounded-lg px-2.5 py-1.5 border inline-flex items-center gap-1 ${showMoney ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-line text-muted hover:text-ink'}`}>
                <Layers size={12} /> {showMoney ? 'Hide money detail' : 'Show money detail'}
              </button>
              </div>
              {/* The count/sort line stays out of the strip — it is a caption, not a control. */}
              <span className="ml-auto text-[12px] text-muted">{sorted.length} {view === 'units' ? 'units' : view === 'buildings' ? 'buildings' : 'owners'} · sorted by {sortKey === 'rgi' ? 'biggest opportunity' : sortKey}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-app/60">
                  <tr>
                    {th('name', view === 'units' ? 'Unit' : view === 'buildings' ? 'Building' : 'Owner')}
                    {view === 'units' && th('building', 'Building')}
                    {view === 'units' && th('owner', 'Owner')}
                    {th('occ', 'Occ', true)}
                    {th('adr', 'ADR', true, 'Room revenue per night sold')}
                    {th('revpar', 'RevPAR', true, 'Room revenue per available night')}
                    {th('occIdx', 'Occ idx', true, 'Occupancy vs comp set · 100 = at pace')}
                    {th('adrIdx', 'ADR idx', true, 'Rate vs comp set · 100 = at pace')}
                    {th('rgi', 'RGI', true, 'RevPAR index vs comp set — the headline score')}
                    {showMoney && th('gross', 'Gross', true)}
                    {showMoney && th('net', 'Net', true)}
                    {showMoney && th('commission', 'Comm', true)}
                    {showMoney && th('payout', 'Payout', true)}
                    {showMoney && th('cleaning', 'Cleaning', true)}
                    {showMoney && th('parking', 'Parking', true)}
                    {showMoney && th('other', 'Other', true)}
                    {th('rev', 'Total', true)}
                    {th('delta', 'Δ vs prior', true)}
                    {th('otb', 'OTB 30d', true)}
                    {view === 'units' && th('flags', 'Flags', true)}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(u => {
                    const ix = rowIdx(u)
                    const uAdr = u.nightsSold > 0 ? u.grossAccom / u.nightsSold : 0
                    const uRevpar = u.grossAccom / ((view === 'units' ? 1 : u.unitCount) * d.days)
                    const dRev = u.prevTotal > 0 ? (u.total - u.prevTotal) / u.prevTotal : null
                    const struggling = view === 'units' && u.flags.length >= 2
                    return (
                      <tr key={u.id} className={`border-t border-line/70 odd:bg-app/20 hover:bg-app/40 ${struggling ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-2.5 py-2 font-medium text-ink whitespace-nowrap max-w-[220px] truncate">{u.name}{view !== 'units' && <span className="text-muted font-normal"> · {(u as any).unitCount} units</span>}</td>
                        {view === 'units' && <td className="px-2.5 py-2 text-muted whitespace-nowrap">{u.building}</td>}
                        {view === 'units' && <td className="px-2.5 py-2 text-muted whitespace-nowrap max-w-[160px] truncate">{u.owner}</td>}
                        <td className={`px-2.5 py-2 text-right tabular-nums font-semibold ${u.occ < 0.5 ? 'text-amber-700' : 'text-ink'}`}>{pct(u.occ)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-ink">{uAdr > 0 ? fmtExact(uAdr) : '—'}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-ink">{fmtExact(uRevpar)}</td>
                        <td className="px-2.5 py-2 text-right"><IdxChip v={ix.occ} /></td>
                        <td className="px-2.5 py-2 text-right"><IdxChip v={ix.adr} /></td>
                        <td className="px-2.5 py-2 text-right"><IdxChip v={ix.rgi} /></td>
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.grossAccom)}</td>}
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.netAccom)}</td>}
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.commission)}</td>}
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.netAccom - u.commission)}</td>}
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{fmtMoney(u.cleaning)}</td>}
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{u.parking !== 0 ? fmtMoney(u.parking) : '—'}</td>}
                        {showMoney && <td className="px-2.5 py-2 text-right tabular-nums text-muted">{u.other !== 0 ? fmtMoney(u.other) : '—'}</td>}
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
                    <tr><td colSpan={21} className="px-4 py-8 text-center text-sm text-muted italic">No listings match this scope.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-line text-[11px] text-muted">
              Indices need 3+ units in the building; smaller buildings show —. Default sort surfaces the biggest opportunities first (lowest RGI). Δ compares total revenue to {d.prev.from} – {d.prev.to}. Hover a flag badge for reasons.
            </div>
          </section>
        </>
      )}

      {/* ============================== ACTIONS ============================== */}
      {tab === 'actions' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Kpi label="Estimated opportunity" value={fmtMoney(totalOpportunity)} Icon={DollarSign} accent sub="per month, across all checks below" />
            <Kpi label="Act today" value={String(redCount)} Icon={AlertTriangle} sub="checks needing action now" />
            <Kpi label="Units losing share" value={String(laggards.length)} Icon={TrendingDown} sub="RGI under 90 vs building peers" />
          </div>

          {laggards.length > 0 && (
            <section className="rounded-2xl border border-line bg-white p-5 mb-4">
              <h2 className="text-sm font-bold text-ink mb-1">Biggest laggards <span className="text-[10px] font-semibold text-muted uppercase tracking-wider ml-1">RGI under 90</span></h2>
              <p className="text-[12px] text-muted mb-2.5">Lowest RevPAR index vs building peers — click a unit to inspect it.</p>
              <div className="flex flex-wrap gap-1.5">
                {laggards.slice(0, 12).map(x => (
                  <button key={x.u.id} onClick={() => focusUnit(x.u.name)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium rounded-full bg-app border border-line text-ink px-2.5 py-1 hover:border-brand-300 hover:text-brand-700">
                    {x.u.name} <IdxChip v={x.rgi} />
                  </button>
                ))}
                {laggards.length > 12 && <span className="text-[12px] text-muted px-1 py-1">+{laggards.length - 12} more</span>}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-white">
            <div className="px-5 pt-4 pb-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><ClipboardCheck size={15} className="text-brand-600" /> Daily checks — ranked by money</h2>
              <span className="text-[11px] text-muted">Impact = conservative $/month estimate at building-peer pace · rebuilt from live data on every load</span>
            </div>
            {d.recs.length === 0 ? (
              <div className="px-5 py-6 text-sm text-muted italic text-center">Nothing to flag — pacing, pricing and forward calendar all look healthy.</div>
            ) : (
              <ol className="divide-y divide-line/70">
                {d.recs.map((r, i) => (
                  <li key={i} className="px-5 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${SEV[r.severity].dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-ink">{i + 1}. {r.title}</span>
                          <span className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${SEV[r.severity].chip}`}>{SEV[r.severity].label}</span>
                          {r.impact > 0 && (
                            <span className="ml-auto text-[12px] font-bold rounded-full bg-brand-600 text-white px-2.5 py-0.5 tabular-nums">≈ {fmtMoney(r.impact)}/mo</span>
                          )}
                        </div>
                        <p className="text-[12px] text-muted mt-0.5">{r.action}</p>
                        {r.units.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.units.slice(0, 10).map(u => (
                              <button key={u.id} onClick={() => focusUnit(u.name)}
                                className="text-[11px] font-medium rounded-full bg-app border border-line text-ink px-2 py-0.5 hover:border-brand-300 hover:text-brand-700 tabular-nums">
                                {u.name}{u.impact > 0 ? ` · ${fmtMoney(u.impact)}` : ''}
                              </button>
                            ))}
                            {r.units.length > 10 && <span className="text-[11px] text-muted px-1 py-0.5">+{r.units.length - 10} more</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </>
  )
}

function Kpi({ label, value, Icon, sub, accent, extra }: { label: string; value: any; Icon?: any; sub?: string; accent?: boolean; extra?: any }) {
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${accent ? 'bg-brand-50 border-brand-200' : 'border-line bg-white'}`}>
      <div className={`text-2xl font-bold tabular-nums flex items-center gap-1.5 ${accent ? 'text-brand-700' : 'text-ink'}`}>
        {Icon && <Icon size={16} className={accent ? 'text-brand-600' : 'text-muted'} />}{value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
      {extra && <div className="mt-0.5">{extra}</div>}
    </div>
  )
}
