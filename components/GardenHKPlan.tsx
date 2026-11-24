'use client'
// THE GARDEN HOUSEKEEPING BOARD — built to read like the VR Schedule board (Jon, 2026-11-20: "the
// scheduler should be clear … like ours"). The same four things in the same places:
//   1. the pager and the week strip — each day's rooms and its staffing pill (working / needed)
//   2. one line of chips — unassigned, then the kinds of clean — and a Sort
//   3. the Team rail on the left: working vs needed, one verdict sentence, each person's hours
//   4. ONE table: checkbox · HK Team · Room · Est. time · Reservation · Status
// Tick rows and the bar at the bottom assigns them; today's assignments go to Cloudbeds.
// The rows come from lib/garden/hk-plan (bookings + the room's state in Cloudbeds).
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownUp, CalendarRange, Check, CheckCheck, ChevronLeft, ChevronRight, LogIn, LogOut, Moon, Printer, RefreshCw, Repeat, UploadCloud, Users, Wand2 } from 'lucide-react'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const send = (url: string, body: any, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const fmtMins = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return h > 0 ? h + 'h' + (mm ? ' ' + mm + 'm' : '') : mm + 'm' }
const add = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const dayLong = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const ago = (iso: string | null) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago` }
const SHIFT = 420

type Row = any
type Kind = 'turn' | 'checkout' | 'stayover' | 'arrival' | 'dirty'
const KIND: Record<Kind, { label: string; chip: string; cls: string; edge: string; band: string; hint: string }> = {
  turn: { label: 'same-day turn', chip: 'Same-day turns', cls: 'text-rose-700 bg-rose-50', edge: 'border-l-rose-500', band: 'bg-rose-50 text-rose-900', hint: 'Do these first: a guest leaves and another arrives today' },
  arrival: { label: 'arrival', chip: 'Arrivals', cls: 'text-emerald-800 bg-emerald-50', edge: 'border-l-emerald-600', band: 'bg-emerald-50 text-emerald-900', hint: 'A guest arrives today and the room is not ready yet' },
  checkout: { label: 'checkout', chip: 'Checkouts', cls: 'text-amber-800 bg-amber-50', edge: 'border-l-amber-500', band: 'bg-amber-50 text-amber-900', hint: 'The guest leaves today; nobody arrives until tomorrow or later' },
  stayover: { label: 'stayover', chip: 'Stayovers', cls: 'text-sky-800 bg-sky-50', edge: 'border-l-sky-500', band: 'bg-sky-50 text-sky-900', hint: 'The guest is staying: service the room' },
  dirty: { label: 'vacant dirty', chip: 'Vacant dirty', cls: 'text-neutral-600 bg-neutral-100', edge: 'border-l-neutral-400', band: 'bg-neutral-100 text-neutral-800', hint: 'Empty and dirty, no booking today: when there is time' },
}
const KINDS: Kind[] = ['turn', 'checkout', 'stayover', 'arrival', 'dirty']
const ORDER: Record<Kind, number> = { turn: 0, arrival: 1, checkout: 2, stayover: 3, dirty: 4 }
const STATE: Record<string, { label: string; cls: string }> = {
  waiting: { label: 'Guest still in', cls: 'bg-[#f2f0fb] text-[#463a8a]' }, todo: { label: 'To clean', cls: 'bg-rose-50 text-rose-700' }, cleaning: { label: 'Cleaning', cls: 'bg-sky-50 text-sky-800' },
  inspect: { label: 'Clean · inspect', cls: 'bg-amber-50 text-amber-800' }, ready: { label: 'Ready', cls: 'bg-green-100 text-green-700' }, done: { label: 'Done', cls: 'bg-green-100 text-green-700' },
  skip: { label: 'Skip', cls: 'bg-neutral-100 text-neutral-600' }, planned: { label: 'Planned', cls: 'bg-neutral-100 text-neutral-600' },
}
const closed = (r: Row) => r.state === 'ready' || r.state === 'done' || r.state === 'skip'
const needsPerson = (r: Row) => !closed(r) && r.state !== 'inspect' && !r.assignedTo
type Sort = 'priority' | 'wing' | 'cleaner' | 'room'

export function GardenHKPlan({ canEdit, canSchedule = false }: { canEdit: boolean; canSchedule?: boolean }) {
  const [date, setDate] = useState<string | null>(null)
  const [d, setD] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [sortBy, setSortBy] = useState<Sort>('priority')
  const [who, setWho] = useState('')
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [to, setTo] = useState('')
  const [insp, setInsp] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ t: string; warn?: boolean } | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [showDone, setShowDone] = useState<Record<string, boolean>>({})
  const [onlyInspect, setOnlyInspect] = useState<'' | 'todo' | 'done'>('')

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setD(await j(`/api/garden/hk-plan${date ? `?date=${date}` : ''}`)); setLoading(false)
  }, [date])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => load(true), 60_000); return () => clearInterval(t) }, [load])
  useEffect(() => { setSel({}); setWho(''); setOnlyUnassigned(false) }, [date])

  const all: Row[] = useMemo(() => d?.rows || [], [d])
  const people: any[] = useMemo(() => d?.people || [], [d])
  const rows = useMemo(() => {
    const a = all.filter(r => (kind === 'all' || r.type === kind) && (!onlyInspect || (onlyInspect === 'todo' ? r.state === 'inspect' : r.condition === 'inspected' || !!r.inspectedAt)) && (!onlyUnassigned || needsPerson(r)) && (!who || r.assignedTo === who))
    const byRoom = (x: Row, y: Row) => x.room.localeCompare(y.room, undefined, { numeric: true })
    if (sortBy === 'wing') a.sort((x, y) => x.area.localeCompare(y.area, undefined, { numeric: true }) || byRoom(x, y))
    else if (sortBy === 'room') a.sort(byRoom)
    else if (sortBy === 'cleaner') a.sort((x, y) => (x.assignedTo ? 0 : 1) - (y.assignedTo ? 0 : 1) || String(x.assignedTo || '').localeCompare(String(y.assignedTo || '')) || byRoom(x, y))
    else a.sort((x, y) => Number(closed(x)) - Number(closed(y)) || ORDER[x.type as Kind] - ORDER[y.type as Kind] || byRoom(x, y))
    return a
  }, [all, kind, onlyUnassigned, onlyInspect, who, sortBy])
  // SECTIONS (Jon, 2026-11-20: "easier to delineate and understand"): the table is cut into bands —
  // by kind of clean in work order, or by wing / housekeeper when sorted that way — and everything
  // finished is folded into one band at the bottom.
  const groups = useMemo(() => {
    const out: { key: string; title: string; hint: string; band: string; edge: string; rows: Row[]; done?: boolean }[] = []
    const push = (key: string, title: string, hint: string, band: string, edge: string, r: Row, done = false) => { let g = out.find(x => x.key === key); if (!g) { g = { key, title, hint, band, edge, rows: [], done }; out.push(g) } g.rows.push(r) }
    for (const r of rows) {
      const K = KIND[r.type as Kind]
      if (sortBy === 'priority') {
        if (r.state === 'inspect') push('inspect', 'To inspect', 'Cleaned and waiting for an inspection. Rooms with a guest arriving today come first', 'bg-[#f2f0fb] text-[#3f3480]', 'border-l-[#7b6bd0]', r)
        else if (r.state === 'ready') push('ready', 'Inspected · ready', 'Inspected and ready for the guest', 'bg-green-50 text-green-900', 'border-l-green-600', r, true)
        else if (closed(r)) push('done', 'Finished', 'Stayovers serviced or skipped, and rooms the next guest is already in', 'bg-neutral-100 text-neutral-800', 'border-l-neutral-400', r, true)
        else push(r.type, K.chip, K.hint, K.band, K.edge, r)
      }
      else if (sortBy === 'wing') push(r.area, 'Rooms ' + r.area, '', 'bg-brand-50 text-brand-900', 'border-l-brand-600', r)
      else if (sortBy === 'cleaner') push(r.assignedTo || '—', r.assignedTo || 'Nobody yet', '', r.assignedTo ? 'bg-brand-50 text-brand-900' : 'bg-rose-50 text-rose-900', r.assignedTo ? 'border-l-brand-600' : 'border-l-rose-500', r)
      else push('all', 'All rooms', '', 'bg-brand-50 text-brand-900', 'border-l-brand-600', r)
    }
    const insp = out.find(g => g.key === 'inspect'); if (insp) insp.rows.sort((a, b) => Number(!!b.in) - Number(!!a.in) || a.room.localeCompare(b.room, undefined, { numeric: true }))
    const rank = (g: { key: string; done?: boolean }) => g.key === 'turn' ? 0 : g.key === 'inspect' ? 1 : g.key === 'ready' ? 8 : g.key === 'done' ? 9 : 2
    return sortBy === 'priority' ? out.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map(x => x.g) : out
  }, [rows, sortBy])
  const selIds = Object.keys(sel).filter(k => sel[k])
  const pickable = rows.filter(r => !closed(r))
  const allSelected = pickable.length > 0 && pickable.every(r => sel[r.roomId])

  const cbNote = (c: string) => c === 'sent' ? ' Sent to Cloudbeds.' : c === 'skipped' || !c ? '' : c === 'not known to Cloudbeds' ? ' Saved here, but Cloudbeds has no housekeeper by that name — add them in Cloudbeds (Housekeeping → Housekeepers).' : ' ' + c[0].toUpperCase() + c.slice(1) + '.'
  const assign = async (ids: string[], name: string | null) => {
    if (!ids.length || !d) return
    setBusy('assign'); setMsg(null)
    const r = await send('/api/garden/assign', { op: 'assign', date: d.date, roomIds: ids, to: name })
    setBusy('')
    if (!r?.ok) setMsg({ t: r?.error || 'Could not assign.', warn: true })
    else { const c = String(r.cloudbeds || ''); setMsg({ t: `${ids.length} room${ids.length === 1 ? '' : 's'} ${name ? 'assigned to ' + name : 'unassigned'}.${cbNote(c)}`, warn: /refused|not known|kept/.test(c) }); setSel({}); setTo('') }
    load(true)
  }
  const assignInspector = async (ids: string[], name: string | null) => {
    if (!ids.length || !d) return
    setBusy('insp'); setMsg(null)
    const r = await send('/api/garden/assign', { op: 'inspector', date: d.date, roomIds: ids, to: name })
    setBusy('')
    setMsg(r?.ok ? { t: `${ids.length} room${ids.length === 1 ? '' : 's'}: ${name ? name + ' inspects' : 'no inspector'}.` } : { t: r?.error || 'Could not set the inspector.', warn: true })
    if (r?.ok) { setSel({}); setInsp('') }
    load(true)
  }
  const syncNow = async () => {
    setBusy('sync'); setMsg(null)
    const r = await send('/api/garden', { action: 'sync', quick: true })
    setBusy('')
    setMsg(r?.connected === false ? { t: 'Cloudbeds is not connected.', warn: true } : r?.errors?.length ? { t: r.errors.join(' · '), warn: true } : { t: `Synced from Cloudbeds${r?.coreMs ? ' in ' + Math.max(1, Math.round(r.coreMs / 1000)) + 's' : ''}.` })
    load(true)
  }
  const autoAssign = async () => {
    if (!d) return
    const names = people.filter(p => p.onShift).map(p => p.name)
    if (!names.length) { setMsg({ t: 'Mark who is working in the Team list first, then Auto-assign splits the rooms across them.', warn: true }); setRailOpen(true); return }
    setBusy('auto'); setMsg(null)
    const r = await send('/api/garden/assign', { op: 'auto', date: d.date, people: names })
    setBusy('')
    if (!r?.ok) setMsg({ t: r?.error || 'Could not auto-assign.', warn: true })
    else setMsg({ t: `${r.assigned} room${r.assigned === 1 ? '' : 's'} split across ${names.length}.${cbNote(String(r.cloudbeds || ''))}${r.warnings?.length ? ' ' + r.warnings.join(' · ') : ''}`, warn: !!r.warnings?.length })
    load(true)
  }
  const setWorking = async (p: any, on: boolean) => {
    if (!d || !canSchedule || String(p.id).startsWith('cb:')) return
    setBusy('w' + p.id)
    const r = on ? await send('/api/garden/schedule', { op: 'shift', date: d.date, staffId: p.id, role: 'housekeeping', start: '09:00', end: '17:00' }) : await send('/api/garden/schedule', { op: 'delete_shift', id: p.shiftId })
    setBusy(''); if (r?.error) setMsg({ t: r.error, warn: true })
    load(true)
  }
  const setCond = async (r: Row, condition: 'clean' | 'inspected' | 'dirty') => {
    setBusy(r.roomId + condition); setMsg(null)
    const x = await send('/api/garden/rooms', { roomId: r.roomId, condition }, 'PATCH')
    setBusy(''); setMsg(x?.ok ? { t: `Room ${r.room} marked ${condition} in Cloudbeds.` } : { t: x?.error || 'Could not set the room.', warn: true })
    load(true)
  }

  if (!d) return <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">Loading the schedule&hellip;</div>
  if (!d.ok) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {d.error}</div>
  const s = d.summary, live = d.live, past = d.date < d.today
  const working = s.working, need = s.need
  const short = !past && need > 0 && working < need
  const unassignedCount = all.filter(needsPerson).length
  const unassignedMin = all.filter(needsPerson).reduce((a: number, r: Row) => a + r.minutes, 0)
  const names: string[] = people.map(p => p.name)
  const inspectors: any[] = d.inspectors || []
  const selInspect = selIds.filter(id => all.find(r => r.roomId === id)?.state === 'inspect')
  const verdict = need === 0 ? { t: 'No housekeeping work on this day.', cls: 'text-muted' }
    : working === 0 ? { t: `Nobody is marked working. The day needs ${need} housekeeper${need === 1 ? '' : 's'}.`, cls: 'text-rose-700 font-semibold' }
    : short ? { t: `Short ${need - working}: add ${need - working} housekeeper${need - working === 1 ? '' : 's'}.`, cls: 'text-rose-700 font-semibold' }
    : working > need + 1 ? { t: `${working - need} more than the day needs.`, cls: 'text-amber-700 font-semibold' }
    : { t: 'Staffed for the day.', cls: 'text-green-700 font-semibold' }
  const crew = people.filter(p => p.onShift), holding = people.filter(p => !p.onShift && p.rooms > 0), off = people.filter(p => !p.onShift && !p.rooms)

  return (
    <div id="hkplan" className="space-y-2.5">
      <style dangerouslySetInnerHTML={{ __html: '@media print { body * { visibility: hidden } #hkplan, #hkplan * { visibility: visible } #hkplan { position: absolute; left: 0; top: 0; width: 100%; padding: 12px } #hkplan .np { display: none !important } }' }} />

      {/* 1. Pager */}
      <div className="np flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1">
          <button onClick={() => setDate(add(d.date, -1))} aria-label="Previous day" className="p-1.5 rounded-lg border border-line text-muted hover:text-ink"><ChevronLeft size={15} /></button>
          <button onClick={() => setDate(null)} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app">Today</button>
          <button onClick={() => setDate(add(d.date, 1))} aria-label="Next day" className="p-1.5 rounded-lg border border-line text-muted hover:text-ink"><ChevronRight size={15} /></button>
          <input type="date" value={d.date} onChange={e => e.target.value && setDate(e.target.value)} className="text-[12px] font-semibold border border-line rounded-lg px-2.5 py-1.5 bg-white text-ink outline-none cursor-pointer" title="Jump to any date" />
        </div>
        <span className="text-sm font-semibold text-ink ml-1 inline-flex items-center gap-1.5">{loading ? <RefreshCw size={15} className="text-brand-600 animate-spin" /> : <CalendarRange size={15} className="text-brand-600" />} {dayLong(d.date)}{!live && !past ? <span className="text-[11px] font-medium text-muted">forecast</span> : null}</span>
        <div className="ml-auto inline-flex items-center gap-1.5">
          <span className="text-[11px] text-muted" title="When Cloudbeds was last read. It is read about every 30 minutes.">Data as of {ago(d.syncAt)}</span>
          <button onClick={syncNow} disabled={!!busy} title="Reads bookings and room conditions from Cloudbeds right now (a few seconds)" className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app disabled:opacity-50"><RefreshCw size={12} className={busy === 'sync' ? 'animate-spin' : ''} /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app"><Printer size={12} /> Print</button>
        </div>
      </div>

      {/* The week strip — same card as the VR board: rooms, working / needed, hours. */}
      <div className="np flex gap-1.5 overflow-x-auto snap-x pb-0.5 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0 lg:grid-cols-7">
        {d.week.map((w: any) => { const isSel = w.date === d.date, isToday = w.date === d.today, sh = w.need > 0 && w.scheduled < w.need; return (
          <button key={w.date} onClick={() => setDate(isToday ? null : w.date)} title={`${w.turns} same-day turns · ${w.checkouts} checkouts · ${w.stayovers} stayovers · ${w.arrivals} arrivals\n${fmtMins(w.minutes)} of work → ${w.need} housekeeper${w.need === 1 ? '' : 's'} at 7h\n${w.scheduled} scheduled`}
            className={'shrink-0 w-[104px] snap-start sm:w-auto rounded-xl px-2.5 py-1.5 text-left bg-white transition ' + (isSel ? 'border-2 border-neutral-900' : 'border border-line hover:border-neutral-400')}>
            <div className="flex items-baseline justify-between gap-1">
              <span className={'text-[10px] uppercase tracking-wide ' + (isToday ? 'font-bold text-neutral-900' : 'font-semibold text-muted')}>{dow(w.date)} {Number(w.date.slice(8, 10))}</span>
              {isToday && <span className="text-[9px] font-bold text-emerald-700">TODAY</span>}
            </div>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-lg font-bold leading-tight">{w.rooms}<span className="ml-1 text-[10px] font-medium text-muted">rooms</span></span>
              <span className={'px-1.5 py-0.5 rounded-full text-[10px] font-semibold ' + (sh ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700')}>{w.scheduled}/{w.need}</span>
              {w.minutes > 0 && <span className="text-[10px] text-muted">{Math.round(w.minutes / 6) / 10}h</span>}
            </div>
            {w.turns > 0 && <div className="text-[10px] font-semibold text-rose-600 inline-flex items-center gap-0.5"><Repeat size={9} /> {w.turns} same-day turn{w.turns === 1 ? '' : 's'}</div>}
          </button>
        ) })}
      </div>

      {/* 2. Chips + sort */}
      <div className="np flex items-center gap-2 flex-wrap">
        {unassignedCount > 0 && (
          <button onClick={() => setOnlyUnassigned(o => !o)} aria-pressed={onlyUnassigned} title="Rooms with nobody on them yet. Click to show only these."
            className={'inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1.5 rounded-lg border ' + (onlyUnassigned ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-700 border-rose-300')}>
            <span className={'inline-block w-1.5 h-1.5 rounded-full ' + (onlyUnassigned ? 'bg-white' : 'bg-rose-500')} />{unassignedCount} unassigned{onlyUnassigned ? ' · showing' : ''}
          </button>
        )}
        <button onClick={() => setKind('all')} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${kind === 'all' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>All · {all.length}</button>
        {KINDS.filter(k => s[k].total > 0).map(k => (
          <button key={k} onClick={() => setKind(k)} className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${kind === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{KIND[k].chip} · {live ? `${s[k].done}/${s[k].total}` : s[k].total}</button>
        ))}
        {live && (s.toInspect > 0 || s.inspected > 0) && <span className="w-px h-5 bg-line mx-0.5" />}
        {live && s.toInspect > 0 && <button onClick={() => setOnlyInspect(v => v === 'todo' ? '' : 'todo')} title="Rooms cleaned and waiting for an inspection" className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${onlyInspect === 'todo' ? 'bg-[#5546a8] text-white border-[#5546a8]' : 'bg-[#f2f0fb] text-[#463a8a] border-[#cfc8ee]'}`}>To inspect · {s.toInspect}</button>}
        {live && s.inspected > 0 && <button onClick={() => setOnlyInspect(v => v === 'done' ? '' : 'done')} title="Rooms inspected today" className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${onlyInspect === 'done' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>Inspected · {s.inspected}</button>}
        {live && <span className="text-[12px] text-ink font-semibold ml-1">{fmtMins(s.minutes)} left · {s.arrivalsReady}/{s.arrivals} arrival rooms ready</span>}
        <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
          <ArrowDownUp size={13} /> Sort
          <select value={sortBy} onChange={e => setSortBy(e.target.value as Sort)} className="text-[12px] font-semibold text-ink bg-white border border-line rounded-lg px-2 py-1 outline-none">
            <option value="priority">What to do first</option><option value="wing">Wing</option><option value="cleaner">Housekeeper</option><option value="room">Room</option>
          </select>
        </label>
      </div>

      {live && (d.mismatches.length > 0 || d.notArrived.length > 0 || d.syncError) && (
        <details className="np rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] text-amber-800">
          <summary className="cursor-pointer font-semibold select-none"><AlertTriangle size={12} className="inline -mt-0.5 mr-1" />{d.syncError ? 'The last Cloudbeds read had a problem' : `${d.mismatches.length + d.notArrived.length} room${d.mismatches.length + d.notArrived.length === 1 ? '' : 's'} to check with the front desk`}</summary>
          <p className="mt-1">
            {d.syncError ? `${d.syncError}. ` : ''}
            {d.mismatches.length ? `Cloudbeds labels ${d.mismatches.slice(0, 10).map((m: any) => `${m.room} as ${m.cloudbeds} (here: ${m.ours})`).join(', ')}${d.mismatches.length > 10 ? ` and ${d.mismatches.length - 10} more` : ''}. ` : ''}
            {d.notArrived.length ? `Booked from an earlier day but never checked in, so no stayover: ${d.notArrived.map((m: any) => m.room).join(', ')}.` : ''}
          </p>
        </details>
      )}
      {msg && <div className={'np rounded-xl border px-3.5 py-2.5 text-[13px] flex items-center gap-2 ' + (msg.warn ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{msg.warn ? <AlertTriangle size={14} className="shrink-0" /> : <Check size={14} className="shrink-0" />} {msg.t}</div>}


      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-3 items-start pb-16">
        {/* 3. THE TEAM RAIL */}
        <div className="np rounded-xl border border-line bg-white shadow-sm">
          <button onClick={() => setRailOpen(o => !o)} className="w-full text-left px-3 py-2.5 lg:cursor-default">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted">Team · {dow(d.date)} {dayShort(d.date)}</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[20px] font-bold text-ink leading-none">{working}</span><span className="text-[12px] text-muted">working</span>
              <span className={'text-[20px] font-bold leading-none ' + (short ? 'text-rose-700' : 'text-ink')}>{need}</span><span className="text-[12px] text-muted">needed</span>
            </div>
            <div className={'text-[12px] mt-1 ' + verdict.cls}>{verdict.t}</div>
            <div className="text-[11px] text-muted mt-0.5" title="45 min a checkout or same-day turn, 20 a stayover, over a 7-hour shift">{fmtMins(s.plannedMinutes)} of rooms ÷ 7h a shift</div>
          </button>
          <div className="px-3 pb-2 -mt-1 text-[11px]">
            {d.homebase?.connected
              ? <span className={d.homebase.error ? 'text-amber-700' : 'text-muted'} title={d.homebase.error || 'Whoever Homebase has scheduled is marked working here. You can still tick or untick anyone by hand.'}>{d.homebase.error ? 'Homebase schedule could not be read' : `Schedule from Homebase · ${ago(d.homebase.at)}`}</span>
              : <a href="/garden/users?tab=settings&panel=homebase" className="font-semibold text-brand-700 hover:underline" title="Connect the hotel's Homebase so whoever is scheduled there is marked working here automatically">Connect Homebase to fill this in →</a>}
          </div>
          <div className={(railOpen ? '' : 'hidden lg:block ') + 'border-t border-line'}>
            {[...crew, ...holding].map(p => { const over = p.minutes > SHIFT; return (
              <div key={p.id} className={'px-3 py-1.5 border-b border-line/70 ' + (who === p.name ? 'bg-brand-50/50' : '')}>
                <div className="flex items-center gap-2">
                  {canSchedule && !String(p.id).startsWith('cb:') ? <input type="checkbox" checked={p.onShift} disabled={!!busy || p.shiftFrom === 'homebase'} onChange={e => setWorking(p, e.target.checked)} className="accent-brand-600" title={p.shiftFrom === 'homebase' ? `Scheduled in Homebase ${p.hours || ''} — change it there` : p.onShift ? 'Working this day — untick to take off' : 'Tick to mark working this day'} /> : null}
                  <button onClick={() => setWho(w => w === p.name ? '' : p.name)} className="text-[12.5px] font-semibold text-ink truncate hover:underline decoration-dotted underline-offset-2 text-left" title="Show only this person's rooms">{p.name}</button>
                  {!p.onShift && <span className="text-[10px] font-semibold text-amber-700 shrink-0" title="Has rooms but is not marked working this day">not scheduled</span>}
                  {p.onShift && p.hours && <span className="text-[10px] text-muted shrink-0 tabular-nums" title={p.shiftFrom === 'homebase' ? 'From Homebase' : 'Set here'}>{p.hours.replace(/:00/g, '')}</span>}
                  <span className={'ml-auto text-[11px] tabular-nums shrink-0 ' + (over ? 'text-rose-700 font-semibold' : 'text-muted')}>{p.rooms ? `${p.rooms} · ${fmtMins(p.minutes)}` : '—'}</span>
                </div>
                <div className="h-1 rounded bg-app overflow-hidden mt-1"><div className={'h-full ' + (over ? 'bg-rose-500' : 'bg-brand-600')} style={{ width: Math.min(100, Math.round((p.minutes / SHIFT) * 100)) + '%' }} /></div>
              </div>
            ) })}
            {unassignedCount > 0 && (
              <div className="px-3 py-2 border-b border-line/70 bg-rose-50/40">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-rose-700">Nobody yet<span className="ml-auto text-[11px] tabular-nums">{unassignedCount} · {fmtMins(unassignedMin)}</span></div>
                {canEdit && <button onClick={autoAssign} disabled={!!busy} className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-50" title="Splits the unassigned rooms across the people ticked as working, by time, wing by wing">{busy === 'auto' ? <RefreshCw size={12} className="animate-spin" /> : <Wand2 size={12} />} Auto-assign to the {crew.length || ''} working</button>}
              </div>
            )}
            {live && (s.toInspect > 0 || s.inspected > 0) && (
              <div className="px-3 py-2 border-b border-line/70">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1">Inspections</div>
                <div className="flex items-baseline gap-2 text-[12px]"><button onClick={() => setOnlyInspect(v => v === 'todo' ? '' : 'todo')} className={'font-semibold hover:underline ' + (s.toInspect ? 'text-[#463a8a]' : 'text-muted')}>{s.toInspect} to inspect</button><span className="text-muted">·</span><button onClick={() => setOnlyInspect(v => v === 'done' ? '' : 'done')} className="font-semibold text-green-700 hover:underline">{s.inspected} inspected</button></div>
                {s.inspectorless > 0 && <div className="text-[11px] text-[#463a8a] mt-0.5">{s.inspectorless} with no inspector yet</div>}
                {inspectors.filter((x: any) => x.todo || x.done).map((x: any) => <div key={x.name} className="flex items-center gap-2 text-[12px] mt-1"><span className="truncate text-ink">{x.name}</span><span className="ml-auto tabular-nums text-muted">{x.done} done · {x.todo} to do</span></div>)}
              </div>
            )}
            {off.length > 0 && (
              <div className="px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted mb-1">{canSchedule ? 'Not working — tick to add' : 'Not working'}</div>
                <div className="space-y-1">
                  {off.map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
                      {canSchedule && !String(p.id).startsWith('cb:') ? <input type="checkbox" checked={false} disabled={!!busy} onChange={() => setWorking(p, true)} className="accent-brand-600" /> : null}<span className="truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {!people.length && <div className="px-3 py-3 text-[12px] text-muted">No housekeepers on the roster yet. Add them under Staff week.</div>}
          </div>
        </div>

        {/* 4. THE TABLE */}
        <div className="space-y-2 min-w-0">
          {who && <div className="np text-[12px] text-ink">Showing <b>{who}</b>&apos;s rooms. <button onClick={() => setWho('')} className="font-semibold text-brand-700 hover:underline">Show everyone</button></div>}
          {rows.length === 0 ? <div className="rounded-xl border border-line bg-white px-3 py-8 text-center text-[12px] text-muted">{onlyUnassigned ? 'Every room this day has a person on it.' : all.length ? 'No rooms in this view.' : 'No checkouts, stayovers or arrivals for this day.'}</div> : (
            <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
              <table className="block sm:table sm:table-fixed w-full text-[12px] border-collapse [&_td]:break-words">
                <thead className="hidden sm:table-header-group">
                  <tr className="bg-neutral-50 text-neutral-500 text-[10px] uppercase tracking-wider text-left font-semibold border-b border-line">
                    <th className="np px-2.5 py-2 w-8">{canEdit && <input type="checkbox" checked={allSelected} onChange={e => setSel(e.target.checked ? Object.fromEntries(pickable.map(r => [r.roomId, true])) : {})} aria-label={'Select all ' + pickable.length + ' rooms'} className="accent-brand-600 align-middle" />}</th>
                    <th className="px-2.5 py-2 font-semibold sm:w-[10.5rem]">HK Team</th>
                    <th className="px-2 py-2 font-semibold">Room</th>
                    <th className="px-2 py-2 font-semibold text-right whitespace-nowrap sm:w-[4.5rem]" title="45 min a checkout or same-day turn, 20 a stayover, 8 an inspection">Time</th>
                    <th className="px-2 py-2 font-semibold">Reservation</th>
                    <th className="px-2 py-2 font-semibold sm:w-[11.5rem]">Status</th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {groups.map(g => { const folded = !!g.done && !showDone[g.key] && !(onlyInspect === 'done' && g.key === 'ready'); const mins = g.rows.reduce((a, r) => a + r.minutes, 0), noOne = g.rows.filter(needsPerson).length; return (<Fragment key={g.key}>
                    <tr className={'block sm:table-row border-t-[6px] border-app ' + g.band}>
                      <td colSpan={6} className={'block sm:table-cell px-3 py-2 border-l-4 ' + g.edge}>
                        <div style={{ width: 0, minWidth: '100%' }} className="flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                          <span className="gh-display text-[13px] font-bold tracking-wide uppercase">{g.title}</span>
                          <span className="text-[12px] font-semibold tabular-nums">{g.rows.length} room{g.rows.length === 1 ? '' : 's'}{mins ? ' · ' + fmtMins(mins) : ''}</span>
                          {noOne > 0 && <span className="text-[11px] font-bold text-rose-700 bg-white/70 rounded-full px-2 py-0.5">{noOne} need a housekeeper</span>}
                          {g.key === 'inspect' && g.rows.some(r => !r.inspector) && <span className="text-[11px] font-bold text-[#463a8a] bg-white/70 rounded-full px-2 py-0.5">{g.rows.filter(r => !r.inspector).length} with no inspector</span>}
                          {g.hint && <span className="text-[11.5px] opacity-80">{g.hint}</span>}
                          {g.done ? <button onClick={() => setShowDone(v => ({ ...v, [g.key]: !v[g.key] }))} className="np ml-auto text-[11.5px] font-semibold underline underline-offset-2">{showDone[g.key] ? 'Hide' : 'Show'}</button>
                            : canEdit ? <button onClick={() => setSel(p => { const n = { ...p }; const ids = g.rows.filter(r => !closed(r)).map(r => r.roomId); const allOn = ids.every(i => n[i]); ids.forEach(i => { if (allOn) delete n[i]; else n[i] = true }); return n })} className="np ml-auto text-[11.5px] font-semibold underline underline-offset-2">Select these</button> : null}
                        </div>
                      </td>
                    </tr>
                  {!folded && g.rows.map((r, i) => {
                    const K = KIND[r.type as Kind], st = STATE[r.state]
                    const brk = false
                    const tags = [...(r.out?.tags || []), ...(r.in?.tags || []), ...(r.stay?.tags || [])].filter((t: any, n: number, a: any[]) => a.findIndex(x => x.key === t.key) === n)
                    return (
                      <tr key={r.roomId} className={`flex flex-wrap items-center sm:table-row hover:brightness-95 transition border-t ${brk ? 'border-line/80 border-t-2' : 'border-line'} ${closed(r) ? 'opacity-60' : sel[r.roomId] ? 'bg-brand-50/40' : needsPerson(r) ? 'bg-rose-50/40' : ''}`}>
                        <td className={'np order-1 shrink-0 sm:table-cell px-2.5 py-1.5 align-middle border-l-4 ' + K.edge}>{canEdit && !closed(r) && <input type="checkbox" checked={!!sel[r.roomId]} onChange={e => setSel(p => ({ ...p, [r.roomId]: e.target.checked }))} className="accent-brand-600" aria-label={'Select room ' + r.room} />}</td>
                        <td className="order-4 grow basis-44 min-w-0 sm:table-cell px-2.5 py-1.5 align-middle">
                          {canEdit ? (
                            <select value={r.assignedTo || ''} disabled={!!busy} onChange={e => assign([r.roomId], e.target.value || null)} title={r.assignedFrom === 'cloudbeds' ? 'Assigned in Cloudbeds' : r.assignedFrom === 'lighthouse' ? 'Assigned here' : 'Nobody yet'}
                              className={'np w-full max-w-[11rem] text-[12px] rounded-lg border px-2 py-1 outline-none ' + (r.assignedTo ? 'border-line bg-white text-ink font-semibold' : 'border-line bg-white text-muted')}>
                              <option value="">{closed(r) ? '—' : 'Pick housekeeper…'}</option>
                              {r.assignedTo && !names.includes(r.assignedTo) ? <option value={r.assignedTo}>{r.assignedTo}</option> : null}
                              {crew.length > 0 && <optgroup label="Working">{crew.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
                              <optgroup label={crew.length ? 'Not working' : 'Housekeepers'}>{people.filter(p => !p.onShift).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
                            </select>
                          ) : null}
                          <span className={canEdit ? 'hidden print:inline font-semibold' : 'font-semibold'}>{r.assignedTo || (closed(r) ? '' : '________')}</span>
                          {r.state === 'inspect' && canEdit ? (
                            <select value={r.inspector || ''} disabled={!!busy} onChange={e => assignInspector([r.roomId], e.target.value || null)} title="Who inspects this room"
                              className={'np mt-1 w-full max-w-[11rem] text-[11.5px] rounded-lg border px-2 py-0.5 outline-none ' + (r.inspector ? 'border-[#cfc8ee] bg-[#f2f0fb] text-[#3f3480] font-semibold' : 'border-[#cfc8ee] bg-white text-[#5546a8]')}>
                              <option value="">Inspector…</option>
                              {r.inspector && !inspectors.some((x: any) => x.name === r.inspector) ? <option value={r.inspector}>{r.inspector}</option> : null}
                              {inspectors.map((x: any) => <option key={x.name} value={x.name}>{x.name}{x.role === 'manager' ? ' · mgmt' : ''}</option>)}
                            </select>
                          ) : r.inspector && !r.inspectedAt && r.state !== 'ready' ? <div className="text-[10.5px] text-[#463a8a] mt-0.5">inspects: {r.inspector}</div> : null}
                        </td>
                        <td className="order-2 grow basis-0 min-w-0 sm:table-cell px-2.5 py-1.5 align-middle font-medium text-ink">
                          <span className="text-[14px] font-bold tabular-nums">{r.room}</span>
                          {r.type === 'turn' ? <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600"><Repeat size={9} /> same-day turn</span> : <span className={'ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ' + K.cls}>{K.label}</span>}
                          {tags.map((t: any) => <span key={t.key} className="ml-1 inline-block whitespace-nowrap text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{t.label}</span>)}
                          {r.dnd && r.state !== 'skip' ? <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#f2f0fb] text-[#5546a8]">DND</span> : null}
                          <div className="text-[10.5px] font-normal text-muted truncate max-w-[15rem]">{r.roomType || r.area}{r.comments ? ` · ${r.comments}` : ''}</div>
                        </td>
                        <td className="order-3 shrink-0 sm:table-cell px-2 py-1.5 align-middle text-right tabular-nums text-muted whitespace-nowrap">{r.minutes ? fmtMins(r.minutes) : '—'}</td>
                        <td className="order-5 basis-full sm:table-cell px-2.5 py-1.5 align-middle text-ink">
                          {r.out && <div className="flex items-center gap-1 whitespace-nowrap"><LogOut size={11} className="text-muted shrink-0" /><span className="truncate max-w-[12rem]">{r.out.name}</span>{live && <span className={'text-[10.5px] font-semibold ' + (r.out.status === 'checked_out' ? 'text-green-700' : 'text-[#5546a8]')}>{r.out.status === 'checked_out' ? 'left' : 'still in'}</span>}</div>}
                          {r.in && <div className="flex items-center gap-1 whitespace-nowrap"><LogIn size={11} className="text-muted shrink-0" /><span className="truncate max-w-[12rem]">{r.in.name}</span><span className="text-[10.5px] text-muted">{r.in.people} guest{r.in.people === '1' ? '' : 's'} · {r.in.nights ?? '?'} nt{live && r.in.status === 'checked_in' ? ' · arrived' : ''}</span></div>}
                          {r.stay && <div className="flex items-center gap-1 whitespace-nowrap"><Moon size={11} className="text-muted shrink-0" /><span className="truncate max-w-[12rem]">{r.stay.name}</span><span className="text-[10.5px] text-muted">night {r.stay.night} of {r.stay.nights ?? '?'} · leaves {dayShort(r.stay.checkOut)}</span></div>}
                          {r.type === 'dirty' && <span className="text-muted">Empty, no booking today</span>}
                          {r.flag && <div className="text-[10.5px] font-semibold text-amber-700">{r.flag}</div>}
                          {(r.inspectedAt || (r.state === 'ready' && r.inspector)) && <div className="text-[10.5px] text-green-700">inspected{r.inspectedAt ? ' ' + new Date(r.inspectedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''}{r.inspectedBy || r.inspector ? ' · ' + (r.inspectedBy || r.inspector) : ''}</div>}
                        </td>
                        <td className="order-6 basis-full sm:table-cell px-2.5 py-1.5 align-middle sm:w-[12.5rem]">
                          <span className={'inline-block whitespace-nowrap text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ' + st.cls}>{r.state === 'skip' ? (r.skipWhy || 'Skip') : st.label}</span>
                          {canEdit && live ? (
                            <span className="np mt-1 flex flex-wrap gap-1">
                              {(r.state === 'todo' || r.state === 'cleaning') && <button disabled={!!busy} onClick={() => setCond(r, 'clean')} title="Mark the room Clean in Cloudbeds" className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border border-line bg-white text-ink hover:bg-app disabled:opacity-40"><Check size={10} /> Clean</button>}
                              {(r.state === 'inspect' || ((r.state === 'todo' || r.state === 'cleaning') && r.type !== 'stayover')) && <button disabled={!!busy} onClick={() => setCond(r, 'inspected')} title="Mark the room Inspected in Cloudbeds — ready for the guest" className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border border-line bg-white text-ink hover:bg-app disabled:opacity-40"><CheckCheck size={10} /> Inspected</button>}
                              {(r.state === 'ready' || r.state === 'inspect' || (r.state === 'done' && r.type === 'stayover')) && <button disabled={!!busy} onClick={() => setCond(r, 'dirty')} title="Back to Dirty in Cloudbeds" className="text-[10.5px] text-muted hover:text-ink">undo</button>}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                  </Fragment>) })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* The bulk bar — the same pill as the VR board. */}
      {canEdit && selIds.length > 0 && (
        <div className="np sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4.25rem)] sm:bottom-3 z-20 flex justify-center">
          <div className="flex flex-col gap-1.5 w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-brand-200 bg-white shadow-lg px-3 py-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:rounded-full sm:px-4">
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5"><Users size={14} className="text-brand-600" /> {selIds.length} selected</span>
              <button onClick={() => setSel({})} className="ml-auto sm:ml-0 text-[12px] text-muted hover:text-ink">Clear</button>
            </div>
            <div className="flex items-center gap-2">
              <select value={to} onChange={e => setTo(e.target.value)} className="flex-1 min-w-0 sm:flex-none sm:w-44 text-[12px] rounded-lg border border-line bg-white px-2 py-1.5 outline-none">
                <option value="">Pick housekeeper…</option>
                {crew.length > 0 && <optgroup label="Working">{crew.map(p => <option key={p.name} value={p.name}>{p.name} · {fmtMins(p.minutes)}</option>)}</optgroup>}
                <optgroup label={crew.length ? 'Not working' : 'Housekeepers'}>{people.filter(p => !p.onShift).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
              </select>
              {selInspect.length > 0 && (
                <select value={insp} onChange={e => { setInsp(e.target.value); if (e.target.value) assignInspector(selInspect, e.target.value) }} className="sm:w-36 text-[12px] rounded-lg border border-[#cfc8ee] bg-[#f2f0fb] text-[#3f3480] px-2 py-1.5 outline-none" title={`Give the ${selInspect.length} cleaned room${selInspect.length === 1 ? '' : 's'} picked to an inspector`}>
                  <option value="">Inspector for {selInspect.length}…</option>
                  {inspectors.map((x: any) => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>
              )}
              <button onClick={() => assign(selIds, to)} disabled={!to || !!busy} className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-brand-600 text-white px-3.5 py-1.5 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy === 'assign' ? <RefreshCw size={14} className="animate-spin" /> : <UploadCloud size={14} />} {live ? `Push ${selIds.length} to Cloudbeds` : `Assign ${selIds.length}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
