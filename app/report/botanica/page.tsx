'use client'
// Public (share-password gated) Botanica performance report — for Margaux / hotel ownership.
// High-level tiles for the selected date range + per-night detail, always live from the mirror.
import { Fragment, useEffect, useMemo, useState, useCallback } from 'react'

type Day = { date: string; dow: string; inv: number; rns: number; rev: number; cleaning: number }
type Data = { ok: boolean; label?: string; openedOn?: string; today?: string; lastSync?: string | null; days: Day[]; error?: string }
type PresetKey = 'mtd' | 'lastMonth' | 'last30' | 'all' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'all', label: 'Since opening' },
  { key: 'custom', label: 'Custom' },
]

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const pct1 = (n: number) => (Math.round(n * 1000) / 10).toFixed(1) + '%'
const fmtDate = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) }
const monthLabel = (ym: string) => new Date(ym + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const firstOfMonth = (iso: string) => iso.slice(0, 8) + '01'
const addDaysIso = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

type Agg = { inv: number; rns: number; rev: number; cleaning: number; occ: number; adr: number }
const aggregate = (rows: Day[]): Agg => {
  let inv = 0, rns = 0, rev = 0, cleaning = 0
  for (const r of rows) { inv += r.inv; rns += r.rns; rev += r.rev; cleaning += r.cleaning }
  return { inv, rns, rev, cleaning, occ: inv > 0 ? rns / inv : 0, adr: rns > 0 ? rev / rns : 0 }
}

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-xl border border-neutral-200 bg-white p-4">
    <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">{label}</div>
    <div className="text-2xl font-bold text-neutral-900 mt-1">{value}</div>
    {sub ? <div className="text-xs text-neutral-500 mt-0.5">{sub}</div> : null}
  </div>
)

const RowCells = ({ d }: { d: Day }) => {
  const noInv = d.inv <= 0
  const weekend = d.dow === 'Fri' || d.dow === 'Sat'
  return (
    <tr className={weekend ? 'bg-amber-50/60' : ''}>
      <td className="px-3 py-1.5 whitespace-nowrap text-neutral-700">{fmtDate(d.date)} <span className="text-neutral-400">{d.dow}</span></td>
      <td className="px-3 py-1.5 text-right text-neutral-500">{noInv ? '—' : d.inv}</td>
      <td className="px-3 py-1.5 text-right font-medium text-neutral-900">{noInv ? '—' : d.rns}</td>
      <td className="px-3 py-1.5 text-right text-neutral-700">{noInv ? '—' : pct1(d.rns / d.inv)}</td>
      <td className="px-3 py-1.5 text-right text-neutral-700">{noInv || d.rns === 0 ? '—' : money(d.rev)}</td>
      <td className="px-3 py-1.5 text-right text-neutral-500">{noInv || d.cleaning === 0 ? '—' : money(d.cleaning)}</td>
      <td className="px-3 py-1.5 text-right font-medium text-neutral-900">{noInv || d.rns === 0 ? '—' : money(d.rev / d.rns)}</td>
    </tr>
  )
}

export default function BotanicaReportPage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [preset, setPreset] = useState<PresetKey>('mtd')
  const [fromD, setFromD] = useState('')
  const [toD, setToD] = useState('')

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await fetch('/api/public/botanica-report', { cache: 'no-store' })
      const j: Data = await res.json()
      if (res.status === 401 || (j as any).needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!res.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
      setLastUpdated(new Date())
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const tm = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30 * 60 * 1000); return () => clearInterval(tm) }, [load])
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
  }, [load])

  const doRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const resync = async () => {
    setSyncing(true); setSyncMsg('')
    try {
      const r = await fetch('/api/public/board-resync', { method: 'POST' })
      const j = await r.json()
      if (r.status === 429 && j.nextAt) {
        const mins = Math.max(1, Math.ceil((new Date(j.nextAt).getTime() - Date.now()) / 60000))
        setSyncMsg('Synced recently — again in ' + mins + ' min')
      } else if (!r.ok || !j.ok) { setSyncMsg(j.error || 'Sync failed') }
      else { setSyncMsg('Synced ' + (j.synced || 0) + ' reservations') }
    } catch (e: any) { setSyncMsg(String(e?.message || e)) }
    await load()
    setSyncing(false)
  }
  const submitPw = async (e: any) => {
    e.preventDefault()
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/share-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const jr = await r.json()
      if (!r.ok || !jr.ok) { setPwErr(jr.error || 'Wrong password'); setPwBusy(false); return }
      setNeedsPw(false); setPw(''); setLoading(true); await load()
    } catch (ex: any) { setPwErr(String(ex?.message || ex)) }
    setPwBusy(false)
  }

  const today = data?.today || ''
  const openedOn = data?.openedOn || '2026-05-01'

  const range = useMemo((): { from: string; to: string } => {
    if (!today) return { from: openedOn, to: today }
    if (preset === 'mtd') return { from: firstOfMonth(today), to: today }
    if (preset === 'last30') return { from: addDaysIso(today, -29), to: today }
    if (preset === 'lastMonth') { const lastM = addDaysIso(firstOfMonth(today), -1); return { from: firstOfMonth(lastM), to: lastM } }
    if (preset === 'custom' && fromD && toD) return { from: fromD <= toD ? fromD : toD, to: fromD <= toD ? toD : fromD }
    return { from: openedOn, to: today }
  }, [preset, fromD, toD, today, openedOn])

  const rows = useMemo(() => (data?.days || []).filter(d => d.date >= range.from && d.date <= range.to), [data, range])
  const total = useMemo(() => aggregate(rows), [rows])
  const months = useMemo(() => {
    const keys: string[] = []
    const by: Record<string, Day[]> = {}
    for (const d of rows) { const k = d.date.slice(0, 7); if (!by[k]) { by[k] = []; keys.push(k) } by[k].push(d) }
    return keys.map(k => ({ key: k, rows: by[k], agg: aggregate(by[k]) }))
  }, [rows])

  const downloadCsv = () => {
    const lines = ['Date,Day,Units Live,Room Nights Sold,Occ %,Revenue,Cleaning Revenue,ADR']
    for (const d of rows) {
      const occ = d.inv > 0 ? (Math.round((d.rns / d.inv) * 1000) / 10) + '%' : ''
      const adr = d.rns > 0 ? (d.rev / d.rns).toFixed(2) : ''
      lines.push([d.date, d.dow, d.inv, d.rns, occ, d.rev.toFixed(2), d.cleaning.toFixed(2), adr].join(','))
    }
    lines.push(['TOTAL', '', total.inv, total.rns, (Math.round(total.occ * 1000) / 10) + '%', total.rev.toFixed(2), total.cleaning.toFixed(2), total.adr.toFixed(2)].join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'botanica-report-' + range.from + '-to-' + range.to + '.csv'
    a.click()
  }

  if (needsPw) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-50">
      <form onSubmit={submitPw} className="w-full max-w-xs bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">Stay Hospitality</div>
          <h1 className="text-lg font-bold">Enter password</h1>
          <p className="text-xs text-neutral-500 mt-1">This report is password protected.</p>
        </div>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="Password" className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
        {pwErr && <div className="text-xs text-red-600">{pwErr}</div>}
        <button type="submit" disabled={pwBusy || !pw} className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">{pwBusy ? 'Checking…' : 'View report'}</button>
      </form>
    </div>
  )
  if (err) return <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm p-6">{err}</div>
  if (loading || !data) return <div className="min-h-screen flex items-center justify-center text-neutral-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-neutral-50 print:bg-white">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">Stay Hospitality</div>
            <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">Botanica — Performance Report</h1>
            <p className="text-xs text-neutral-500 mt-1">
              Nightly ADR (includes cleaning), room nights sold, occupancy &amp; cleaning revenue · live from booking data
              {data.lastSync ? ' · last synced ' + new Date(data.lastSync).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
              {lastUpdated ? ' · updated ' + lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={doRefresh} disabled={refreshing} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
            <button onClick={resync} disabled={syncing} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40">{syncing ? 'Syncing…' : 'Resync'}</button>
            <button onClick={downloadCsv} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100">CSV</button>
            <button onClick={() => window.print()} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100">Print</button>
          </div>
        </div>
        {syncMsg && <div className="text-xs text-neutral-500 mt-1 print:hidden">{syncMsg}</div>}

        <div className="flex flex-wrap items-center gap-2 mt-4 print:hidden">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => { setPreset(p.key); if (p.key === 'custom' && !fromD) { setFromD(firstOfMonth(today)); setToD(today) } }}
              className={'text-xs font-medium px-3 py-1.5 rounded-full border ' + (preset === p.key ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100')}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span className="flex items-center gap-1 text-xs text-neutral-600">
              <input type="date" value={fromD} min={openedOn} max={today} onChange={e => setFromD(e.target.value)} className="border border-neutral-200 rounded-lg px-2 py-1 bg-white" />
              <span>to</span>
              <input type="date" value={toD} min={openedOn} max={today} onChange={e => setToD(e.target.value)} className="border border-neutral-200 rounded-lg px-2 py-1 bg-white" />
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500 mt-2">{fmtDate(range.from)} – {fmtDate(range.to)} · {rows.length} nights</div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
          <Tile label="Active units" value={String(rows.length ? rows[rows.length - 1].inv : 0)} sub={rows.length ? 'avg ' + Math.round(total.inv / rows.length) + ' across range' : 'units live'} />
          <Tile label="Occupancy" value={total.inv > 0 ? pct1(total.occ) : '—'} sub={total.rns + ' of ' + total.inv + ' room nights'} />
          <Tile label="ADR" value={total.rns > 0 ? money(total.adr) : '—'} sub="includes cleaning" />
          <Tile label="RevPAR" value={total.inv > 0 ? money(total.rev / total.inv) : '—'} sub="per available night" />
          <Tile label="Total revenue" value={money0(total.rev)} sub={'room ' + money0(total.rev - total.cleaning)} />
          <Tile label="Cleaning revenue" value={money0(total.cleaning)} sub={'of ' + money0(total.rev) + ' total'} />
        </div>

        <div className="mt-4 rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-200">
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-right font-semibold">Units live</th>
                  <th className="px-3 py-2 text-right font-semibold">Nights sold</th>
                  <th className="px-3 py-2 text-right font-semibold">Occ %</th>
                  <th className="px-3 py-2 text-right font-semibold">Revenue</th>
                  <th className="px-3 py-2 text-right font-semibold">Cleaning</th>
                  <th className="px-3 py-2 text-right font-semibold">ADR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {months.map(m => (
                  <Fragment key={m.key}>
                    {months.length > 1 && (
                      <tr className="bg-neutral-100/80">
                        <td colSpan={7} className="px-3 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-neutral-500">{monthLabel(m.key)}</td>
                      </tr>
                    )}
                    {m.rows.map(d => <RowCells key={d.date} d={d} />)}
                    {months.length > 1 && (
                      <tr className="bg-neutral-50 font-semibold text-neutral-900 border-t border-neutral-200">
                        <td className="px-3 py-2">{monthLabel(m.key)} total</td>
                        <td className="px-3 py-2 text-right">{m.agg.inv}</td>
                        <td className="px-3 py-2 text-right">{m.agg.rns}</td>
                        <td className="px-3 py-2 text-right">{m.agg.inv > 0 ? pct1(m.agg.occ) : '—'}</td>
                        <td className="px-3 py-2 text-right">{money(m.agg.rev)}</td>
                        <td className="px-3 py-2 text-right">{money(m.agg.cleaning)}</td>
                        <td className="px-3 py-2 text-right">{m.agg.rns > 0 ? money(m.agg.adr) : '—'}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                <tr className="bg-neutral-900 text-white font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{total.inv}</td>
                  <td className="px-3 py-2 text-right">{total.rns}</td>
                  <td className="px-3 py-2 text-right">{total.inv > 0 ? pct1(total.occ) : '—'}</td>
                  <td className="px-3 py-2 text-right">{money(total.rev)}</td>
                  <td className="px-3 py-2 text-right">{money(total.cleaning)}</td>
                  <td className="px-3 py-2 text-right">{total.rns > 0 ? money(total.adr) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] text-neutral-400 mt-3">Inventory phased: 32 units from May 4, 50 from Jun 17 · ADR includes cleaning · today&apos;s night is still in progress.</p>
      </div>
    </div>
  )
}
