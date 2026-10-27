'use client'
// BOTANICA BOOKINGS — the live link (Jon, 2026-10-27: "Need a live link with export of all this
// data for all botanica bookings"). Every booking on a Botanica listing, laid out exactly as the
// Cloudbeds reservation-import template (Guest Data · Reservation Info · Payment Info), read live
// from the Guesty mirror, with the Excel / CSV download in the same layout. Row 'botanica-bookings'
// — its own passcode, because this page carries guest contact details. Data: /api/public/botanica-bookings.
import { useCallback, useEffect, useMemo, useState } from 'react'

type Row = { id: string; status: string; channel: string; cells: (string | number)[]; extra: (string | number)[] }
type Data = {
  ok: boolean; error?: string; property?: string; today?: string; generatedAt?: string; lastSync?: string | null; signedIn?: boolean; label?: string | null
  rooms?: number; counts?: { all: number; inHouse: number; upcoming: number; past: number; cancelled: number; duplicatesDropped: number; withEmail: number; withPhone: number; withAddress: number }
  groups?: { label: string; span: number }[]; header?: string[]; extendedHeader?: string[]; rules?: { col: string; rule: string }[]; rows?: Row[]
}
type Scope = 'all' | 'current' | 'past'
const CODE = 'botanica-bookings'
const API = '/api/public/botanica-bookings'
const BLUE = '#3f5ba9' // the template's header blue
const MONEY_COLS = [18, 19]
const PAGE = 300

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) }

const STATUS_TONE: Record<string, string> = {
  'Checked In': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Confirmed: 'bg-sky-50 text-sky-700 border-sky-200',
  'Checked Out': 'bg-neutral-100 text-neutral-600 border-neutral-200',
  Canceled: 'bg-red-50 text-red-700 border-red-200',
  'Not Confirmed': 'bg-amber-50 text-amber-700 border-amber-200',
}
const Tag = ({ children, tone }: { children: any; tone?: string }) => (
  <span className={'inline-block rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold leading-none whitespace-nowrap ' + (tone || 'bg-neutral-100 text-neutral-600 border-neutral-200')}>{children}</span>
)
const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
    <div className="text-[10.5px] uppercase tracking-widest text-neutral-400 font-semibold">{label}</div>
    <div className="text-xl font-bold text-neutral-900 mt-0.5 tabular-nums">{value}</div>
    {sub ? <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div> : null}
  </div>
)

export default function BotanicaBookingsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [needsPw, setNeedsPw] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [scope, setScope] = useState<Scope>('all')
  const [withCancelled, setWithCancelled] = useState(false)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [showRules, setShowRules] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const query = useMemo(() => 'scope=' + scope + '&status=' + (withCancelled ? 'all' : 'live'), [scope, withCancelled])

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await fetch(API + '?' + query, { cache: 'no-store' })
      const j: Data = await res.json()
      if (res.status === 401 || (j as any).needsPassword) { setNeedsPw(true); setPwMsg(String((j as any).error || '')); setLoading(false); return }
      if (!res.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j); setLastUpdated(new Date()); setLimit(PAGE)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [query])

  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => { const tm = setInterval(() => { if (document.visibilityState === 'visible') load() }, 15 * 60 * 1000); return () => clearInterval(tm) }, [load])

  const doRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const submitPw = async (e: any) => {
    e.preventDefault()
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/link-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: CODE, password: pw }) })
      const jr = await r.json()
      if (!r.ok || !jr.ok) { setPwErr(jr.error || 'Wrong passcode'); setPwBusy(false); return }
      setNeedsPw(false); setPw(''); setLoading(true); await load()
    } catch (ex: any) { setPwErr(String(ex?.message || ex)) }
    setPwBusy(false)
  }

  const rows = useMemo(() => {
    const all = data?.rows || []
    const n = q.trim().toLowerCase()
    if (!n) return all
    return all.filter(r => (r.cells.slice(0, 4).join(' ') + ' ' + r.cells[11] + ' ' + r.cells[16] + ' ' + r.channel + ' ' + r.status).toLowerCase().includes(n))
  }, [data, q])
  const shown = rows.slice(0, limit)
  const header = data?.header || []
  const groups = data?.groups || []
  const c = data?.counts

  if (needsPw) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-100">
      <form onSubmit={submitPw} className="w-full max-w-sm bg-white border border-neutral-200 rounded-2xl shadow-lg overflow-hidden">
        <div className="px-6 pt-6 pb-7" style={{ background: 'linear-gradient(135deg, #1f2d5c, ' + BLUE + ')' }}>
          <div className="text-[10px] uppercase tracking-[0.2em] text-sky-200 font-semibold">Botanica · The Garden Hotel &amp; Resort</div>
          <h1 className="text-2xl font-bold text-white mt-1">Bookings export</h1>
          <p className="text-xs text-sky-100/80 mt-1">Every booking, in the Cloudbeds import layout. Passcode protected — ask Jon for this link’s passcode.</p>
        </div>
        <div className="p-6 space-y-3">
          {pwMsg && /no passcode yet/i.test(pwMsg) ? <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{pwMsg}</div> : null}
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="Enter passcode" className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-400/50 focus:border-sky-400" />
          {pwErr && <div className="text-xs text-red-600">{pwErr}</div>}
          <button type="submit" disabled={pwBusy || !pw} className="w-full text-sm font-semibold px-3 py-2.5 rounded-lg text-white disabled:opacity-40 transition-colors" style={{ background: BLUE }}>{pwBusy ? 'Checking…' : 'Open bookings'}</button>
        </div>
      </form>
    </div>
  )
  if (err) return <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm p-6">{err}</div>
  if (loading && !data) return <div className="min-h-screen flex items-center justify-center text-neutral-400 text-sm">Loading every Botanica booking…</div>

  const dl = (format: 'xlsx' | 'csv', extended = false) => API + '?' + query + '&format=' + format + (extended ? '&cols=extended' : '')

  return (
    <div className="min-h-screen bg-neutral-100 px-safe pb-safe">
      <div className="max-w-[1400px] mx-auto p-4 sm:p-6">
        {/* Header band — the one place the downloads live. */}
        <div className="rounded-2xl shadow-lg overflow-hidden text-white" style={{ background: 'linear-gradient(135deg, #1f2d5c 0%, ' + BLUE + ' 70%, #4f6fc4 100%)' }}>
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-sky-200 font-semibold">Botanica · The Garden Hotel &amp; Resort</div>
                <h1 className="text-2xl sm:text-3xl font-bold mt-1 leading-tight">Bookings export</h1>
                <p className="text-xs text-sky-100/80 mt-1">
                  Every booking on a Botanica listing, in the Cloudbeds reservation-import layout · live from Guesty
                  {data?.lastSync ? <> · synced {when(data.lastSync)}</> : null}
                  {lastUpdated ? <> · loaded {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</> : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href={dl('xlsx')} title="Excel file with the three blue headings, exactly like the import template" className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-white text-[#1f2d5c] hover:bg-sky-50 shadow-sm">Download Excel</a>
                <a href={dl('csv')} title="Same 22 columns as a .csv" className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-white/15 border border-white/30 text-white hover:bg-white/25">CSV</a>
                <a href={dl('xlsx', true)} title="The 22 template columns plus Guesty reference columns: reservation id, listing, money breakdown, what Guesty shows paid" className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-white/15 border border-white/30 text-white hover:bg-white/25">Excel + Guesty columns</a>
                <button type="button" onClick={doRefresh} disabled={refreshing} title="Re-read the mirror" className="text-sm font-semibold px-3.5 py-2 rounded-lg bg-white/15 border border-white/30 text-white hover:bg-white/25 disabled:opacity-50">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
              </div>
            </div>
          </div>
        </div>

        {/* Tiles */}
        {c ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            <Tile label="Bookings shown" value={String(c.all)} sub={scope === 'all' ? 'all time' : scope === 'current' ? 'in house & upcoming' : 'checked out'} />
            <Tile label="In house today" value={String(c.inHouse)} sub={data?.today ? data.today : undefined} />
            <Tile label="Upcoming" value={String(c.upcoming)} sub="confirmed, not yet arrived" />
            <Tile label="Checked out" value={String(c.past)} sub="history" />
            <Tile label="Cancelled" value={String(c.cancelled)} sub={withCancelled ? 'included below' : 'hidden — toggle to include'} />
            <Tile label="Contact on file" value={c.all ? Math.round((c.withEmail / c.all) * 100) + '%' : '—'} sub={c.withPhone + ' phones · ' + c.withAddress + ' addresses'} />
          </div>
        ) : null}

        {/* Controls — one line */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {([['all', 'All bookings'], ['current', 'In house & upcoming'], ['past', 'Checked out']] as [Scope, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={'text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ' + (scope === k ? 'text-white border-transparent' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300')} style={scope === k ? { background: BLUE } : undefined}>{label}</button>
          ))}
          <label className="text-xs font-medium text-neutral-700 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-neutral-200 cursor-pointer" title="Cloudbeds leaves cancellations out of an import by default; include them when you need the full history">
            <input type="checkbox" checked={withCancelled} onChange={e => setWithCancelled(e.target.checked)} /> Include cancelled
          </label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, room, confirmation…" className="text-xs border border-neutral-200 rounded-lg px-3 py-1.5 bg-white w-64 focus:outline-none focus:ring-2 focus:ring-sky-400/40" />
          <span className="text-xs text-neutral-500 ml-auto">{rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}{c && c.duplicatesDropped ? ' · ' + c.duplicatesDropped + ' duplicate mirror row' + (c.duplicatesDropped === 1 ? '' : 's') + ' dropped' : ''}{data?.rooms ? ' · ' + data.rooms + ' Botanica listings' : ''}</span>
          <button type="button" onClick={() => setShowRules(s => !s)} className="text-xs font-medium text-neutral-600 underline-offset-2 hover:underline">{showRules ? 'Hide column rules' : 'How each column is filled'}</button>
        </div>

        {showRules && data?.rules ? (
          <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-4 text-xs text-neutral-700 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {data.rules.map(r => <div key={r.col}><span className="font-semibold text-neutral-900">{r.col}</span> — {r.rule}</div>)}
            <div className="sm:col-span-2 text-neutral-500 pt-1">Source: the Guesty mirror (every channel, synced every 15 minutes). Duplicate mirror rows (same listing, confirmation and dates) are dropped. Inquiries that never became bookings are never listed.</div>
          </div>
        ) : null}

        {/* The table — the template, column for column. */}
        <div className="mt-3 rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px] leading-tight">
              <thead>
                <tr>
                  {groups.map((g, i) => (
                    <th key={g.label} colSpan={g.span} className={'text-left text-white text-[12px] font-bold px-3 py-2 ' + (i ? 'border-l-4 border-white' : '')} style={{ background: BLUE }}>{g.label}</th>
                  ))}
                </tr>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  {header.map((h, i) => (
                    <th key={h} className={'text-left font-semibold text-neutral-600 px-3 py-1.5 whitespace-nowrap ' + (MONEY_COLS.indexOf(i) >= 0 ? 'text-right' : '') + (i === 7 || i === 18 ? ' border-l border-neutral-200' : '')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} className="border-b border-neutral-100 hover:bg-sky-50/40">
                    {r.cells.map((v, i) => {
                      const cls = 'px-3 py-1.5 align-top ' + (MONEY_COLS.indexOf(i) >= 0 ? 'text-right tabular-nums ' : '') + (i === 7 || i === 18 ? 'border-l border-neutral-100 ' : '')
                      if (i === 15) return <td key={i} className={cls}><Tag tone={STATUS_TONE[String(v)]}>{v}</Tag></td>
                      if (i === 14) return <td key={i} className={cls + 'whitespace-nowrap'}><Tag>{v}</Tag></td>
                      if (i === 6) return <td key={i} className={cls + 'max-w-[280px] truncate text-neutral-600'} title={String(v)}>{v}</td>
                      if (i === 4) return <td key={i} className={cls + 'max-w-[240px] truncate text-neutral-700'} title={String(v)}>{v}</td>
                      if (i === 2) return <td key={i} className={cls + 'max-w-[220px] truncate'} title={String(v)}>{v}</td>
                      if (typeof v === 'number') return <td key={i} className={cls}>{MONEY_COLS.indexOf(i) >= 0 ? money(v) : v}</td>
                      return <td key={i} className={cls + 'whitespace-nowrap'}>{v === '' ? <span className="text-neutral-300">—</span> : v}</td>
                    })}
                  </tr>
                ))}
                {!shown.length ? <tr><td colSpan={header.length || 22} className="px-3 py-8 text-center text-neutral-400">No bookings match.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {rows.length > shown.length ? (
            <div className="px-3 py-2 border-t border-neutral-200 bg-neutral-50 text-xs text-neutral-600 flex items-center gap-3">
              Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()} — the download always has every row.
              <button type="button" onClick={() => setLimit(l => l + 1000)} className="font-semibold text-[#1f2d5c] hover:underline">Show more</button>
              <button type="button" onClick={() => setLimit(rows.length)} className="font-semibold text-[#1f2d5c] hover:underline">Show all</button>
            </div>
          ) : null}
        </div>
        <p className="text-[11px] text-neutral-500 mt-3">Guest contact details on this page are for the hotel’s own property system. Door codes are never exported. {data?.signedIn ? 'You are signed in to Lighthouse.' : 'Opened with this link’s passcode.'}</p>
      </div>
    </div>
  )
}
