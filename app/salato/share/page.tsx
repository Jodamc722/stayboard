'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

type Row = { id?: string; unit: string; checkIn: string; checkOut: string; nights: number | null; checkInTime: string | null; checkOutTime: string | null; guests: number | null; source: string | null; sameDayTurn: boolean; verified?: boolean; verifiedAt?: string | null }
type Data = { ok: boolean; today: string; unitCount?: number; arrivals: Row[]; departures: Row[]; active: Row[]; error?: string }
type ViewData = { ok: boolean; fullName?: string | null; unit?: string | null; signedAt?: string | null; idUrl?: string | null; selfieUrl?: string | null; signatureUrl?: string | null }

const SEEN_KEY = 'salato_share_seen_v1'
type TabKey = 'verify' | 'arrivals' | 'departures' | 'active'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'verify', label: 'Verify' },
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departure cleans' },
  { key: 'active', label: 'In-house' },
]
function fmtDate(iso: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
// 12-hour clock: "16:00" -> "4:00 PM" (times come from the API as 24h HH:MM)
function fmtTime(t: string | null | undefined) { if (!t) return ''; const m = /^(\d{1,2}):(\d{2})/.exec(String(t)); if (!m) return String(t); let h = parseInt(m[1], 10); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap }
function keyOf(r: Row, mode: string) { return r.unit + '|' + (mode === 'departures' ? r.checkOut : r.checkIn) }
// A day heading reads better than a date on every row: "Today", "Tomorrow", then the weekday.
function dayLabel(iso: string, today: string) {
  if (!iso) return ''
  if (iso === today) return 'Today'
  const dd = Math.round((+new Date(iso + 'T12:00:00') - +new Date(today + 'T12:00:00')) / 86400000)
  if (dd === 1) return 'Tomorrow'
  if (dd === -1) return 'Yesterday'
  return fmtDate(iso)
}
function groupByDay(rows: Row[], dateOf: (r: Row) => string) {
  const m: Record<string, Row[]> = {}
  for (const r of rows) (m[dateOf(r)] = m[dateOf(r)] || []).push(r)
  return Object.keys(m).sort().map(d => ({ date: d, rows: m[d] }))
}

export default function SalatoShare() {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<TabKey>('verify')
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

  // "Verify" lists everyone a front desk checks in: upcoming arrivals + in-house guests.
  // Verify tab = everyone the desk checks in (upcoming arrivals + in-house), unverified first.
  const rows = data ? (tab === 'verify' ? data.arrivals.concat(data.active).slice().sort((a, b) => (a.verified === b.verified ? 0 : a.verified ? 1 : -1)) : data[tab]) : []
  const dateOf = (r: Row) => tab === 'departures' ? r.checkOut : r.checkIn
  const groups = groupByDay(rows, dateOf)
  const idPrefix = tab === 'arrivals' ? 'a' : tab === 'departures' ? 'd' : 'v'
  const isNew = (r: Row) => seenInit.current && !seen.has(idPrefix + keyOf(r, tab))
  const allIds = data ? [...data.arrivals.map(r => 'a' + keyOf(r, 'arrivals')), ...data.departures.map(r => 'd' + keyOf(r, 'departures')), ...data.active.map(r => 'v' + keyOf(r, 'active'))] : []
  const newCount = seenInit.current ? allIds.filter(id => !seen.has(id)).length : 0
  const markSeen = () => { const s = new Set(allIds); setSeen(s); try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s))) } catch {} }

  // ---- ID/selfie viewer (share-password gated) ----
  const [viewRid, setViewRid] = useState<string | null>(null)
  const [viewData, setViewData] = useState<ViewData | null>(null)
  const [viewBusy, setViewBusy] = useState(false)
  const [viewErr, setViewErr] = useState('')
  const [pwNeeded, setPwNeeded] = useState(false)
  const [pw, setPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const fetchView = useCallback(async (rid: string) => {
    setViewBusy(true); setViewErr('')
    try {
      const r = await fetch('/api/public/salato-verify-view?rid=' + encodeURIComponent(rid), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 || j.needsPassword) { setPwNeeded(true); setViewBusy(false); return }
      if (!r.ok || j.ok === false) { setViewErr(j.error || 'Could not load.'); setViewBusy(false); return }
      setPwNeeded(false); setViewData(j)
    } catch (e: any) { setViewErr(String(e?.message || e)) } finally { setViewBusy(false) }
  }, [])

  const openViewer = (rid: string) => { setViewRid(rid); setViewData(null); setViewErr(''); setPwNeeded(false); fetchView(rid) }
  const closeViewer = () => { setViewRid(null); setViewData(null); setPwNeeded(false); setPw(''); setViewErr('') }
  const submitPw = async () => {
    if (!pw.trim() || !viewRid) return
    setPwBusy(true); setViewErr('')
    try {
      const r = await fetch('/api/public/share-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setViewErr(j.error || 'Wrong password'); setPwBusy(false); return }
      setPw(''); setPwBusy(false); await fetchView(viewRid)
    } catch (e: any) { setViewErr(String(e?.message || e)); setPwBusy(false) }
  }

  // Deep link from Guesty / anywhere: /salato/share?verify=<reservationId> opens that guest's record.
  useEffect(() => {
    try { const p = new URLSearchParams(window.location.search).get('verify'); if (p && /^[a-z0-9]{6,40}$/i.test(p)) openViewer(p) } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // No app Shell on this link, so it pads for the phone itself. px-safe goes on the outer element
    // because it would replace the px-4 gutter if it shared one.
    <div className='min-h-screen bg-neutral-100 text-neutral-900 px-safe'>
      <div className='max-w-2xl mx-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]'>
        <div className='rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 shadow-lg overflow-hidden mb-4'>
          <div className='p-5'>
            <div className='flex items-start justify-between gap-3 flex-wrap'>
              <div>
                <div className='flex items-center gap-2.5'>
                  <span className='text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold'>Stay Hospitality</span>
                  <span className='inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300'><span className='relative flex h-1.5 w-1.5'><span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75'></span><span className='relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400'></span></span>LIVE</span>
                </div>
                <h1 className='text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight'>Salato</h1>
                <p className='text-xs text-neutral-400 mt-1.5'>Front desk{data?.unitCount ? ' · ' + data.unitCount + ' units' : ''}{lastUpdated ? ' · updated ' + lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''} · auto-refreshes every 30 min</p>
              </div>
              <div className='flex items-center gap-2 flex-wrap gap-y-2'>
                {newCount > 0 && <button onClick={markSeen} className='text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-400 text-neutral-900 hover:bg-amber-300 transition-colors'>{newCount} new</button>}
                <button onClick={resync} disabled={syncing} className='text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 disabled:opacity-40 transition-colors'>{syncing ? 'Syncing…' : 'Resync'}</button>
                <button onClick={() => { setLoading(true); load() }} className='text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 transition-colors'>Refresh</button>
              </div>
            </div>
          </div>
        </div>

        {/* "Departure cleans" will not shrink below its text, so four tabs pushed the whole page
            sideways on a 375px screen. The strip scrolls itself instead. */}
        <div className='flex gap-1 mb-4 bg-white border border-neutral-200 rounded-xl p-1 shadow-sm overflow-x-auto'>
          {TABS.map(t => { const n = data ? (t.key === 'verify' ? (data.arrivals.length + data.active.length) : data[t.key].length) : 0; return (
            <button key={t.key} onClick={() => setTab(t.key)} className={'flex-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors ' + (tab === t.key ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100')}>{t.label}<span className={'ml-1.5 text-xs ' + (tab === t.key ? 'text-neutral-300' : 'text-neutral-400')}>{n}</span></button>
          )})}
        </div>

        {loading && !data && <div className='text-neutral-400 text-sm py-10 text-center'>Loading…</div>}
        {err && <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3'>{err}</div>}
        {data && rows.length === 0 && !loading && <div className='text-neutral-400 text-sm py-10 text-center'>Nothing here right now.</div>}

        {/* Grouped under one heading per day, so the desk reads "who is arriving today" at a
            glance instead of re-reading the date on every card. */}
        {data && groups.map(g => (
          <div key={g.date} className='mb-4'>
            <div className='flex items-baseline gap-2 px-1 mb-1.5'>
              <span className='text-sm font-bold text-neutral-900'>{dayLabel(g.date, data.today)}</span>
              {dayLabel(g.date, data.today) !== fmtDate(g.date) && <span className='text-xs text-neutral-400'>{fmtDate(g.date)}</span>}
              <span className='flex-1' />
              <span className='text-xs text-neutral-400'>{g.rows.length}</span>
            </div>
            <div className='rounded-2xl border border-neutral-200 bg-white shadow-sm divide-y divide-neutral-100 overflow-hidden'>
              {g.rows.map((r, i) => {
                const time = tab === 'departures' ? r.checkOutTime : r.checkInTime
                const showVerify = (tab === 'arrivals' || tab === 'active' || tab === 'verify') && !!r.id
                return (
                  <div key={i} className={'px-4 py-3 ' + (isNew(r) ? 'bg-amber-50/60' : '')}>
                    <div className='flex items-start gap-3'>
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2 flex-wrap'>
                          <span className='text-[15px] font-bold text-neutral-900 truncate'>{r.unit}</span>
                          {isNew(r) && <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white'>New</span>}
                          {tab === 'departures' && r.sameDayTurn && <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700'>Same-day turn</span>}
                        </div>
                        <div className='text-xs text-neutral-500 mt-0.5'>
                          {[time ? (tab === 'departures' ? 'Out ' : 'ETA ') + fmtTime(time) : null,
                            r.guests ? r.guests + ' guests' : null,
                            (tab === 'active' || tab === 'verify') ? 'out ' + fmtDate(r.checkOut) : null,
                            r.source].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {showVerify && (r.verified
                        ? <button onClick={() => r.id && openViewer(r.id)} className='shrink-0 text-xs font-semibold px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800'>✓ Verified</button>
                        : <a href={'/salato/verify/' + r.id} target='_blank' rel='noopener noreferrer' className='shrink-0 text-xs font-semibold px-3 py-2 rounded-xl bg-neutral-900 text-white'>Verify</a>)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {viewRid && (
        <div className='fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4' onClick={closeViewer}>
          {/* 90vh counts Safari's URL bar, so on a phone the ID photo ran off the bottom of the
              glass with nothing to scroll. dvh is what you can actually see. */}
          <div className='bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90dvh] sm:max-h-[90vh] overflow-y-auto' onClick={e => e.stopPropagation()}>
            <div className='flex items-center justify-between px-5 py-4 border-b border-neutral-100 sticky top-0 bg-white rounded-t-2xl'>
              <div className='font-bold'>Verification</div>
              <button onClick={closeViewer} className='text-neutral-400 hover:text-neutral-700 text-xl leading-none'>×</button>
            </div>
            <div className='p-5'>
              {viewErr && <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3'>{viewErr}</div>}
              {pwNeeded ? (
                <div>
                  <p className='text-sm text-neutral-600 mb-3'>Enter the share password to view this guest's ID and selfie.</p>
                  <input type='password' value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitPw() }} autoFocus placeholder='Password' className='w-full text-sm border border-neutral-300 rounded-lg px-3 py-2.5 mb-3 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400' />
                  <button onClick={submitPw} disabled={pwBusy || !pw.trim()} className='w-full rounded-xl bg-neutral-900 text-white font-semibold py-2.5 hover:bg-neutral-800 disabled:opacity-40'>{pwBusy ? 'Unlocking…' : 'Unlock'}</button>
                </div>
              ) : viewBusy ? (
                <div className='text-neutral-400 text-sm py-8 text-center'>Loading…</div>
              ) : viewData ? (
                <div className='space-y-4'>
                  <div className='text-sm'>
                    <div className='font-semibold text-base'>{viewData.fullName || '—'}</div>
                    <div className='text-neutral-500'>{viewData.unit || ''}{viewData.signedAt ? ' · signed ' + new Date(viewData.signedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                  </div>
                  {viewData.idUrl && <div><div className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1'>Government ID</div><a href={viewData.idUrl} target='_blank' rel='noopener noreferrer'><img src={viewData.idUrl} alt='ID' className='w-full rounded-xl border border-neutral-200' /></a></div>}
                  {viewData.selfieUrl && <div><div className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1'>Selfie</div><a href={viewData.selfieUrl} target='_blank' rel='noopener noreferrer'><img src={viewData.selfieUrl} alt='Selfie' className='w-full max-h-80 object-contain rounded-xl border border-neutral-200 bg-neutral-50' /></a></div>}
                  {viewData.signatureUrl && <div><div className='text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1'>Signature</div><img src={viewData.signatureUrl} alt='Signature' className='w-full rounded-xl border border-neutral-200 bg-white' /></div>}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
