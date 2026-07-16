'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

type Note = { id: string; author: string; body: string; at: string }
type Res = {
  id: string; unit: string; listingId: string; guest: string | null; phone: string | null; email: string | null;
  checkIn: string; checkOut: string; nights: number | null; checkInTime: string | null; plannedArrival: string | null;
  guests: number | null; source: string | null; confirmationCode: string | null; createdAt: string | null;
  guestNotes: string[]; custom: { field: string; value: string }[]; teamNotes: Note[]; status: string
}
type Data = { ok: boolean; today: string; arrivals: Res[]; departures: Res[]; active: Res[]; error?: string }

const SEEN_KEY = 'salato_seen_v1'
const TABS: { key: 'arrivals' | 'departures' | 'active'; label: string }[] = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departure cleans' },
  { key: 'active', label: 'Active reservations' },
]

function fmtDate(iso: string) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function relDay(iso: string, today: string) { if (iso === today) return 'Today'; const a = new Date(iso + 'T12:00:00'), b = new Date(today + 'T12:00:00'); const dd = Math.round((+a - +b) / 86400000); if (dd === 1) return 'Tomorrow'; if (dd === -1) return 'Yesterday'; return null }
function etaOf(r: Res): string | null { const c = r.custom.find(x => /eta|arriv/i.test(x.field)); if (c) return c.value; if (r.plannedArrival) return String(r.plannedArrival); if (r.checkInTime) return r.checkInTime; return null }
function carOf(r: Res): string | null { const c = r.custom.find(x => /car|vehicle|parking|plate|licen[sc]e/i.test(x.field)); return c ? c.value : null }

function Card({ r, mode, expanded, onToggle, onAddNote, isNew }: { r: Res; mode: string; expanded: boolean; onToggle: () => void; onAddNote: (id: string, unit: string, body: string) => Promise<boolean>; isNew: boolean }) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const eta = etaOf(r)
  const car = carOf(r)
  const dateIso = mode === 'departures' ? r.checkOut : r.checkIn
  async function save() { const b = draft.trim(); if (!b) return; setSaving(true); const ok = await onAddNote(r.id, r.unit, b); setSaving(false); if (ok) setDraft('') }
  return (
    <div className={'rounded-xl border ' + (isNew ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200') + ' bg-white shadow-sm'}>
      <button onClick={onToggle} className='w-full text-left px-4 py-3 flex items-center gap-3'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <span className='font-semibold text-gray-900 truncate'>{r.unit}</span>
            {isNew && <span className='text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500 text-white'>New</span>}
            {r.teamNotes.length > 0 && <span className='text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200'>{r.teamNotes.length} note{r.teamNotes.length > 1 ? 's' : ''}</span>}
          </div>
          <div className='text-sm text-gray-500 truncate'>{r.guest || 'Guest'} {r.guests ? '· ' + r.guests + ' guests' : ''} {r.source ? '· ' + r.source : ''}</div>
        </div>
        <div className='text-right shrink-0'>
          <div className='text-sm font-medium text-gray-900'>{fmtDate(dateIso)}</div>
          {eta && mode !== 'departures' && <div className='text-xs text-emerald-700 font-medium'>ETA {eta}</div>}
          {mode === 'active' && <div className='text-xs text-gray-400'>out {fmtDate(r.checkOut)}</div>}
        </div>
        <span className='text-gray-300 text-xs'>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className='px-4 pb-4 pt-1 border-t border-gray-100 space-y-3'>
          <div className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm'>
            <Field label='Check-in' value={fmtDate(r.checkIn)} />
            <Field label='Check-out' value={fmtDate(r.checkOut) + (r.nights ? ' · ' + r.nights + 'n' : '')} />
            <Field label='ETA' value={eta || '—'} />
            <Field label='Car / parking' value={car || '—'} />
            <Field label='Phone' value={r.phone || '—'} />
            <Field label='Email' value={r.email || '—'} />
            <Field label='Guests' value={r.guests != null ? String(r.guests) : '—'} />
            <Field label='Confirmation' value={r.confirmationCode || '—'} />
          </div>
          {r.custom.length > 0 && (
            <div>
              <div className='text-xs uppercase tracking-wide text-gray-400 mb-1'>Reservation fields</div>
              <div className='space-y-1'>{r.custom.map((c, i) => (<div key={i} className='text-sm'><span className='text-gray-500'>{c.field}: </span><span className='text-gray-900'>{c.value}</span></div>))}</div>
            </div>
          )}
          {r.guestNotes.length > 0 && (
            <div>
              <div className='text-xs uppercase tracking-wide text-gray-400 mb-1'>Reservation notes</div>
              <div className='space-y-1'>{r.guestNotes.map((n, i) => (<div key={i} className='text-sm text-gray-700 bg-gray-50 rounded px-2 py-1'>{n}</div>))}</div>
            </div>
          )}
          <div>
            <div className='text-xs uppercase tracking-wide text-gray-400 mb-1'>Team notes</div>
            <div className='space-y-1 mb-2'>
              {r.teamNotes.length === 0 && <div className='text-sm text-gray-400'>No team notes yet.</div>}
              {r.teamNotes.map((n) => (<div key={n.id} className='text-sm bg-blue-50 border border-blue-100 rounded px-2 py-1'><span className='text-gray-900'>{n.body}</span><span className='text-xs text-gray-400 block'>{n.author}{n.at ? ' · ' + new Date(n.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span></div>))}
            </div>
            <div className='flex gap-2'>
              <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} placeholder='Add a note for the team…' className='flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200' />
              <button onClick={save} disabled={saving || !draft.trim()} className='text-sm font-medium px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-40'>{saving ? 'Saving…' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (<div><div className='text-xs uppercase tracking-wide text-gray-400'>{label}</div><div className='text-gray-900 break-words'>{value}</div></div>)
}

export default function SalatoPage() {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<'arrivals' | 'departures' | 'active'>('arrivals')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const seenInit = useRef(false)

  useEffect(() => { try { const raw = localStorage.getItem(SEEN_KEY); if (raw) { setSeen(new Set(JSON.parse(raw))); seenInit.current = true } } catch {} }, [])

  const load = useCallback(async () => {
    try {
      setErr(null)
      const res = await fetch('/api/salato', { cache: 'no-store' })
      const j: Data = await res.json()
      if (!res.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
      setLastLoaded(new Date())
      const allIds = [...j.arrivals, ...j.departures, ...j.active].map(r => r.id)
      if (!seenInit.current) { const s = new Set(allIds); setSeen(s); seenInit.current = true; try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s))) } catch {} }
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [load])

  const addNote = useCallback(async (resId: string, unit: string, body: string) => {
    try {
      const res = await fetch('/api/salato', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: resId, unit, body }) })
      const j = await res.json()
      if (!res.ok || !j.ok) return false
      setData(prev => { if (!prev) return prev; const patch = (arr: Res[]) => arr.map(r => r.id === resId ? { ...r, teamNotes: [...r.teamNotes, j.note] } : r); return { ...prev, arrivals: patch(prev.arrivals), departures: patch(prev.departures), active: patch(prev.active) } })
      return true
    } catch { return false }
  }, [])

  const rows = data ? data[tab] : []
  const isNew = (id: string) => seenInit.current && !seen.has(id)
  const newCount = data ? [...data.arrivals, ...data.departures, ...data.active].filter(r => isNew(r.id)).length : 0
  function markAllSeen() { if (!data) return; const s = new Set([...data.arrivals, ...data.departures, ...data.active].map(r => r.id)); setSeen(s); try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s))) } catch {} }

  return (
    <div className='max-w-3xl mx-auto px-4 py-6'>
      <div className='flex items-center justify-between gap-3 mb-1'>
        <div>
          <div className='text-xs uppercase tracking-wide text-gray-400'>Front desk</div>
          <h1 className='text-2xl font-bold text-gray-900'>Salato</h1>
        </div>
        <div className='flex items-center gap-2'>
          {newCount > 0 && <button onClick={markAllSeen} className='text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-800 border border-amber-200'>{newCount} new · mark seen</button>}
          <button onClick={() => { setLoading(true); load() }} className='text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50'>Refresh</button>
        </div>
      </div>
      <div className='text-xs text-gray-400 mb-4'>{lastLoaded ? 'Updated ' + lastLoaded.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' · auto-refreshes every 30 min' : 'Loading…'}</div>

      <div className='flex gap-1 mb-4 bg-gray-100 rounded-xl p-1'>
        {TABS.map(t => { const n = data ? data[t.key].length : 0; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={'flex-1 text-sm font-medium px-3 py-2 rounded-lg transition ' + (tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700')}>{t.label}<span className='ml-1.5 text-xs text-gray-400'>{n}</span></button>
        )})}
      </div>

      {loading && !data && <div className='text-gray-400 text-sm py-10 text-center'>Loading…</div>}
      {err && <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3'>{err}</div>}
      {data && rows.length === 0 && !loading && <div className='text-gray-400 text-sm py-10 text-center'>Nothing here for this window.</div>}
      <div className='space-y-2'>
        {rows.map(r => (<Card key={r.id} r={r} mode={tab} expanded={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} onAddNote={addNote} isNew={isNew(r.id)} />))}
      </div>
    </div>
  )
}
