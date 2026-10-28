'use client'
// BOTANICA BOOKINGS — the live link (Jon, 2026-10-27: "Need a live link with export of all this
// data for all botanica bookings"). Every booking on a Botanica listing, laid out exactly as the
// Cloudbeds reservation-import template (Guest Data · Reservation Info · Payment Info), read live
// from the Guesty mirror, with the Excel / CSV download in the same layout. Row 'botanica-bookings'
// — its own passcode, because this page carries guest contact details. Data: /api/public/botanica-bookings.
import { useCallback, useEffect, useMemo, useState } from 'react'

// One booking as the API sends it: check-in / check-out, live (not cancelled), Cloudbeds status,
// channel, has email / phone / address / adults, and the 22 template cells.
type Row = { id: string; ci: string; co: string; live: boolean; s: string; ch: string; e: boolean; p: boolean; a: boolean; ad: boolean; c: (string | number)[] }
type Data = {
  ok: boolean; error?: string; today?: string; generatedAt?: string; lastSync?: string | null; signedIn?: boolean
  rooms?: number; duplicatesDropped?: number; groups?: { label: string; span: number }[]; header?: string[]; rules?: { col: string; rule: string }[]; rows?: Row[]
}
type Scope = 'all' | 'current' | 'past'
const CODE = 'botanica-bookings'
const API = '/api/public/botanica-bookings'
const BLUE = '#3f5ba9' // the template's header blue
const MONEY_COLS = [18, 19]
const PAGE = 300
const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const monthStart = (ymd: string) => ymd.slice(0, 8) + '01'

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
  // Date selector (Jon, 2026-10-27): check-in from / to. Empty = every booking.
  const [fromD, setFromD] = useState('')
  const [toD, setToD] = useState('')
  // Which date the window reads, and one-day vs range (Jon, 2026-10-28).
  const [by, setBy] = useState<'checkin' | 'checkout' | 'stay'>('checkin')
  const [oneDay, setOneDay] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [showRules, setShowRules] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [bf, setBf] = useState<{ running: boolean; msg: string }>({ running: false, msg: '' })

  // The download URL carries the same filter the page shows (the server applies the same rule).
  const query = useMemo(() => {
    const t2 = oneDay ? fromD : toD
    const lo = fromD && t2 && fromD > t2 ? t2 : fromD, hi = fromD && t2 && fromD > t2 ? fromD : t2
    return 'scope=' + scope + '&status=' + (withCancelled ? 'all' : 'live') + '&by=' + by + (lo ? '&from=' + lo : '') + (hi ? '&to=' + hi : '')
  }, [scope, withCancelled, fromD, toD, by, oneDay])

  // LOAD ONCE, FILTER HERE (Jon, 2026-10-28: "the link sometimes breaks"). The page fetches every
  // booking once and every filter runs in the browser — a click never waits on the server. A failed
  // refresh never blanks the page: the last good data stays up with a note, and a load retries once.
  const load = useCallback(async (fresh = false) => {
    setErr('')
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController()
      const tm = setTimeout(() => ctl.abort(), 45000)
      try {
        const res = await fetch(API + (fresh ? '?fresh=1' : ''), { cache: 'no-store', signal: ctl.signal })
        const j: Data = await res.json().catch(() => ({ ok: false, error: 'The server sent an unreadable answer' } as Data))
        if (res.status === 401 || (j as any).needsPassword) { setNeedsPw(true); setPwMsg(String((j as any).error || '')); setLoading(false); return }
        if (res.ok && j.ok !== false) { setData(j); setLastUpdated(new Date()); setLoading(false); return }
        if (attempt === 1) setErr(j.error || 'Could not load the bookings')
      } catch (e: any) {
        if (attempt === 1) setErr(e?.name === 'AbortError' ? 'The bookings took too long to load' : String(e?.message || e))
      } finally { clearTimeout(tm) }
      await new Promise(r => setTimeout(r, 1500))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const tm = setInterval(() => { if (document.visibilityState === 'visible') load() }, 15 * 60 * 1000); return () => clearInterval(tm) }, [load])
  useEffect(() => { setLimit(PAGE) }, [scope, withCancelled, fromD, toD, by, oneDay, q])

  const doRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false) }
  // Guest counts were never part of the Guesty pull before 2026-10-27; this re-pulls the Botanica
  // rows that still lack them, 200 at a time, until none are left, then reloads.
  const backfill = async () => {
    setBf({ running: true, msg: 'Asking Guesty…' })
    try {
      for (let i = 0; i < 20; i++) {
        const r = await fetch(API + '?backfill=1', { cache: 'no-store' })
        const j = await r.json()
        if (!r.ok || !j.ok) { setBf({ running: false, msg: j.error || 'Backfill failed' }); return }
        if (!j.remaining) { setBf({ running: false, msg: 'Done — ' + j.pulled + ' bookings refreshed' }); break }
        setBf({ running: true, msg: j.pulled + ' refreshed, ' + j.remaining + ' to go…' })
      }
    } catch (e: any) { setBf({ running: false, msg: String(e?.message || e) }) }
    await load(true)
  }
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

  // THE FILTER — same rule as pick() in the API (keep the two in step).
  const win = useMemo(() => {
    const t2 = oneDay ? fromD : toD
    return { lo: fromD && t2 && fromD > t2 ? t2 : fromD, hi: fromD && t2 && fromD > t2 ? fromD : t2 }
  }, [fromD, toD, oneDay])
  const inWindow = useCallback((r: Row) => {
    const { lo, hi } = win
    if (by === 'checkout') return (!lo || r.co >= lo) && (!hi || r.co <= hi)
    if (by === 'stay') return (!lo || r.co > lo) && (!hi || r.ci <= hi)
    return (!lo || r.ci >= lo) && (!hi || r.ci <= hi)
  }, [win, by])
  const dated = useMemo(() => (data?.rows || []).filter(inWindow), [data, inWindow])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return dated.filter(r => {
      if (!r.live && !withCancelled) return false
      if (scope === 'current' && r.s === 'Checked Out') return false
      if (scope === 'past' && r.s !== 'Checked Out') return false
      if (n && !(r.c.slice(0, 4).join(' ') + ' ' + r.c[11] + ' ' + r.c[16] + ' ' + r.ch + ' ' + r.s).toLowerCase().includes(n)) return false
      return true
    })
  }, [dated, withCancelled, scope, q])
  const c = useMemo(() => {
    const k = { all: rows.length, inHouse: 0, upcoming: 0, past: 0, cancelled: 0, withEmail: 0, withPhone: 0, withAddress: 0, withAdults: 0 }
    for (const r of dated) {
      if (!r.live) k.cancelled++
      else if (r.s === 'Checked In') k.inHouse++
      else if (r.s === 'Checked Out') k.past++
      else k.upcoming++
    }
    for (const r of rows) { if (r.e) k.withEmail++; if (r.p) k.withPhone++; if (r.a) k.withAddress++; if (r.ad) k.withAdults++ }
    return k
  }, [dated, rows])
  const shown = rows.slice(0, limit)
  const header = data?.header || []
  const groups = data?.groups || []

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
  // Only a FIRST load that failed fills the screen — and it offers a retry instead of a dead end.
  if (err && !data) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-sm p-6 text-neutral-600">
      <div>{err}</div>
      <button type="button" onClick={() => { setLoading(true); load(true) }} className="text-sm font-semibold px-3.5 py-2 rounded-lg text-white" style={{ background: BLUE }}>Try again</button>
    </div>
  )
  if (!data) return <div className="min-h-screen flex items-center justify-center text-neutral-400 text-sm">{loading ? 'Loading every Botanica booking…' : ''}</div>

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
        {err ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Couldn’t refresh just now ({err}) — showing the bookings loaded {lastUpdated ? lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'earlier'}. <button type="button" onClick={doRefresh} className="font-semibold underline">Retry</button></div> : null}
        {c ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
            <Tile label="Bookings shown" value={c.all.toLocaleString()} sub={win.lo || win.hi ? 'in the dates picked' : scope === 'all' ? 'all time' : scope === 'current' ? 'in house & upcoming' : 'checked out'} />
            <Tile label="In house today" value={String(c.inHouse)} sub={data?.today ? data.today : undefined} />
            <Tile label="Upcoming" value={String(c.upcoming)} sub="confirmed, not yet arrived" />
            <Tile label="Checked out" value={String(c.past)} sub="history" />
            <Tile label="Cancelled" value={String(c.cancelled)} sub={withCancelled ? 'included below' : 'hidden — toggle to include'} />
            <Tile label="Contact on file" value={c.all ? Math.round((c.withEmail / c.all) * 100) + '%' : '—'} sub={c.withPhone + ' phones · ' + c.withAddress + ' addresses'} />
          </div>
        ) : null}

        {data?.signedIn && c && c.all > 0 && c.withAdults / c.all < 0.8 ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex flex-wrap items-center gap-2">
            <span>Adults / children are blank on {(c.all - c.withAdults).toLocaleString()} of {c.all.toLocaleString()} bookings — the mirror row predates guest counts being pulled from Guesty.</span>
            <button type="button" onClick={backfill} disabled={bf.running} className="font-semibold px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 disabled:opacity-50">{bf.running ? 'Refreshing…' : 'Fill from Guesty'}</button>
            {bf.msg ? <span className="text-amber-700">{bf.msg}</span> : null}
          </div>
        ) : (bf.msg ? <div className="mt-3 text-xs text-neutral-500">{bf.msg}</div> : null)}
        {/* Controls — one line */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {([['all', 'All bookings'], ['current', 'In house & upcoming'], ['past', 'Checked out']] as [Scope, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={'text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ' + (scope === k ? 'text-white border-transparent' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300')} style={scope === k ? { background: BLUE } : undefined}>{label}</button>
          ))}
          <label className="text-xs font-medium text-neutral-700 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-neutral-200 cursor-pointer" title="Cloudbeds leaves cancellations out of an import by default; include them when you need the full history">
            <input type="checkbox" checked={withCancelled} onChange={e => setWithCancelled(e.target.checked)} /> Include cancelled
          </label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, room, confirmation…" className="text-xs border border-neutral-200 rounded-lg px-3 py-1.5 bg-white w-64 focus:outline-none focus:ring-2 focus:ring-sky-400/40" />
          <span className="text-xs text-neutral-500 ml-auto">{rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}{data?.duplicatesDropped ? ' · ' + data.duplicatesDropped + ' duplicate mirror row' + (data.duplicatesDropped === 1 ? '' : 's') + ' dropped' : ''}{data?.rooms ? ' · ' + data.rooms + ' Botanica listings' : ''}</span>
          <button type="button" onClick={() => setShowRules(s => !s)} className="text-xs font-medium text-neutral-600 underline-offset-2 hover:underline">{showRules ? 'Hide column rules' : 'How each column is filled'}</button>
        </div>

        {/* Date selector — by check-in, check-out or stay dates; one day or a range. Buttons, never a menu. */}
        {(() => {
          const t = data?.today || iso(new Date())
          const ms = monthStart(t), nextMs = monthStart(addDays(ms, 32)), lastMs = monthStart(addDays(ms, -1))
          const word = by === 'checkin' ? 'Check-ins' : by === 'checkout' ? 'Check-outs' : 'Stays'
          const pill = (on: boolean) => 'font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ' + (on ? 'text-white border-transparent' : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300')
          const days: [string, string, string][] = [
            ['Yesterday', addDays(t, -1), word + ' yesterday'], ['Today', t, word + ' today'], ['Tomorrow', addDays(t, 1), word + ' tomorrow'],
          ]
          const ranges: [string, string, string, string][] = [
            ['This month', ms, addDays(nextMs, -1), word + ' this calendar month'],
            ['Last month', lastMs, addDays(ms, -1), word + ' last calendar month'],
            ['Next 30 days', t, addDays(t, 30), word + ' from today through 30 days out'],
            ['Last 90 days', addDays(t, -90), t, word + ' in the last 90 days'],
          ]
          const isDay = (d: string) => oneDay && fromD === d
          const isRange = (a: string, b: string) => !oneDay && fromD === a && toD === b
          const input = 'border border-neutral-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400/40'
          return (
            <div className="mt-2 space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-neutral-600 w-14">Date by</span>
                {([['checkin', 'Check-in', 'Bookings arriving in the dates'], ['checkout', 'Check-out', 'Bookings departing in the dates'], ['stay', 'Stay dates', 'Bookings in house on any night of the dates — one day = everyone sleeping there that night']] as ['checkin' | 'checkout' | 'stay', string, string][]).map(([k, label, hint]) => (
                  <button key={k} type="button" title={hint} onClick={() => setBy(k)} className={pill(by === k)} style={by === k ? { background: BLUE } : undefined}>{label}</button>
                ))}
                <span className="w-px h-5 bg-neutral-200 mx-1" />
                <button type="button" title="Pick one date" onClick={() => { setOneDay(true); if (fromD) setToD(fromD) }} className={pill(oneDay)} style={oneDay ? { background: BLUE } : undefined}>One day</button>
                <button type="button" title="Pick a from / to range" onClick={() => setOneDay(false)} className={pill(!oneDay)} style={!oneDay ? { background: BLUE } : undefined}>Range</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-neutral-600 w-14">{oneDay ? 'On' : 'From'}</span>
                <input type="date" value={fromD} onChange={e => { setFromD(e.target.value); if (oneDay) setToD(e.target.value) }} className={input} aria-label={oneDay ? 'Date' : 'From'} />
                {!oneDay ? <><span className="text-neutral-400">to</span><input type="date" value={toD} onChange={e => setToD(e.target.value)} className={input} aria-label="To" /></> : null}
                {days.map(([label, d, hint]) => <button key={label} type="button" title={hint} onClick={() => { setOneDay(true); setFromD(d); setToD(d) }} className={pill(isDay(d))} style={isDay(d) ? { background: BLUE } : undefined}>{label}</button>)}
                {ranges.map(([label, a, b, hint]) => <button key={label} type="button" title={hint} onClick={() => { setOneDay(false); setFromD(a); setToD(b) }} className={pill(isRange(a, b))} style={isRange(a, b) ? { background: BLUE } : undefined}>{label}</button>)}
                {fromD || toD ? <button type="button" onClick={() => { setFromD(''); setToD('') }} className="font-medium text-neutral-600 underline-offset-2 hover:underline">Clear dates</button> : <span className="text-neutral-400">all dates</span>}
              </div>
              {fromD ? <div className="text-neutral-500">Showing {by === 'checkin' ? 'bookings checking in' : by === 'checkout' ? 'bookings checking out' : 'bookings in house'} {oneDay || fromD === toD ? (by === 'stay' ? 'the night of ' : 'on ') + fromD : (by === 'stay' ? 'any night ' : '') + 'from ' + fromD + (toD ? ' to ' + toD : ' onward')}.</div> : null}
            </div>
          )
        })()}

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
                    {r.c.map((v, i) => {
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
