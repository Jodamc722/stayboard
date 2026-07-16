'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

type Row = { unit: string; checkIn: string; checkOut: string; nights: number | null; checkInTime: string | null; checkOutTime: string | null; guests: number | null; source: string | null; sameDayTurn: boolean }
type Data = { ok: boolean; today: string; arrivals: Row[]; departures: Row[]; active: Row[]; error?: string }

const SEEN_KEY = 'salato_share_seen_v1'
const TABS: { key: 'arrivals' | 'departures' | 'active'; label: string }[] = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departure cleans' },
  { key: 'active', label: 'In-house' },
]
function fmtDate(iso: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function keyOf(r: Row, mode: string) { return r.unit + '|' + (mode === 'departures' ? r.checkOut : r.checkIn) }

export default function SalatoShare() {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<'arrivals' | 'departures' | 'active'>('arrivals')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const seenInit = useRef(false)

  const load = useCallback(async () => {
    try {
      setErr('')
      const res = await fetch('/api/public/salato', { cache: 'no-store' })
      const j: Data = await res.json()
      if (!res.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
      setLastUpdated(new Date())
      const ids = [...j.arrivals.map(r => 'a' + keyOf(r, 'arrivals')), ...j.departures.map(r => 'd' + keyOf(r, 'departures')), ...j.active.map(r => 'v' + keyOf(r, 'active'))]
      if (!seenInit.current) { const s = new Set(ids); setSeen(s); seenInit.current = true; try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s))) } catch {} }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { try { const raw = localStorage.getItem(SEEN_KEY); if (raw) { setSeen(new Set(JSON.parse(raw))); seenInit.current = true } } catch {} ; load() }, [load])
  useEffect(() => { const tm = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30 * 60 * 1000); return () => clearInterval(tm) }, [load])

  const resync = useCallback(async () => {
    setSyncing(true)
    try { await fetch('/api/sync/guesty?only=reservations', { method: 'POST' }) } catch {}
    await load()
    setSyncing(false)
  }, [load])

  const rows = data ? data[tab] : []
  const idPrefix = tab === 'arrivals' ? 'a' : tab === 'departures' ? 'd' : 'v'
  const isNew = (r: Row) => seenInit.current && !seen.has(idPrefix + keyOf(r, tab))
  const allIds = data ? [...data.arrivals.map(r => 'a' + keyOf(r, 'arrivals')), ...data.departures.map(r => 'd' + keyOf(r, 'departures')), ...data.active.map(r => 'v' + keyOf(r, 'active'))] : []
  const newCount = seenInit.current ? allIds.filter(id => !seen.has(id)).length : 0
  const markSeen = () => { const s = new Set(allIds); setSeen(s); try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s))) } catch {} }

  return (
    <div className='min-h-screen bg-neutral-50 text-neutral-900'>
      <div className='max-w-2xl mx-auto px-4 py-6'>
        <div className='flex items-center justify-between gap-3 flex-wrap mb-1'>
          <div>
            <div className='text-[11px] uppercase tracking-widest text-neutral-400 font-semibold'>Front desk</div>
            <h1 className='text-2xl font-bold'>Salato</h1>
          </div>
          <div className='flex items-center gap-2'>
            {newCount > 0 && <button onClick={markSeen} className='text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200'>{newCount} new</button>}
            <button onClick={resync} disabled={syncing} className='text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-50'>{syncing ? 'Syncing…' : 'Resync'}</button>
            <button onClick={() => { setLoading(true); load() }} className='text-sm font-medium px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100'>Refresh</button>
          </div>
        </div>
        <div className='text-xs text-neutral-400 mb-4'>{lastUpdated ? 'Updated ' + lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · auto-refreshes every 30 min' : 'Loading…'}</div>

        <div className='flex gap-1 mb-4 bg-neutral-100 rounded-xl p-1'>
          {TABS.map(t => { const n = data ? data[t.key].length : 0; return (
            <button key={t.key} onClick={() => setTab(t.key)} className={'flex-1 text-sm font-medium px-3 py-2 rounded-lg transition ' + (tab === t.key ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-700')}>{t.label}<span className='ml-1.5 text-xs text-neutral-400'>{n}</span></button>
          )})}
        </div>

        {loading && !data && <div className='text-neutral-400 text-sm py-10 text-center'>Loading…</div>}
        {err && <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3'>{err}</div>}
        {data && rows.length === 0 && !loading && <div className='text-neutral-400 text-sm py-10 text-center'>Nothing here right now.</div>}
        <div className='space-y-2'>
          {rows.map((r, i) => {
            const dateIso = tab === 'departures' ? r.checkOut : r.checkIn
            const time = tab === 'departures' ? r.checkOutTime : r.checkInTime
            return (
              <div key={i} className={'rounded-xl border bg-white px-4 py-3 flex items-center gap-3 ' + (isNew(r) ? 'border-amber-300 ring-1 ring-amber-200' : 'border-neutral-200')}>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 flex-wrap'>
                    <span className='font-semibold truncate'>{r.unit}</span>
                    {isNew(r) && <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white'>New</span>}
                    {tab === 'departures' && r.sameDayTurn && <span className='text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200'>Same-day turn</span>}
                  </div>
                  <div className='text-xs text-neutral-500'>{r.guests ? r.guests + ' guests' : ''}{r.source ? (r.guests ? ' · ' : '') + r.source : ''}{tab === 'active' ? ' · out ' + fmtDate(r.checkOut) : ''}</div>
                </div>
                <div className='text-right shrink-0'>
                  <div className='text-sm font-medium'>{fmtDate(dateIso)}</div>
                  {time && <div className='text-xs text-emerald-700 font-medium'>{tab === 'departures' ? 'out ' : 'ETA '}{time}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
