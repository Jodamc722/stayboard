'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

type Row = { id?: string; unit: string; checkIn: string; checkOut: string; nights: number | null; bedrooms: number | null; doorCode: string | null; checkInTime: string | null; checkOutTime: string | null; guests: number | null; source: string | null; sameDayTurn: boolean; extended?: boolean; extendedTo?: string | null; cleanDay?: string | null; guestName: string | null; phone: string | null; confirmationCode: string | null; notes: string | null; resNotes?: string; customFields?: { label: string; value: string }[] }
type Data = { ok: boolean; label?: string; today?: string; start?: string; end?: string; unitCount?: number; bannerImage?: string | null; lastSync?: string | null; arrivals: Row[]; departures: Row[]; active: Row[]; upcoming: Row[]; error?: string }
type TabKey = 'arrivals' | 'departures' | 'active' | 'upcoming'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departure cleans' },
  { key: 'active', label: 'Active reservations' },
  { key: 'upcoming', label: 'Upcoming' },
]
function fmtDate(iso: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
// 12-hour clock: "16:00" -> "4:00 PM" (times come from the API as 24h HH:MM)
function fmtTime(t: string | null | undefined) { if (!t) return ''; const m = /^(\d{1,2}):(\d{2})/.exec(String(t)); if (!m) return String(t); let h = parseInt(m[1], 10); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap }
function dateFor(r: Row, tab: TabKey) { return tab === 'departures' ? (r.cleanDay || r.checkOut) : r.checkIn }
function bedLabel(n: number | null) { if (n == null) return ''; return n === 0 ? 'Studio' : n + 'BR' }
function keyOf(r: Row, tab: TabKey) { return tab.charAt(0) + r.unit + '|' + dateFor(r, tab) }
function relDay(iso: string, today: string) { if (!today) return ''; if (iso === today) return 'Today'; const a = new Date(iso + 'T12:00:00'), b = new Date(today + 'T12:00:00'); const dd = Math.round((+a - +b) / 86400000); if (dd === 1) return 'Tomorrow'; return '' }

export default function VendorPage({ params }: { params: { v: string } }) {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<TabKey>('departures')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const seenInit = useRef(false)
  const SEEN_KEY = 'board_seen_' + params.v
  const [noteText, setNoteText] = useState('')
  const [noteBy, setNoteBy] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteMsg, setNoteMsg] = useState('')
  useEffect(() => { try { const b = localStorage.getItem('board_note_by'); if (b) setNoteBy(b) } catch {} }, [])

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
      for (const r of (j.upcoming || [])) ids.push(keyOf(r, 'upcoming'))
      if (!seenInit.current) { const st = new Set(ids); setSeen(st); seenInit.current = true; try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(st))) } catch {} }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [params.v])

  useEffect(() => { try { const raw = localStorage.getItem(SEEN_KEY); if (raw) { setSeen(new Set(JSON.parse(raw))); seenInit.current = true } } catch {} ; load() }, [load])
  useEffect(() => { const tm = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30 * 60 * 1000); return () => clearInterval(tm) }, [load])
  // refresh the moment someone opens / returns to the link, not just on the 30-min tick
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
  }, [load])

  const resync = async () => {
    setSyncing(true); setSyncMsg('')
    try {
      const r = await fetch('/api/public/board-resync', { method: 'POST' })
      const j = await r.json()
      if (r.status === 429 && j.nextAt) {
        const mins = Math.max(1, Math.ceil((new Date(j.nextAt).getTime() - Date.now()) / 60000))
        setSyncMsg('Synced recently — you can sync again in ' + mins + ' min')
      } else if (!r.ok || !j.ok) { setSyncMsg(j.error || 'Sync failed') }
      else { setSyncMsg('Synced ' + (j.synced || 0) + ' reservations') }
    } catch (e: any) { setSyncMsg(String(e?.message || e)) }
    await load()
    setSyncing(false)
  }
  const doRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const saveNote = async (rid: string) => {
    if (!noteText.trim()) return
    setNoteBusy(true); setNoteMsg('')
    try {
      const r = await fetch('/api/public/board-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: rid, note: noteText.trim(), by: noteBy.trim() }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setNoteMsg(j.error || 'Could not save'); setNoteBusy(false); return }
      setNoteText(''); setNoteMsg('Saved to Guesty'); try { localStorage.setItem('board_note_by', noteBy.trim()) } catch {}
      await load()
    } catch (e: any) { setNoteMsg(String(e?.message || e)) }
    setNoteBusy(false)
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

  if (needsPw) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-100">
      <form onSubmit={submitPw} className="w-full max-w-sm bg-white border border-neutral-200 rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-br from-neutral-900 to-neutral-800 px-6 pt-6 pb-7">
          <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold">Stay Hospitality</div>
          <h1 className="text-2xl font-bold text-white mt-1">Vendor schedule</h1>
          <p className="text-xs text-neutral-400 mt-1">Password protected</p>
        </div>
        <div className="p-6 space-y-3">
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="Enter password" className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400" />
          {pwErr && <div className="text-xs text-red-600">{pwErr}</div>}
          <button type="submit" disabled={pwBusy || !pw} className="w-full text-sm font-semibold px-3 py-2.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40 transition-colors">{pwBusy ? 'Checking…' : 'View schedule'}</button>
        </div>
      </form>
    </div>
  )
  if (err) return <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm p-6 bg-neutral-100">{err}</div>
  if (!data) return <div className="min-h-screen flex items-center justify-center text-neutral-400 text-sm bg-neutral-100">Loading…</div>

  const rows: Row[] = (data as any)[tab] || []
  const allIds: string[] = []
  for (const r of data.arrivals) allIds.push(keyOf(r, 'arrivals'))
  for (const r of data.departures) allIds.push(keyOf(r, 'departures'))
  for (const r of data.active) allIds.push(keyOf(r, 'active'))
  for (const r of (data.upcoming || [])) allIds.push(keyOf(r, 'upcoming'))
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
    const body = rows.map(r => [dateFor(r, tab), r.unit, r.guestName || '', bedLabel(r.bedrooms), r.doorCode || '', fmtTime(tab === 'departures' ? r.checkOutTime : r.checkInTime), r.sameDayTurn ? 'YES' : '', r.extended ? 'EXTENDED - do not clean (now out ' + (r.extendedTo || '') + ')' : (r.resNotes || r.notes || '')])
    const csv = head.concat(body).map(line => line.map(x => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = params.v + '-' + tab + '.csv'
    a.click()
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 print:bg-white">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="relative rounded-2xl bg-neutral-900 shadow-lg overflow-hidden mb-4" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
          {data.bannerImage ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url("' + data.bannerImage + '")' }} aria-hidden="true" /> : null}
          <div className={'absolute inset-0 ' + (data.bannerImage ? 'bg-gradient-to-br from-black/85 via-black/70 to-black/55' : 'bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800')} aria-hidden="true" />
          <div className="relative p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold">Stay Hospitality</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 print:hidden"><span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400"></span></span>LIVE</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight">{data.label}</h1>
                <p className="text-xs text-neutral-400 mt-1.5">This week · {data.unitCount} units · {data.today ? fmtDate(data.today) : ''} – {data.end ? fmtDate(data.end) : ''}{lastUpdated ? ' · updated ' + lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}{data.lastSync ? ' · synced ' + new Date(data.lastSync).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</p>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                {newCount > 0 && <button onClick={markSeen} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-400 text-neutral-900 hover:bg-amber-300 transition-colors">{newCount} new</button>}
                <button onClick={resync} disabled={syncing} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 disabled:opacity-40 transition-colors">{syncing ? 'Syncing…' : 'Resync'}</button>
                <button onClick={doRefresh} disabled={refreshing} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 disabled:opacity-40 transition-colors">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
                <button onClick={exportCsv} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 transition-colors">CSV</button>
                <button onClick={() => window.print()} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 transition-colors">Print</button>
              </div>
            </div>
          </div>
        </div>
        {syncMsg && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-3 inline-block print:hidden">{syncMsg}</div>}

        <div className="flex gap-1 mb-4 bg-white border border-neutral-200 rounded-xl p-1 shadow-sm print:hidden">
          {TABS.map(t => { const n = ((data as any)[t.key] || []).length; return (
            <button key={t.key} onClick={() => setTab(t.key)} className={'flex-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors ' + (tab === t.key ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100')}>{t.label}<span className={'ml-1.5 text-xs ' + (tab === t.key ? 'text-neutral-300' : 'text-neutral-400')}>{n}</span></button>
          )})}
        </div>

        {rows.length === 0 && <div className="text-neutral-400 text-sm py-10 text-center">{tab === 'upcoming' ? 'No upcoming reservations in the next 30 days.' : 'Nothing here this week.'}</div>}

        <div className="space-y-5">
          {dayKeys.map(day => (
            <div key={day} className="break-inside-avoid">
              <div className="flex items-baseline gap-2 mb-2 px-1">
                <h2 className="text-sm font-bold text-neutral-900">{fmtDate(day)}</h2>
                {relDay(day, data.today || '') && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-neutral-900 text-white">{relDay(day, data.today || '')}</span>}
                <span className="text-xs text-neutral-400">{byDay[day].length} {tab === 'departures' ? 'cleans' : (tab === 'arrivals' || tab === 'upcoming') ? 'arrivals' : 'staying'}</span>
              </div>
              <div className="space-y-2">
                {byDay[day].map((r, i) => {
                  const time = tab === 'departures' ? r.checkOutTime : r.checkInTime
                  const id = keyOf(r, tab) + i
                  const open = expanded === id
                  return (
                    <div key={id} className={'rounded-2xl border bg-white shadow-sm break-inside-avoid ' + (isNew(r) ? 'border-amber-300 ring-1 ring-amber-200' : 'border-neutral-200')}>
                      <button onClick={() => { setExpanded(open ? '' : id); setNoteText(''); setNoteMsg('') }} className="w-full text-left px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate">{r.unit}</span>
                            {isNew(r) && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white">New</span>}
                            {tab === 'departures' && r.sameDayTurn && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">Same-day turn</span>}
                            {r.extended && <span title="Guest extended - this unit is still occupied. Do not clean." className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500 text-white">Extended {'\u00b7'} do not clean</span>}
                            {(r.resNotes || r.notes) && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Note</span>}
                          </div>
                          <div className="text-xs text-neutral-500 truncate">{r.guestName || 'Guest'}{r.guests ? ' · ' + r.guests + ' guests' : ''}{bedLabel(r.bedrooms) ? ' · ' + bedLabel(r.bedrooms) : ''}{r.doorCode ? ' · code ' + r.doorCode : ''}{r.extended && r.extendedTo ? ' · now out ' + fmtDate(r.extendedTo) : ''}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {time && <div className="text-sm font-medium text-emerald-700">{tab === 'departures' ? 'out ' : 'in '}{fmtTime(time)}</div>}
                          {(tab === 'active' || tab === 'upcoming') && <div className="text-xs text-neutral-400">out {fmtDate(r.checkOut)}</div>}
                        </div>
                        <span className="text-neutral-300 text-xs">{open ? '▲' : '▼'}</span>
                      </button>
                      {open && (
                        <div className="px-4 pb-4 pt-1 border-t border-neutral-100 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <Field label="Guest" value={r.guestName || '—'} />
                          <Field label="Phone" value={r.phone || '—'} />
                          <Field label="Check-in" value={fmtDate(r.checkIn) + (r.checkInTime ? ' · ' + fmtTime(r.checkInTime) : '')} />
                          <Field label="Check-out" value={fmtDate(r.checkOut) + (r.checkOutTime ? ' · ' + fmtTime(r.checkOutTime) : '')} />
                          <Field label="Nights" value={r.nights != null ? String(r.nights) : '—'} />
                          <Field label="Guests" value={r.guests != null ? String(r.guests) : '—'} />
                          <Field label="Door code" value={r.doorCode || '—'} />
                          <Field label="Confirmation" value={r.confirmationCode || '—'} />
                          <Field label="Source" value={r.source || '—'} />
                          <Field label="Unit" value={bedLabel(r.bedrooms) || '—'} />
                          {r.customFields && r.customFields.length > 0 && (
                            <div className="col-span-2 mt-1">
                              <div className="text-xs uppercase tracking-wide text-neutral-400 mb-1">Details</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                {r.customFields.map((c, ci) => <Field key={ci} label={c.label} value={c.value} />)}
                              </div>
                            </div>
                          )}
                          <div className="col-span-2 mt-1">
                            <div className="text-xs uppercase tracking-wide text-neutral-400">Reservation notes</div>
                            {(r.resNotes || r.notes) ? <div className="text-neutral-900 whitespace-pre-wrap bg-neutral-50 rounded px-2 py-1 mt-0.5 text-[13px]">{r.resNotes || r.notes}</div> : <div className="text-neutral-400 text-[13px] mt-0.5">No notes yet.</div>}
                            {r.id && (
                              <div className="mt-2 print:hidden">
                                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note — saves to Guesty…" rows={2} className="w-full text-sm border border-neutral-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-300" />
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <input value={noteBy} onChange={e => setNoteBy(e.target.value)} placeholder="Your name" className="text-sm border border-neutral-200 rounded-lg px-2 py-1.5 w-32" />
                                  <button onClick={() => saveNote(r.id as string)} disabled={noteBusy || !noteText.trim()} className="text-sm font-medium px-3 py-1.5 rounded-lg bg-neutral-900 text-white disabled:opacity-40">{noteBusy ? 'Saving…' : 'Add note'}</button>
                                  {noteMsg && <span className="text-xs text-neutral-500">{noteMsg}</span>}
                                </div>
                              </div>
                            )}
                          </div>
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
