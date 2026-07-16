'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

type Row = { unit: string; checkIn: string; checkOut: string; nights: number | null; bedrooms: number | null; doorCode: string | null; checkInTime: string | null; checkOutTime: string | null; guests: number | null; source: string | null; sameDayTurn: boolean }
type Data = { ok: boolean; label?: string; today?: string; start?: string; end?: string; unitCount?: number; arrivals: Row[]; departures: Row[]; active: Row[]; error?: string }
type TabKey = 'arrivals' | 'departures' | 'active'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departure cleans' },
  { key: 'active', label: 'Active reservations' },
]
function fmtDate(iso: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function dateFor(r: Row, tab: TabKey) { return tab === 'departures' ? r.checkOut : r.checkIn }
function keyOf(r: Row, tab: TabKey) { return tab.charAt(0) + r.unit + '|' + dateFor(r, tab) }

export default function VendorPage({ params }: { params: { v: string } }) {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<TabKey>('departures')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const seenInit = useRef(false)
  const SEEN_KEY = 'board_seen_' + params.v

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await fetch('/api/public/board?v=' + encodeURIComponent(params.v), { cache: 'no-store' })
      const j: Data = await res.json()
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

  const exportCsv = () => {
    const head = [['Date', 'Unit', 'Bedrooms', 'Door code', tab === 'departures' ? 'Checkout' : 'Check-in', 'Same-day turn']]
    const body = rows.map(r => [dateFor(r, tab), r.unit, String(r.bedrooms ?? ''), r.doorCode || '', (tab === 'departures' ? r.checkOutTime : r.checkInTime) || '', r.sameDayTurn ? 'YES' : ''])
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

        {loading && <div className="text-neutral-400 text-sm py-8 text-center">Loading…</div>}
        {!loading && rows.length === 0 && <div className="text-neutral-400 text-sm py-10 text-center">Nothing here this week.</div>}
        <div className="space-y-2">
          {rows.map((r, i) => {
            const time = tab === 'departures' ? r.checkOutTime : r.checkInTime
            return (
              <div key={i} className={'rounded-xl border bg-white px-4 py-3 flex items-center gap-3 break-inside-avoid ' + (isNew(r) ? 'border-amber-300 ring-1 ring-amber-200' : 'border-neutral-200')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{r.unit}</span>
                    {isNew(r) && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white">New</span>}
                    {tab === 'departures' && r.sameDayTurn && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">Same-day turn</span>}
                  </div>
                  <div className="text-xs text-neutral-500">{r.bedrooms != null ? r.bedrooms + 'BR' : ''}{r.doorCode ? ' · code ' + r.doorCode : ''}{r.guests ? ' · ' + r.guests + ' guests' : ''}{tab === 'active' ? ' · out ' + fmtDate(r.checkOut) : ''}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium">{fmtDate(dateFor(r, tab))}</div>
                  {time && <div className="text-xs text-emerald-700 font-medium">{tab === 'departures' ? 'out ' : 'in '}{time}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
