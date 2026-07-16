'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

type Row = { unit: string; checkIn: string; checkOut: string; nights: number | null; bedrooms: number | null; doorCode: string | null; checkInTime: string | null; checkOutTime: string | null; guests: number | null; source: string | null; sameDayTurn: boolean; guestName: string | null; phone: string | null; confirmationCode: string | null; notes: string | null }
type Data = { ok: boolean; label?: string; today?: string; start?: string; end?: string; unitCount?: number; arrivals: Row[]; departures: Row[]; active: Row[]; error?: string }
type TabKey = 'arrivals' | 'departures' | 'active'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departure cleans' },
  { key: 'active', label: 'Active reservations' },
]
function fmtDate(iso: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function dateFor(r: Row, tab: TabKey) { return tab === 'departures' ? r.checkOut : r.checkIn }
function bedLabel(n: number | null) { if (n == null) return ''; return n === 0 ? 'Studio' : n + 'BR' }
function keyOf(r: Row, tab: TabKey) { return tab.charAt(0) + r.unit + '|' + dateFor(r, tab) }
function relDay(iso: string, today: string) { if (!today) return ''; if (iso === today) return 'Today'; const a = new Date(iso + 'T12:00:00'), b = new Date(today + 'T12:00:00'); const dd = Math.round((+a - +b) / 86400000); if (dd === 1) return 'Tomorrow'; return '' }

export default function VendorPage({ params }: { params: { v: string } }) {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<TabKey>('departures')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const seenInit = useRef(false)
  const SEEN_KEY = 'board_seen_' + params.v

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await fetch('/api/public/board?v=' + encodeURIComponent(params.v), { cache: 'no-store' })
      const j: Data = await res.json()
      if (res.status === 401 || (j as any).needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!res.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
      setLastUpdated(new Date())
      const ids: string[] = []
      for (const r of j.arrivals) ids.push(keyOf(r, 'arrivals'))
      for (const r of j.departures) ids.push(keyOf(r, 'departures'))
      for (const r of j.active) ids.push(keyOf(r, 'active'))
      if (!seenInit.current) { const st = new Set(ids); setSeen(st); seenInit.current = true; try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(st))) } catch {} }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [params.v])

  useEffect(() => { try { const raw = localStorage.getItem(SEEN_KEY); if (raw) { setSeen(new Set(JSON.parse(raw))); seenInit.current = true } } catch {} ; load() }, [load])
  useEffect(() => { const tm = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30 * 60 * 1000); return () => clearInterval(tm) }, [load])

  const resync = async () => { setSyncing(true); try { await fetch('/api/sync/guesty?only=reservations', { method: 'POST' }) } catch {} ; await load(); setSyncing(false) }
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

  if (needsPw) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-50">
      <form onSubmit={submitPw} className="w-full max-w-xs bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">Stay Hospitality</div>
          <h1 className="text-lg font-bold">Enter password</h1>
          <p className="text-xs text-neutral-500 mt-1">This schedule is password protected.</p>
        </div>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="Password" className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
        {pwErr && <div className="text-xs text-red-600">{pwErr}</div>}
        <button type="submit" disabled={pwBusy || !pw} className="w-full text-sm font-medium px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40">{pwBusy ? 'Checking…' : 'View schedule'}</button>
      </form>
    </div>
  )
  if (err) return <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm p-6">{err}</div>
  if (!data) return <div className="min-h-screen flex items-center justify-center text-neutral-400 text-sm">Loading…</div>

  const rows: Row[] = (data as any)[tab] || []
  const allIds: string[] = []
  for (const r of data.arrivals) allIds.push(keyOf(r, 'arrivals'))
  for (const r of data.departures) allIds.push(keyOf(r, 'departures'))
  for (const r of data.active) allIds.push(keyOf(r, 'active'))
  const newCount = seenInit.current ? allIds.filter(id => !seen.has(id)).length : 0
  const markSeen = () => { const st = new Set(allIds); setSeen(st); try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(st))) } catch {} }
  const isNew = (r: Row) => seenInit.current && !seen.has(keyOf(r, tab))

  // group rows into days
  const dayKeys: string[] = []
  const byDay: Record<string, Row[]> = {}
  for (const r of rows) { const k = dateFor(r, tab); if (!byDay[k]) { byDay[k] = []; dayKeys.push(k) } byDay[k].push(r) }
  dayKeys.sort()

  const exportCsv = () => {
    const head = [['Date', 'Unit', 'Guest', 'Bedrooms', 'Code', tab === 'departures' ? 'Checkout' : 'Check-in', 'Same-day turn', 'Notes']]
    const body = rows.map(r => [dateFor(r, tab), r.unit, r.guestName || '', bedLabel(r.bedrooms), r.doorCode || '', (tab === 'departures' ? r.checkOutTime : r.checkInTime) || '', r.sameDayTurn ? 'YES' : '', r.notes || ''])
    const csv = head.concat(body).map(line => line.map(x => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = params.v + '-' + tab + '.csv'
    a.click()
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-neutral-400 font-semibold">This week</div>
            <h1 className="text-2xl font-bold">{data.label}</h1>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {newCount > 0 && <button onClick={markSeen} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200">{newCount} new</button>}
            <button onClick={resync} disabled={syncing} className="text-sm px-3 py-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 font-medium disabled:opacity-50">{syncing ? 'Syncing…' : 'Resync'}</button>
            <button onClick={() => load()} className="text-sm px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 font-medium">Refresh</button>
            <button onClick={exportCsv} className="text-sm px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 font-medium">CSV</button>
            <button onClick={() => window.print()} className="text-sm px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 font-medium">Print</button>
          </div>
        </div>
        <div className="text-xs text-neutral-400 mb-4">{data.unitCount} units · {data.today ? fmtDate(data.today) : ''} – {data.end ? fmtDate(data.end) : ''}{lastUpdated ? ' · updated ' + lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</div>

        <div className="flex gap-1 mb-4 bg-neutral-100 rounded-xl p-1 print:hidden">
          {TABS.map(t => { const n = ((data as any)[t.key] || []).length; return (
            <button key={t.key} onClick={() => setTab(t.key)} className={'flex-1 text-sm font-medium px-3 py-2 rounded-lg transition ' + (tab === t.key ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-700')}>{t.label}<span className="ml-1.5 text-xs text-neutral-400">{n}</span></button>
          )})}
        </div>

        {rows.length === 0 && <div className="text-neutral-400 text-sm py-10 text-center">Nothing here this week.</div>}

        <div className="space-y-5">
          {dayKeys.map(day => (
            <div key={day} className="break-inside-avoid">
              <div className="flex items-baseline gap-2 mb-2 px-1">
                <h2 className="text-sm font-bold text-neutral-900">{fmtDate(day)}</h2>
                {relDay(day, data.today || '') && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-neutral-900 text-white">{relDay(day, data.today || '')}</span>}
                <span className="text-xs text-neutral-400">{byDay[day].length} {tab === 'departures' ? 'cleans' : tab === 'arrivals' ? 'arrivals' : 'staying'}</span>
              </div>
              <div className="space-y-2">
                {byDay[day].map((r, i) => {
                  const time = tab === 'departures' ? r.checkOutTime : r.checkInTime
                  const id = keyOf(r, tab) + i
                  const open = expanded === id
                  return (
                    <div key={id} className={'rounded-xl border bg-white break-inside-avoid ' + (isNew(r) ? 'border-amber-300 ring-1 ring-amber-200' : 'border-neutral-200')}>
                      <button onClick={() => setExpanded(open ? '' : id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate">{r.unit}</span>
                            {isNew(r) && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white">New</span>}
                            {tab === 'departures' && r.sameDayTurn && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">Same-day turn</span>}
                            {r.notes && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Note</span>}
                          </div>
                          <div className="text-xs text-neutral-500 truncate">{r.guestName || 'Guest'}{r.guests ? ' · ' + r.guests + ' guests' : ''}{bedLabel(r.bedrooms) ? ' · ' + bedLabel(r.bedrooms) : ''}{r.doorCode ? ' · code ' + r.doorCode : ''}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {time && <div className="text-sm font-medium text-emerald-700">{tab === 'departures' ? 'out ' : 'in '}{time}</div>}
                          {tab === 'active' && <div className="text-xs text-neutral-400">out {fmtDate(r.checkOut)}</div>}
                        </div>
                        <span className="text-neutral-300 text-xs">{open ? '▲' : '▼'}</span>
                      </button>
                      {open && (
                        <div className="px-4 pb-4 pt-1 border-t border-neutral-100 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <Field label="Guest" value={r.guestName || '—'} />
                          <Field label="Phone" value={r.phone || '—'} />
                          <Field label="Check-in" value={fmtDate(r.checkIn) + (r.checkInTime ? ' · ' + r.checkInTime : '')} />
                          <Field label="Check-out" value={fmtDate(r.checkOut) + (r.checkOutTime ? ' · ' + r.checkOutTime : '')} />
                          <Field label="Nights" value={r.nights != null ? String(r.nights) : '—'} />
                          <Field label="Guests" value={r.guests != null ? String(r.guests) : '—'} />
                          <Field label="Door code" value={r.doorCode || '—'} />
                          <Field label="Confirmation" value={r.confirmationCode || '—'} />
                          <Field label="Source" value={r.source || '—'} />
                          <Field label="Unit" value={bedLabel(r.bedrooms) || '—'} />
                          {r.notes && <div className="col-span-2"><div className="text-xs uppercase tracking-wide text-neutral-400">Reservation notes</div><div className="text-neutral-900 whitespace-pre-wrap bg-neutral-50 rounded px-2 py-1 mt-0.5">{r.notes}</div></div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (<div><div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div><div className="text-neutral-900 break-words">{value}</div></div>)
}
