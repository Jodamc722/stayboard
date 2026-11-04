'use client'
// GARDEN MULTI-CALENDAR (Jon, 2026-11-04: "Should have a multi calendar view"). The PMS view of the
// hotel: one row per room under its room type, nights across the top, each reservation a bar from
// the middle of its arrival night to the middle of its departure day (so a same-day turn reads as two
// bars touching), room blocks as hatched grey bars. The room-type header carries that type's
// availability and rate per night from Cloudbeds. Drawn the way the Stay side's MultiCal
// (components/BlockedUnits.tsx) draws it, but built for 310 rooms × 30 nights: a row is one track
// with absolutely-placed bars — no element per room-night — and hover/click is one delegated handler.
//
// GardenCalendarViews is the page's Rooms / Rates & availability switch; Rates is GardenHub as it was.
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, X, BedDouble } from 'lucide-react'
import { LeanHead, LeanEmpty, LeanPick, Pill, Tag } from '@/components/lean'
import { GardenHub } from '@/components/GardenHub'

// ── data ────────────────────────────────────────────────────────────────────────────────────────
type Day = { available: number | null; rate: number | null; closed: boolean; min_stay: number | null }
type RType = { id: string; name: string; units: number; total: number | null; days: Record<string, Day> }
type Room = { id: string; name: string; room_type_id: string; room_type: string | null; hk_status: string | null; status: string | null; blocked: boolean | null; housekeeper: string | null; occupied: boolean | null }
type Res = { id: string; status: string; guest_name: string | null; check_in: string; check_out: string; nights: number | null; room_ids: string[]; room_names: string[]; room_type_ids: string[]; source: string | null; total: number | null; balance: number | null; adults: number | null; children: number | null }
type Block = { id: string; room_ids: string[]; room_names: string[]; kind: string | null; reason: string | null; start_date: string; end_date: string }
type Data = { ok: boolean; error?: string; message?: string; from: string; to: string; today: string; dates: string[]; types: RType[]; rooms: Room[]; reservations: Res[]; blocks: Block[]; channels: string[]; status: any[]; warnings: string[] }

const TZ = 'America/New_York'
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const diff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5)
const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
const fmtD = (d: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { ...o, timeZone: 'UTC' })
const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US')
const rateShort = (n: number | null) => n == null ? '' : n >= 10000 ? '$' + Math.round(n / 1000) + 'k' : n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + Math.round(n)
const coll = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })

// Reservation colours by Cloudbeds status. Canceled never reaches the grid.
const STATUS: Record<string, { label: string; bar: string; dot: string }> = {
  confirmed: { label: 'Confirmed', bar: 'bg-sky-500 border-sky-600 text-white', dot: 'bg-sky-500' },
  checked_in: { label: 'Checked in', bar: 'bg-emerald-500 border-emerald-600 text-white', dot: 'bg-emerald-500' },
  checked_out: { label: 'Checked out', bar: 'bg-slate-300 border-slate-400 text-slate-800', dot: 'bg-slate-300' },
  not_confirmed: { label: 'Not confirmed', bar: 'bg-amber-300 border-amber-400 text-amber-950', dot: 'bg-amber-300' },
  no_show: { label: 'No-show', bar: 'bg-rose-200 border-rose-300 text-rose-900', dot: 'bg-rose-200' },
}
const st = (s: string) => STATUS[s] || STATUS.confirmed
const HATCH = 'repeating-linear-gradient(135deg, rgba(100,116,139,.28) 0 5px, rgba(148,163,184,.12) 5px 10px)'
const HK: Record<string, string> = { clean: 'bg-emerald-500', inspected: 'bg-sky-500', dirty: 'bg-rose-500' }

const NAME_W = 184
const COL_W: Record<number, number> = { 7: 112, 14: 66, 30: 42 }
const LANE_H = 28, BAR_H = 22, HEAD_H = 38

// ── layout: lanes per row in half-day units, so a departure and an arrival share a day ─────────
type Item = { k: string; s: number; e: number; res?: Res; block?: Block }
type Laid = Item & { lane: number }
function lay(items: Item[]): { laid: Laid[]; lanes: number } {
  const sorted = items.slice().sort((a, b) => a.s - b.s || b.e - a.e)
  const ends: number[] = []
  const laid = sorted.map(it => {
    let lane = ends.findIndex(e => e <= it.s)
    if (lane < 0) { lane = ends.length; ends.push(it.e) } else ends[lane] = it.e
    return { ...it, lane }
  })
  return { laid, lanes: Math.max(1, ends.length) }
}

type Row = { key: string; kind: 'room' | 'unassigned'; room?: Room; label: string; laid: Laid[]; lanes: number }
type Group = { type: RType; rows: Row[]; booked: number }

// ── the page switch ─────────────────────────────────────────────────────────────────────────────
export function GardenCalendarViews({ canEdit, initial = 'rooms' }: { canEdit: boolean; initial?: 'rooms' | 'rates' }) {
  const [view, setView] = useState<'rooms' | 'rates'>(initial)
  const pick = (v: 'rooms' | 'rates') => {
    setView(v)
    try { const u = new URL(window.location.href); if (v === 'rooms') u.searchParams.delete('view'); else u.searchParams.set('view', v); window.history.replaceState(null, '', u.toString()) } catch { /* ignore */ }
  }
  const sw = (
    <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px] mb-3">
      {([['rooms', 'Rooms'], ['rates', 'Rates & availability']] as const).map(([k, l]) => (
        <button key={k} onClick={() => pick(k)} aria-pressed={view === k}
          className={`px-3 py-1.5 font-semibold border-l border-line first:border-l-0 whitespace-nowrap ${view === k ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>{l}</button>
      ))}
    </div>
  )
  return view === 'rooms'
    ? <GardenMultiCalendar switcher={sw} />
    : <div className="max-w-[1200px] mx-auto">{sw}<GardenHub view="calendar" canEdit={canEdit} /></div>
}

// ── the multi-calendar ──────────────────────────────────────────────────────────────────────────
export function GardenMultiCalendar({ switcher }: { switcher?: ReactNode }) {
  const [range, setRange] = useState<7 | 14 | 30>(14)
  const [from, setFrom] = useState<string>(() => todayET())
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [typeF, setTypeF] = useState('')
  const [chanF, setChanF] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [pop, setPop] = useState<{ k: string; x: number; top: number; bottom: number; pinned: boolean } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetch(`/api/garden/multical?from=${from}&days=${range}`, { cache: 'no-store' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
      .then(j => { if (live) { setD(j); setLoading(false) } })
    return () => { live = false }
  }, [from, range])

  // Click away / Escape closes a pinned card.
  useEffect(() => {
    if (!pop?.pinned) return
    const down = (e: MouseEvent) => { const t = e.target as HTMLElement; if (popRef.current?.contains(t) || t.closest('[data-k]')) return; setPop(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [pop?.pinned])

  const today = d?.today || todayET()
  const dates = useMemo(() => d?.dates?.length ? d.dates : Array.from({ length: range }, (_, i) => addDays(from, i)), [d, from, range])
  const colW = COL_W[range]

  // Index everything once per load; filters re-run only the cheap part.
  const idx = useMemo(() => {
    const resById = new Map<string, Res>(), blockById = new Map<string, Block>()
    const roomIds = new Set((d?.rooms || []).map(r => r.id))
    for (const r of d?.reservations || []) resById.set(r.id, r)
    for (const b of d?.blocks || []) blockById.set(b.id, b)
    return { resById, blockById, roomIds }
  }, [d])

  const groups = useMemo<Group[]>(() => {
    if (!d?.ok) return []
    const n = dates.length, from0 = dates[0]
    const needle = q.trim().toLowerCase()
    const resOk = (r: Res) => r.status !== 'canceled' && r.status !== 'cancelled' && (!chanF || r.source === chanF)
    const guestHit = (r: Res) => !!needle && ((r.guest_name || '').toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle))
    const resItem = (r: Res): Item => ({ k: 'r:' + r.id, s: 2 * diff(r.check_in, from0) + 1, e: 2 * diff(r.check_out, from0) + 1, res: r })
    const blkItem = (b: Block): Item => ({ k: 'b:' + b.id, s: 2 * diff(b.start_date, from0), e: 2 * (diff(b.end_date, from0) + 1), block: b })
    const inWin = (it: Item) => it.e > 0 && it.s < 2 * n

    const typeIds = new Set(d.types.map(t => t.id))
    const byRoom = new Map<string, Item[]>()
    const unByType = new Map<string, Res[]>()
    const push = (m: Map<string, any[]>, k: string, v: any) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }
    for (const r of d.reservations) {
      if (!resOk(r)) continue
      const known = r.room_ids.filter(id => idx.roomIds.has(id))
      if (known.length) for (const id of known) push(byRoom, id, resItem(r))
      else push(unByType, r.room_type_ids.find(t => typeIds.has(t)) || '—', r)
    }
    for (const b of d.blocks) for (const id of b.room_ids) if (idx.roomIds.has(id)) push(byRoom, id, blkItem(b))

    const roomsByType = new Map<string, Room[]>()
    for (const r of d.rooms) push(roomsByType, r.room_type_id, r)

    const types = d.types.slice()
    if (unByType.has('—') && !types.some(t => t.id === '—')) types.unshift({ id: '—', name: 'No room type', units: 0, total: null, days: {} })
    const out: Group[] = []
    for (const t of types) {
      if (typeF && t.id !== typeF) continue
      const typeHit = !!needle && t.name.toLowerCase().includes(needle)
      const rows: Row[] = []
      let booked = 0
      for (const room of roomsByType.get(t.id) || []) {
        const items = (byRoom.get(room.id) || []).filter(inWin)
        if (needle && !typeHit && !room.name.toLowerCase().includes(needle) && !items.some(i => i.res && guestHit(i.res))) continue
        if (items.some(i => i.res)) booked++
        rows.push({ key: room.id, kind: 'room', room, label: room.name, ...lay(items) })
      }
      const un = (unByType.get(t.id) || []).filter(r => !needle || typeHit || guestHit(r)).map(resItem).filter(inWin)
      if (un.length) rows.unshift({ key: 'un:' + t.id, kind: 'unassigned', label: 'Unassigned', ...lay(un) })
      if (!rows.length && (needle || (t.id === '—'))) continue
      if (!rows.length && !(roomsByType.get(t.id) || []).length && !Object.keys(t.days).length) continue
      out.push({ type: t, rows, booked })
    }
    return out
  }, [d, dates, q, typeF, chanF, idx])

  const stats = useMemo(() => {
    const R = (d?.reservations || []).filter(r => r.status !== 'canceled')
    const inHouse = R.filter(r => r.check_in <= today && r.check_out > today && r.status !== 'checked_out' && r.status !== 'no_show')
    return {
      inHouse: inHouse.reduce((a, r) => a + Math.max(1, r.room_ids.length), 0),
      arrivals: R.filter(r => r.check_in === today).length,
      departures: R.filter(r => r.check_out === today).length,
      unassigned: R.filter(r => !r.room_ids.some(id => idx.roomIds.has(id))).length,
      blocked: new Set((d?.blocks || []).filter(b => b.start_date <= today && b.end_date >= today).flatMap(b => b.room_ids)).size,
      total: R.length,
    }
  }, [d, today, idx])

  const toggle = useCallback((id: string) => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const allCollapsed = groups.length > 0 && groups.every(g => collapsed.has(g.type.id))

  // One delegated hover/click handler for every bar on the grid.
  const place = (el: HTMLElement, pinned: boolean) => { const b = el.getBoundingClientRect(); setPop({ k: el.dataset.k!, x: b.left + Math.min(b.width / 2, 120), top: b.top, bottom: b.bottom, pinned }) }
  const onOver = (e: RMouseEvent) => { const el = (e.target as HTMLElement).closest('[data-k]') as HTMLElement | null; if (el && !pop?.pinned && pop?.k !== el.dataset.k) place(el, false) }
  const onOut = (e: RMouseEvent) => { const el = (e.target as HTMLElement).closest('[data-k]'); const to = (e.relatedTarget as HTMLElement | null)?.closest?.('[data-k]'); if (el && el !== to) setPop(p => p?.pinned ? p : null) }
  const onClick = (e: RMouseEvent) => { const el = (e.target as HTMLElement).closest('[data-k]') as HTMLElement | null; if (el) place(el, true) }

  const sync = (d?.status || []).find((s: any) => s.entity === 'reservations')
  const head = (
    <LeanHead title="Calendar" icon={<CalendarDays size={20} className="text-emerald-700" />}>
      {d?.ok ? <>
        <Pill tone="emerald" title="Rooms with a guest in house tonight">{stats.inHouse} in house</Pill>
        <Pill tone="sky" title="Reservations arriving today">{stats.arrivals} arriving</Pill>
        <Pill title="Reservations departing today">{stats.departures} departing</Pill>
        {stats.unassigned ? <Pill tone="amber" title="Reservations in this window with no room assigned">{stats.unassigned} unassigned</Pill> : null}
        {stats.blocked ? <Pill tone="slate" title="Rooms blocked tonight">{stats.blocked} blocked</Pill> : null}
        {sync ? <Pill tone={sync.last_error ? 'rose' : 'slate'} title={sync.last_error || 'Reservations last pulled from Cloudbeds'}>{sync.last_error ? 'sync error' : 'synced ' + new Date(sync.last_sync_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Pill> : null}
      </> : null}
    </LeanHead>
  )

  const selCls = 'h-8 rounded-lg border border-line bg-white px-2 text-[12px] font-medium text-ink max-w-[200px]'
  const controls = (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <div className="inline-flex items-center rounded-lg border border-line bg-white overflow-hidden h-8">
        <button onClick={() => setFrom(f => addDays(f, -range))} title={`Back ${range} days`} aria-label={`Back ${range} days`} className="px-2 h-full text-muted hover:text-ink hover:bg-app"><ChevronLeft size={15} /></button>
        <button onClick={() => setFrom(todayET())} className="px-2.5 h-full text-[12px] font-semibold border-x border-line hover:bg-app">Today</button>
        <button onClick={() => setFrom(f => addDays(f, range))} title={`Forward ${range} days`} aria-label={`Forward ${range} days`} className="px-2 h-full text-muted hover:text-ink hover:bg-app"><ChevronRight size={15} /></button>
      </div>
      <input type="date" value={from} onChange={e => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2000-01-01') setFrom(v) }} className={selCls + ' tabular-nums'} title="Start date" />
      <LeanPick value={String(range) as '7' | '14' | '30'} onPick={v => setRange(Number(v) as 7 | 14 | 30)} options={[{ v: '7', label: '7 days' }, { v: '14', label: '14 days' }, { v: '30', label: '30 days' }]} />
      <span className="text-[12px] text-muted tabular-nums">{fmtD(dates[0], { month: 'short', day: 'numeric' })} – {fmtD(dates[dates.length - 1], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      {loading && d ? <Loader2 size={14} className="animate-spin text-muted" /> : null}
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <label className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Room or guest" className="h-8 w-44 rounded-lg border border-line bg-white pl-7 pr-6 text-[12px]" />
          {q ? <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={13} /></button> : null}
        </label>
        <select value={typeF} onChange={e => setTypeF(e.target.value)} className={selCls} title="Room type">
          <option value="">All room types{d?.types ? ` (${d.types.length})` : ''}</option>
          {(d?.types || []).map(t => <option key={t.id} value={t.id}>{t.name} · {t.units}</option>)}
        </select>
        <select value={chanF} onChange={e => setChanF(e.target.value)} className={selCls} title="Booking channel">
          <option value="">All channels</option>
          {(d?.channels || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  )

  if (!d) return <>{switcher}{head}<p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading the calendar…</p></>
  if (!d.ok) return <>{switcher}{head}<LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'Run migrations 115_garden_hotel.sql and 118_garden_unit.sql, then reload.' : (d.message || d.error || 'Could not load the calendar.')}</LeanEmpty></>

  const pr = pop ? (pop.k.startsWith('r:') ? idx.resById.get(pop.k.slice(2)) : undefined) : undefined
  const pb = pop ? (pop.k.startsWith('b:') ? idx.blockById.get(pop.k.slice(2)) : undefined) : undefined

  return (
    <>
      {switcher}
      {head}
      {controls}
      {d.warnings?.length ? <p className="text-[12px] text-amber-700 mb-2">{d.warnings.join(' ')}</p> : null}
      {!d.rooms.length ? <LeanEmpty>No rooms mirrored yet. Once Cloudbeds is connected, every room lands here under its room type on the next sync.</LeanEmpty> : (
        <div className={`rounded-2xl border border-line bg-white overflow-hidden transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-3 px-3 py-2 border-b border-line text-[11px] text-muted flex-wrap">
            {(['confirmed', 'checked_in', 'checked_out', 'not_confirmed'] as const).map(s => <span key={s} className="inline-flex items-center gap-1"><i className={`inline-block w-3 h-3 rounded-sm ${STATUS[s].dot}`} /> {STATUS[s].label}</span>)}
            <span className="inline-flex items-center gap-1"><i className="inline-block w-3 h-3 rounded-sm border border-slate-300" style={{ backgroundImage: HATCH }} /> Blocked</span>
            <span className="hidden sm:inline">Room-type rows: rooms left · rate per night.</span>
            <span className="ml-auto inline-flex items-center gap-2">
              {stats.total ? <span>{stats.total} reservation{stats.total === 1 ? '' : 's'} in view</span> : <span>No reservations in this window yet</span>}
              <button onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map(g => g.type.id)))} className="rounded-md border border-line px-1.5 py-0.5 font-semibold text-ink/80 hover:bg-app">{allCollapsed ? 'Expand all' : 'Collapse all'}</button>
            </span>
          </div>
          {groups.length ? (
            <div className="overflow-auto max-h-[calc(100vh-250px)] min-h-[360px] overscroll-contain" onMouseOver={onOver} onMouseOut={onOut} onClick={onClick} onScroll={() => { if (pop) setPop(null) }}>
              <Grid dates={dates} today={today} colW={colW} groups={groups} collapsed={collapsed} onToggle={toggle} pinned={pop?.pinned ? pop.k : null} />
            </div>
          ) : <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing matches{q ? ` “${q}”` : ''}{chanF ? ` on ${chanF}` : ''}.</div>}
        </div>
      )}
      {pop && (pr || pb) ? <Card ref={popRef} pop={pop} res={pr} block={pb} onClose={() => setPop(null)} /> : null}
    </>
  )
}

// ── the grid (memoised: hovering a bar re-renders the card, not 300 rows) ─────────────────────────
const Grid = memo(function Grid({ dates, today, colW, groups, collapsed, onToggle, pinned }: {
  dates: string[]; today: string; colW: number; groups: Group[]; collapsed: Set<string>; onToggle: (id: string) => void; pinned: string | null
}) {
  const W = dates.length * colW
  const lines = `repeating-linear-gradient(90deg, transparent 0 ${colW - 1}px, rgba(15,23,42,.07) ${colW - 1}px ${colW}px)`
  // Weekend and today column tints: a dozen stripes over the whole body, not a cell per room.
  const stripes = dates.map((x, i) => ({ x, i, we: dow(x) === 0 || dow(x) === 6, t: x === today })).filter(s => s.we || s.t)
  return (
    <div className="relative text-[11px]" style={{ width: NAME_W + W, minWidth: '100%' }}>
      {/* date header */}
      <div className="sticky top-0 z-30 flex bg-white border-b border-line" style={{ height: 40 }}>
        <div className="sticky left-0 z-10 bg-white border-r border-line px-3 flex items-end pb-1.5 font-semibold text-muted shrink-0" style={{ width: NAME_W }}>Room</div>
        {dates.map((x, i) => {
          const we = dow(x) === 0 || dow(x) === 6, t = x === today, first = i === 0 || x.endsWith('-01')
          return (
            <div key={x} title={fmtD(x, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              className={`shrink-0 flex flex-col items-center justify-center border-l border-line/60 leading-tight ${t ? 'bg-brand-600 text-white' : we ? 'bg-slate-50 text-ink/80' : 'text-muted'}`} style={{ width: colW }}>
              <span className={`text-[9.5px] uppercase ${first && !t ? 'text-brand-700 font-bold' : ''}`}>{first ? fmtD(x, { month: 'short' }) : fmtD(x, { weekday: colW >= 60 ? 'short' : 'narrow' })}</span>
              <span className="text-[12px] font-semibold tabular-nums">{Number(x.slice(8))}</span>
            </div>
          )
        })}
      </div>
      {/* body */}
      <div className="relative">
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: NAME_W, width: W }} aria-hidden>
          {stripes.map(s => <div key={s.x} className={`absolute inset-y-0 ${s.t ? 'bg-brand-500/[.07] border-x border-brand-500/30' : 'bg-slate-500/[.045]'}`} style={{ left: s.i * colW, width: colW }} />)}
        </div>
        {groups.map(g => <GroupRows key={g.type.id} g={g} dates={dates} colW={colW} lines={lines} open={!collapsed.has(g.type.id)} onToggle={onToggle} pinned={pinned} />)}
      </div>
    </div>
  )
})

const GroupRows = memo(function GroupRows({ g, dates, colW, lines, open, onToggle, pinned }: {
  g: Group; dates: string[]; colW: number; lines: string; open: boolean; onToggle: (id: string) => void; pinned: string | null
}) {
  const t = g.type
  const units = t.units || t.total || 0
  // A type that is one room (the hotel names many types after their room) is drawn as that room's
  // row alone — a header repeating the same name above every room doubled the page.
  if (g.rows.length === 1 && units <= 1 && g.rows[0].room) return <TrackRow r={g.rows[0]} colW={colW} n={dates.length} lines={lines} pinned={pinned} />
  return (
    <>
      <div className="relative flex border-b border-line bg-slate-50/70" style={{ height: HEAD_H }}>
        <button onClick={() => onToggle(t.id)} className="sticky left-0 z-10 shrink-0 bg-slate-50 hover:bg-slate-100 border-r border-line px-2 flex items-center gap-1.5 text-left" style={{ width: NAME_W }} title={t.name}>
          <ChevronDown size={14} className={`shrink-0 text-muted transition ${open ? '' : '-rotate-90'}`} />
          <span className="min-w-0">
            <span className="block font-bold text-[12px] text-ink truncate">{t.name}</span>
            <span className="block text-[10.5px] text-muted">{units} room{units === 1 ? '' : 's'}{g.booked ? ` · ${g.booked} booked` : ''}</span>
          </span>
        </button>
        {dates.map(x => {
          const c = t.days[x]
          const sold = c && !c.closed && c.available === 0
          return (
            <div key={x} className={`shrink-0 flex flex-col items-center justify-center leading-tight tabular-nums border-l border-line/50 ${c?.closed ? 'bg-slate-200/60 text-muted' : sold ? 'bg-rose-50 text-rose-700' : ''}`} style={{ width: colW }}
              title={c ? `${fmtD(x)} · ${c.closed ? 'closed · ' : ''}${c.available ?? '—'} of ${t.total ?? units} left · ${money(c.rate)}${c.min_stay && c.min_stay > 1 ? ' · min ' + c.min_stay + ' nights' : ''}` : `${fmtD(x)} · no rate loaded`}>
              {c ? <>
                <span className={`text-[11.5px] font-bold ${c.closed ? 'line-through' : sold ? '' : 'text-ink'}`}>{c.closed ? '×' : c.available ?? '—'}</span>
                <span className="text-[9.5px] text-muted">{rateShort(c.rate)}</span>
              </> : <span className="text-muted/40">·</span>}
            </div>
          )
        })}
      </div>
      {open ? g.rows.map(r => <TrackRow key={r.key} r={r} colW={colW} n={dates.length} lines={lines} pinned={pinned} />) : null}
    </>
  )
})

const TrackRow = memo(function TrackRow({ r, colW, n, lines, pinned }: { r: Row; colW: number; n: number; lines: string; pinned: string | null }) {
  const h = r.lanes * LANE_H + 4
  const W = n * colW, half = colW / 2
  const room = r.room
  const down = room && (room.blocked || /out_of_order|blocked/i.test(room.status || ''))
  return (
    <div className="relative flex border-b border-line/70 hover:bg-slate-50/50 group/row" style={{ height: h }}>
      <div className={`sticky left-0 z-10 shrink-0 border-r border-line px-3 flex items-center gap-1.5 ${r.kind === 'unassigned' ? 'bg-amber-50' : 'bg-white group-hover/row:bg-slate-50'}`} style={{ width: NAME_W }}>
        {r.kind === 'unassigned' ? <>
          <span className="pl-4 text-[11.5px] font-semibold text-amber-800">Unassigned</span>
          <Tag tone="amber">{r.laid.length}</Tag>
        </> : <>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-4 ${HK[(room?.hk_status || '').toLowerCase()] || 'bg-slate-200'}`} title={room?.hk_status ? 'Housekeeping: ' + room.hk_status + (room.housekeeper ? ' · ' + room.housekeeper : '') : 'No housekeeping status'} />
          <span className="font-semibold text-[12px] text-ink truncate">{r.label}</span>
          {down ? <Tag tone="slate" title={room?.status || 'blocked'}>{/out_of_order/i.test(room?.status || '') ? 'OOO' : 'blocked'}</Tag> : null}
        </>}
      </div>
      <div className="relative shrink-0" style={{ width: W, backgroundImage: lines }}>
        {r.laid.map(it => {
          const s = Math.max(0, it.s), e = Math.min(2 * n, it.e)
          const left = s * half + (it.s >= 0 ? 1 : 0), width = Math.max(6, (e - s) * half - (it.s >= 0 ? 1 : 0) - (it.e <= 2 * n ? 1 : 0))
          const top = 2 + it.lane * LANE_H + (LANE_H - BAR_H) / 2
          const cutL = it.s < 0, cutR = it.e > 2 * n
          const round = `${cutL ? 'rounded-l-none border-l-0' : 'rounded-l-md'} ${cutR ? 'rounded-r-none border-r-0' : 'rounded-r-md'}`
          const ring = pinned === it.k ? ' ring-2 ring-ink/70 ring-offset-1' : ''
          if (it.block) {
            const b = it.block
            return (
              <div key={it.k} data-k={it.k} className={`absolute border border-slate-300 text-slate-700 px-1.5 flex items-center overflow-hidden cursor-pointer ${round}${ring}`} style={{ left, width, top, height: BAR_H, backgroundImage: HATCH, backgroundColor: 'rgb(241 245 249)' }}>
                {width >= 40 ? <span className="truncate text-[10.5px] font-semibold">{b.reason || (b.kind || 'blocked').replace(/_/g, ' ')}</span> : null}
              </div>
            )
          }
          const v = it.res!
          return (
            <div key={it.k} data-k={it.k} className={`absolute border shadow-sm px-1.5 flex items-center gap-1 overflow-hidden cursor-pointer hover:brightness-95 ${st(v.status).bar} ${round}${ring}`} style={{ left, width, top, height: BAR_H }}>
              {width >= 26 ? <span className="truncate text-[11px] font-semibold leading-none">{v.guest_name || 'Guest'}{width >= 120 && v.source ? <span className="font-normal opacity-80"> · {v.source}</span> : null}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ── the hover / click card ──────────────────────────────────────────────────────────────────────
const Card = forwardRef<HTMLDivElement, { pop: { x: number; top: number; bottom: number; pinned: boolean }; res?: Res; block?: Block; onClose: () => void }>(function Card({ pop, res, block, onClose }, ref) {
  const W = 280
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200, vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(8, Math.min(vw - W - 8, pop.x - 40))
  const below = pop.bottom + 220 < vh
  const style: CSSProperties = below ? { left, top: pop.bottom + 6, width: W } : { left, bottom: vh - pop.top + 6, width: W }
  const line = (k: string, v: ReactNode) => <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="font-semibold text-ink text-right truncate">{v}</span></div>
  return (
    <div ref={ref} style={style} className={`fixed z-[60] rounded-xl border border-line bg-white shadow-xl p-3 text-[12px] space-y-1.5 ${pop.pinned ? '' : 'pointer-events-none'}`}>
      {res ? <>
        <div className="flex items-start gap-2">
          <BedDouble size={15} className="text-muted mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[13px] text-ink truncate">{res.guest_name || 'Guest'}</div>
            <div className="text-[11px] text-muted truncate">#{res.id}{res.room_names.length ? ' · ' + res.room_names.join(', ') : ' · no room assigned'}</div>
          </div>
          <span className={`shrink-0 text-[10.5px] font-semibold px-1.5 py-[3px] rounded-md border ${st(res.status).bar}`}>{st(res.status).label}</span>
          {pop.pinned ? <button onClick={onClose} aria-label="Close" className="shrink-0 text-muted hover:text-ink"><X size={14} /></button> : null}
        </div>
        <div className="border-t border-line/70 pt-1.5 space-y-1">
          {line('Dates', `${fmtD(res.check_in, { month: 'short', day: 'numeric' })} → ${fmtD(res.check_out, { month: 'short', day: 'numeric' })}`)}
          {line('Nights', res.nights ?? diff(res.check_out, res.check_in))}
          {res.adults != null || res.children != null ? line('Guests', `${res.adults || 0} adult${res.adults === 1 ? '' : 's'}${res.children ? ` · ${res.children} child${res.children === 1 ? '' : 'ren'}` : ''}`) : null}
          {line('Channel', res.source || '—')}
          {line('Total', money(res.total))}
          {line('Balance', <span className={res.balance && res.balance > 0 ? 'text-rose-700' : ''}>{money(res.balance)}</span>)}
        </div>
      </> : block ? <>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[13px] text-ink">{block.reason || 'Room block'}</div>
            <div className="text-[11px] text-muted capitalize">{(block.kind || 'blocked').replace(/_/g, ' ')}</div>
          </div>
          {pop.pinned ? <button onClick={onClose} aria-label="Close" className="shrink-0 text-muted hover:text-ink"><X size={14} /></button> : null}
        </div>
        <div className="border-t border-line/70 pt-1.5 space-y-1">
          {line('Dates', `${fmtD(block.start_date, { month: 'short', day: 'numeric' })} – ${fmtD(block.end_date, { month: 'short', day: 'numeric' })}`)}
          {line('Rooms', block.room_names.length ? block.room_names.join(', ') : block.room_ids.length)}
        </div>
      </> : null}
    </div>
  )
})
