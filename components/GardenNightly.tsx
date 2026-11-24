'use client'
// THE NIGHTLY REPORT (lib/garden/nightly) — Jon, 2026-11-24: "a report that matches the Botanica
// shareable report we share with Margaux each week … broken out by whole property, Garden, etc. Make
// it exactly the way the Botanica report is … and then have comparative whole property / Garden."
//
// The layout is /report/botanica's, piece for piece: the dark banner with the three numbers read first
// (total revenue, ADR incl. cleaning, occupancy), the period pills, the five tiles (units, RevPAR,
// cleaning revenue, length of stay, booking window), then every night with month subtotals and a total.
// Two things are added: a switch for which side the report is for, and the three sides next to each
// other for the same period. The Botanica link Margaux opens is untouched.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type Day = { date: string; dow: string; inv: number; rns: number; rev: number; cleaning: number; arr?: number; arrNights?: number; arrLead?: number; arrLeadCnt?: number }
type Scope = 'all' | 'garden' | 'botanica'
type Data = { ok: boolean; error?: string; needsPassword?: boolean; today: string; from: string; through: string; rooms: Record<Scope, number>; days: Record<Scope, Day[]>; coverageFrom: string | null; lastSync: string | null; partial?: boolean }
type PresetKey = 'month' | 'mtd' | 'upcoming' | 'lastMonth' | 'last30' | 'all' | 'custom'
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'month', label: 'This month' }, { key: 'mtd', label: 'MTD' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'lastMonth', label: 'Last month' },
  { key: 'last30', label: 'Last 30 days' }, { key: 'all', label: 'Everything loaded' }, { key: 'custom', label: 'Custom' },
]
const SIDES: [Scope, string][] = [['all', 'Whole property'], ['garden', 'Garden'], ['botanica', 'Botanica']]

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const pct1 = (n: number) => (Math.round(n * 1000) / 10).toFixed(1) + '%'
const fmtDate = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) }
const monthLabel = (ym: string) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const firstOfMonth = (iso: string) => iso.slice(0, 8) + '01'
const addDaysIso = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

type Agg = { inv: number; rns: number; rev: number; cleaning: number; occ: number; adr: number; arr: number; arrNights: number; los: number; bookWin: number }
const aggregate = (rows: Day[]): Agg => {
  let inv = 0, rns = 0, rev = 0, cleaning = 0, arr = 0, arrNights = 0, arrLead = 0, arrLeadCnt = 0
  for (const r of rows) { inv += r.inv; rns += r.rns; rev += r.rev; cleaning += r.cleaning; arr += (r.arr || 0); arrNights += (r.arrNights || 0); arrLead += (r.arrLead || 0); arrLeadCnt += (r.arrLeadCnt || 0) }
  return { inv, rns, rev, cleaning, occ: inv > 0 ? rns / inv : 0, adr: rns > 0 ? rev / rns : 0, arr, arrNights, los: arr > 0 ? arrNights / arr : 0, bookWin: arrLeadCnt > 0 ? arrLead / arrLeadCnt : 0 }
}

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
    <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">{label}</div>
    <div className="text-2xl font-bold text-neutral-900 mt-1 tabular-nums">{value}</div>
    {sub ? <div className="text-xs text-neutral-500 mt-0.5">{sub}</div> : null}
  </div>
)
const HeroStat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-xl bg-black/30 backdrop-blur-sm border border-white/15 px-4 py-3">
    <div className="text-[10px] uppercase tracking-widest text-amber-300 font-semibold">{label}</div>
    <div className="text-2xl sm:text-3xl font-bold text-white mt-0.5 tabular-nums leading-tight">{value}</div>
    {sub ? <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div> : null}
  </div>
)
const RowCells = ({ d, today }: { d: Day; today: string }) => {
  const noInv = d.inv <= 0, weekend = d.dow === 'Fri' || d.dow === 'Sat', future = !!today && d.date > today
  return (
    <tr className={future ? 'bg-sky-50/50' : (weekend ? 'bg-amber-50/60' : '')}>
      <td className="px-3 py-1.5 whitespace-nowrap text-neutral-700">{fmtDate(d.date)} <span className="text-neutral-400">{d.dow}</span>{future ? <span className="ml-1.5 text-[10px] uppercase tracking-wide text-sky-500 font-semibold">soon</span> : null}</td>
      <td className="px-3 py-1.5 text-right text-neutral-500">{noInv ? '—' : d.inv}</td>
      <td className="px-3 py-1.5 text-right font-medium text-neutral-900">{noInv ? '—' : d.rns}</td>
      <td className="px-3 py-1.5 text-right text-neutral-700">{noInv ? '—' : pct1(d.rns / d.inv)}</td>
      <td className="px-3 py-1.5 text-right text-neutral-700">{noInv || d.rns === 0 ? '—' : money(d.rev)}</td>
      <td className="px-3 py-1.5 text-right text-neutral-500">{noInv || d.cleaning === 0 ? '—' : money(d.cleaning)}</td>
      <td className="px-3 py-1.5 text-right font-medium text-neutral-900">{noInv || d.rns === 0 ? '—' : money(d.rev / d.rns)}</td>
    </tr>
  )
}

export function GardenNightly({ api = '/api/garden/revenue', onLocked }: { api?: string; onLocked?: (msg: string) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [preset, setPreset] = useState<PresetKey>('month')
  const [fromD, setFromD] = useState('')
  const [toD, setToD] = useState('')
  const [scope, setScope] = useState<Scope>('all')

  const load = useCallback(async () => {
    try {
      const res = await fetch(api + '?nightly=1', { cache: 'no-store' })
      const j: Data = await res.json()
      if (res.status === 401 || j.needsPassword) { onLocked?.(String(j.error || '')); return }
      if (!res.ok || j.ok === false) { setErr(j.error || 'Failed to load'); return }
      setErr(''); setData(j); setLastUpdated(new Date())
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [api, onLocked])
  useEffect(() => { load() }, [load])
  // Refresh reads Cloudbeds first (at most once every three minutes, server side), then the report.
  const doRefresh = async () => { setRefreshing(true); try { await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: true }) }) } catch {} await load(); setRefreshing(false) }

  const today = data?.today || '', start = data?.from || '', through = data?.through || today
  const range = useMemo((): { from: string; to: string } => {
    if (!today) return { from: start, to: today }
    if (preset === 'month') { const eom = addDaysIso(firstOfMonth(addDaysIso(firstOfMonth(today), 32)), -1); return { from: firstOfMonth(today), to: eom <= through ? eom : through } }
    if (preset === 'mtd') return { from: firstOfMonth(today), to: today }
    if (preset === 'upcoming') return { from: today, to: through }
    if (preset === 'last30') return { from: addDaysIso(today, -29), to: today }
    if (preset === 'lastMonth') { const lastM = addDaysIso(firstOfMonth(today), -1); return { from: firstOfMonth(lastM), to: lastM } }
    if (preset === 'custom' && fromD && toD) return { from: fromD <= toD ? fromD : toD, to: fromD <= toD ? toD : fromD }
    return { from: start, to: today }
  }, [preset, fromD, toD, today, start, through])

  const inRange = useCallback((s: Scope) => (data?.days?.[s] || []).filter(d => d.date >= range.from && d.date <= range.to), [data, range])
  const rows = useMemo(() => inRange(scope), [inRange, scope])
  const total = useMemo(() => aggregate(rows), [rows])
  const sides = useMemo(() => SIDES.map(([k, label]) => ({ k, label, a: aggregate(inRange(k)), units: data?.rooms?.[k] || 0 })), [inRange, data])
  const months = useMemo(() => {
    const keys: string[] = [], by: Record<string, Day[]> = {}
    for (const d of rows) { const k = d.date.slice(0, 7); if (!by[k]) { by[k] = []; keys.push(k) } by[k].push(d) }
    return keys.map(k => ({ key: k, rows: by[k], agg: aggregate(by[k]) }))
  }, [rows])
  const sideName = SIDES.find(x => x[0] === scope)![1]

  const downloadCsv = () => {
    const lines = [`The Garden Hotel & Resort — nightly report — ${sideName}`, 'Date,Day,Units Live,Room Nights Sold,Occ %,Revenue,Cleaning Revenue,ADR']
    for (const d of rows) lines.push([d.date, d.dow, d.inv, d.rns, d.inv > 0 ? (Math.round((d.rns / d.inv) * 1000) / 10) + '%' : '', d.rev.toFixed(2), d.cleaning.toFixed(2), d.rns > 0 ? (d.rev / d.rns).toFixed(2) : ''].join(','))
    lines.push(['TOTAL', '', total.inv, total.rns, (Math.round(total.occ * 1000) / 10) + '%', total.rev.toFixed(2), total.cleaning.toFixed(2), total.adr.toFixed(2)].join(','))
    lines.push('', 'Avg length of stay (nights) - arrivals in range,' + (total.arr > 0 ? total.los.toFixed(1) : ''), 'Booking window (days) - avg lead to check-in,' + (total.arr > 0 ? String(Math.round(total.bookWin)) : ''))
    lines.push('', 'Side,Units,Revenue,Room Nights Sold,Occ %,ADR,RevPAR,Cleaning Revenue,Avg length of stay,Booking window (days)')
    for (const s of sides) lines.push([s.label, s.units, s.a.rev.toFixed(2), s.a.rns, (Math.round(s.a.occ * 1000) / 10) + '%', s.a.adr.toFixed(2), s.a.inv ? (s.a.rev / s.a.inv).toFixed(2) : '', s.a.cleaning.toFixed(2), s.a.arr ? s.a.los.toFixed(1) : '', s.a.arr ? Math.round(s.a.bookWin) : ''].join(','))
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `garden-nightly-${scope}-${range.from}-to-${range.to}.csv`; a.click()
  }

  if (err) return <div className="py-16 text-center text-neutral-500 text-sm">{err}</div>
  if (!data) return <div className="py-16 text-center text-neutral-400 text-sm">Loading…</div>
  const cmp: [string, (a: Agg, units: number) => string][] = [
    ['Units', (_a, u) => String(u)], ['Total revenue', a => money0(a.rev)], ['Average ADR', a => a.rns ? money(a.adr) : '—'], ['Occupancy', a => a.inv ? pct1(a.occ) : '—'],
    ['Room nights sold', a => a.rns.toLocaleString('en-US')], ['RevPAR', a => a.inv ? money(a.rev / a.inv) : '—'], ['Cleaning revenue', a => money0(a.cleaning)],
    ['Avg length of stay', a => a.arr ? a.los.toFixed(1) + ' nights' : '—'], ['Booking window', a => a.arr ? Math.round(a.bookWin) + ' days' : '—'], ['Arrivals', a => a.arr.toLocaleString('en-US')],
  ]
  const share = (i: number) => { const all = sides[0].a, bo = sides[2].a; const v = i === 1 ? [bo.rev, all.rev] : i === 4 ? [bo.rns, all.rns] : i === 6 ? [bo.cleaning, all.cleaning] : i === 9 ? [bo.arr, all.arr] : i === 0 ? [sides[2].units, sides[0].units] : null; return v && v[1] ? Math.round((v[0] / v[1]) * 100) + '%' : '' }

  return (
    <div id="gnightly" className="print:bg-white" style={{ fontFamily: 'var(--font-ui)' }}>
      <style dangerouslySetInnerHTML={{ __html: '@media print { body * { visibility: hidden } #gnightly, #gnightly * { visibility: visible } #gnightly { position: absolute; left: 0; top: 0; width: 100%; padding: 12px } }' }} />
      <div className="relative rounded-2xl bg-neutral-900 shadow-lg overflow-hidden" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800" aria-hidden="true" />
        <div className="relative p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold">The Garden Hotel &amp; Resort</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 print:hidden"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" /></span>LIVE</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight normal-case" style={{ fontFamily: 'var(--font-ui)' }}>{sideName} report</div>
              <p className="text-xs text-neutral-400 mt-1.5 max-w-xl">
                Nightly ADR (incl. cleaning), room nights sold, occupancy &amp; cleaning revenue · always live
                {data.lastSync ? ' · synced ' + new Date(data.lastSync).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                {lastUpdated ? ' · updated ' + lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button onClick={doRefresh} disabled={refreshing} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 disabled:opacity-40 transition-colors">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
              <button onClick={downloadCsv} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 transition-colors">CSV</button>
              <button onClick={() => window.print()} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 transition-colors">Print</button>
            </div>
          </div>
          <div className="inline-flex rounded-lg border border-white/15 overflow-hidden text-xs mt-4 print:hidden">
            {SIDES.map(([k, l]) => <button key={k} onClick={() => setScope(k)} className={'px-3 py-1.5 font-semibold border-l border-white/15 first:border-l-0 transition-colors ' + (scope === k ? 'bg-amber-500 text-white' : 'bg-white/10 text-neutral-200 hover:bg-white/20')}>{l} <span className="font-normal opacity-80">{data.rooms[k]}</span></button>)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <HeroStat label="Total revenue" value={money0(total.rev)} sub={fmtDate(range.from) + ' – ' + fmtDate(range.to)} />
            <HeroStat label="Average ADR" value={total.rns > 0 ? money(total.adr) : '—'} sub="includes cleaning" />
            <HeroStat label="Occupancy" value={total.inv > 0 ? pct1(total.occ) : '—'} sub={total.rns + ' of ' + total.inv + ' room nights'} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4 print:hidden">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => { setPreset(p.key); if (p.key === 'custom' && !fromD) { setFromD(firstOfMonth(today)); setToD(today) } }}
            className={'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ' + (preset === p.key ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100')}>{p.label}</button>
        ))}
        {preset === 'custom' && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-neutral-600">
            <input type="date" value={fromD} min={start} max={through} onChange={e => setFromD(e.target.value)} className="border border-neutral-200 rounded-lg px-2 py-1 bg-white" />
            <span>to</span>
            <input type="date" value={toD} min={start} max={through} onChange={e => setToD(e.target.value)} className="border border-neutral-200 rounded-lg px-2 py-1 bg-white" />
          </span>
        )}
      </div>
      <div className="text-xs text-neutral-500 mt-2">{fmtDate(range.from)} – {fmtDate(range.to)} · {rows.length} nights{range.to > today ? <span className="ml-1.5 text-sky-600 font-medium">· includes upcoming (on the books)</span> : null}{data.coverageFrom && range.from < data.coverageFrom && scope !== 'botanica' ? <span className="ml-1.5 text-amber-700 font-medium">· Garden bookings are loaded from {fmtDate(data.coverageFrom)}; earlier nights read low</span> : null}</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
        <Tile label="Active units" value={String(rows.length ? rows[rows.length - 1].inv : 0)} sub={rows.length ? 'avg ' + Math.round(total.inv / rows.length) + ' across range' : 'units live'} />
        <Tile label="RevPAR" value={total.inv > 0 ? money(total.rev / total.inv) : '—'} sub="per available night" />
        <Tile label="Cleaning revenue" value={money0(total.cleaning)} sub={'of ' + money0(total.rev) + ' total'} />
        <Tile label="Avg length of stay" value={total.arr > 0 ? total.los.toFixed(1) + ' nights' : '—'} sub={total.arr + ' arrivals in range'} />
        <Tile label="Booking window" value={total.arr > 0 ? Math.round(total.bookWin) + ' days' : '—'} sub="avg lead time to check-in" />
      </div>

      {/* THE THREE SIDES, the same period — the one thing the Botanica link does not have. */}
      <div className="mt-4 rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] sm:min-w-0 text-xs sm:text-sm tabular-nums">
            <thead><tr className="text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
              <th className="px-3 py-2 text-left font-semibold">Compared · {fmtDate(range.from)} – {fmtDate(range.to)}</th>
              {sides.map(s => <th key={s.k} className={'px-3 py-2 text-right font-semibold ' + (s.k === scope ? 'text-neutral-900 bg-amber-50/70' : '')}><button onClick={() => setScope(s.k)} className="uppercase tracking-wide hover:underline print:no-underline">{s.label}</button></th>)}
              <th className="px-3 py-2 text-right font-semibold">Botanica share</th>
            </tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {cmp.map(([label, f], i) => (
                <tr key={label}>
                  <td className="px-3 py-1.5 text-neutral-500">{label}</td>
                  {sides.map(s => <td key={s.k} className={'px-3 py-1.5 text-right ' + (s.k === scope ? 'font-semibold text-neutral-900 bg-amber-50/70' : 'text-neutral-700')}>{f(s.a, s.units)}</td>)}
                  <td className="px-3 py-1.5 text-right text-neutral-400">{share(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] sm:min-w-0 text-xs sm:text-sm tabular-nums">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
                <th className="px-3 py-2 text-left font-semibold">Date</th><th className="px-3 py-2 text-right font-semibold">Units live</th><th className="px-3 py-2 text-right font-semibold">Nights sold</th>
                <th className="px-3 py-2 text-right font-semibold">Occ %</th><th className="px-3 py-2 text-right font-semibold">Revenue</th><th className="px-3 py-2 text-right font-semibold">Cleaning</th><th className="px-3 py-2 text-right font-semibold">ADR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {months.map(m => (
                <Fragment key={m.key}>
                  {months.length > 1 && <tr className="bg-neutral-100/80"><td colSpan={7} className="px-3 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-neutral-500">{monthLabel(m.key)}</td></tr>}
                  {m.rows.map(d => <RowCells key={d.date} d={d} today={today} />)}
                  {months.length > 1 && (
                    <tr className="bg-neutral-50 font-semibold text-neutral-900 border-t border-neutral-200">
                      <td className="px-3 py-2">{monthLabel(m.key)} total</td><td className="px-3 py-2 text-right">{m.agg.inv}</td><td className="px-3 py-2 text-right">{m.agg.rns}</td>
                      <td className="px-3 py-2 text-right">{m.agg.inv > 0 ? pct1(m.agg.occ) : '—'}</td><td className="px-3 py-2 text-right">{money(m.agg.rev)}</td><td className="px-3 py-2 text-right">{money(m.agg.cleaning)}</td><td className="px-3 py-2 text-right">{m.agg.rns > 0 ? money(m.agg.adr) : '—'}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="bg-neutral-900 text-white font-semibold">
                <td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{total.inv}</td><td className="px-3 py-2 text-right">{total.rns}</td>
                <td className="px-3 py-2 text-right">{total.inv > 0 ? pct1(total.occ) : '—'}</td><td className="px-3 py-2 text-right">{money(total.rev)}</td><td className="px-3 py-2 text-right">{money(total.cleaning)}</td><td className="px-3 py-2 text-right">{total.rns > 0 ? money(total.adr) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-neutral-400 mt-3">ADR includes cleaning · revenue is before taxes · today&apos;s night is still in progress · <span className="text-sky-600">shaded &ldquo;soon&rdquo; rows</span> are upcoming reservations on the books, not yet arrived.{data.partial ? ' Some bookings could not be read just now, so these numbers may be short.' : ''}</p>
    </div>
  )
}
