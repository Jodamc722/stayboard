'use client'
// THE HOUSEKEEPING DAY (lib/garden/hk-plan) — Jon, 2026-11-20: "a world class stayover, check-in and
// checkouts for schedule … accurate … same day turns … assign and push to Cloudbeds".
//
// Pick a day (today and the six after it). Every room with work is one line, in the order it should
// be done: same-day turns, arrival rooms not ready, checkouts, stayovers, vacant dirty. Each line
// says who is leaving (and whether they have left), who is coming or staying, where the room stands
// in Cloudbeds, and who has it. Tick rooms and hand them to someone, or Auto-assign splits what is
// left by minutes, wing by wing. Today's assignments and room conditions are written to Cloudbeds.
// The strip under the days says whether the plan matches Cloudbeds' own room labels.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, BedDouble, Check, CheckCheck, DoorOpen, Loader2, LogIn, LogOut, Moon, Printer, RefreshCw, Search, ShieldCheck, Sparkles, TriangleAlert, Wand2, X } from 'lucide-react'
import { Tag, LeanEmpty, type Tone } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const send = (url: string, body: any, method = 'POST') => j(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const hrs = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`
const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const dnum = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDate()
const dayLong = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const ago = (iso: string | null) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }

type Row = any
type TypeKey = 'turn' | 'checkout' | 'stayover' | 'arrival' | 'dirty'
const TYPE: Record<TypeKey, { label: string; plural: string; tone: Tone; bar: string; icon: any; what: string }> = {
  turn: { label: 'Same-day turn', plural: 'Same-day turns', tone: 'rose', bar: 'bg-rose-500', icon: ArrowRightLeft, what: 'A guest leaves and another arrives today. First.' },
  arrival: { label: 'Arrival', plural: 'Arrival rooms', tone: 'emerald', bar: 'bg-emerald-500', icon: LogIn, what: 'A guest arrives into a room nobody left today.' },
  checkout: { label: 'Checkout', plural: 'Checkouts', tone: 'amber', bar: 'bg-amber-500', icon: LogOut, what: 'A guest leaves; nobody arrives today.' },
  stayover: { label: 'Stayover', plural: 'Stayovers', tone: 'sky', bar: 'bg-sky-500', icon: Moon, what: 'A guest is staying through.' },
  dirty: { label: 'Vacant dirty', plural: 'Vacant dirty', tone: 'slate', bar: 'bg-neutral-400', icon: BedDouble, what: 'Empty and dirty, no booking today.' },
}
const ORDER: TypeKey[] = ['turn', 'arrival', 'checkout', 'stayover', 'dirty']
const STATE: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: 'Guest still in', tone: 'violet' }, todo: { label: 'To clean', tone: 'rose' }, cleaning: { label: 'Cleaning', tone: 'brand' },
  inspect: { label: 'Clean · inspect', tone: 'amber' }, ready: { label: 'Ready', tone: 'emerald' }, done: { label: 'Done', tone: 'emerald' }, skip: { label: 'Skip', tone: 'slate' }, planned: { label: 'Planned', tone: 'slate' },
}
const finished = (r: Row) => r.state === 'ready' || r.state === 'done'
const closed = (r: Row) => finished(r) || r.state === 'skip'
type Group = 'type' | 'person' | 'area'

export function GardenHKPlan({ canEdit }: { canEdit: boolean }) {
  const [date, setDate] = useState<string | null>(null)
  const [d, setD] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<TypeKey | 'all' | 'inspect' | 'unassigned'>('all')
  const [group, setGroup] = useState<Group>('type')
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [hideDone, setHideDone] = useState(false)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null)
  const [auto, setAuto] = useState<Set<string> | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const r = await j(`/api/garden/hk-plan${date ? `?date=${date}` : ''}`)
    setD(r); setLoading(false)
  }, [date])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => load(true), 60_000); return () => clearInterval(t) }, [load])
  useEffect(() => { setPick(new Set()) }, [date])

  const rows: Row[] = useMemo(() => d?.rows || [], [d])
  const people: any[] = useMemo(() => d?.people || [], [d])
  const names = useMemo(() => people.map(p => p.name), [people])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => (filter === 'all' || (filter === 'inspect' ? r.state === 'inspect' : filter === 'unassigned' ? !closed(r) && r.state !== 'inspect' && !r.assignedTo : r.type === filter))
      && (!who || (who === '—' ? !r.assignedTo : r.assignedTo === who)) && (!hideDone || !closed(r))
      && (!s || [r.room, r.roomType, r.assignedTo, r.out?.name, r.in?.name, r.stay?.name, r.area].join(' ').toLowerCase().includes(s)))
  }, [rows, filter, who, q, hideDone])
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of shown) { const k = group === 'type' ? r.type : group === 'person' ? (r.assignedTo || 'Unassigned') : r.area; m.set(k, [...(m.get(k) || []), r]) }
    const keys = Array.from(m.keys())
    if (group === 'type') keys.sort((a, b) => ORDER.indexOf(a as TypeKey) - ORDER.indexOf(b as TypeKey))
    else keys.sort((a, b) => (a === 'Unassigned' ? -1 : b === 'Unassigned' ? 1 : a.localeCompare(b, undefined, { numeric: true })))
    return keys.map(k => ({ key: k, rows: m.get(k)! }))
  }, [shown, group])

  const toggle = (id: string) => setPick(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const cbNote = (c: string) => c === 'sent' ? 'Sent to Cloudbeds.' : c === 'skipped' ? '' : c === 'not known to Cloudbeds' ? 'Saved here — Cloudbeds has no housekeeper by that name, so add them in Cloudbeds → Housekeeping → Housekeepers.' : c[0].toUpperCase() + c.slice(1) + '.'
  const assign = async (ids: string[], name: string | null) => {
    if (!ids.length || !d) return
    setBusy('assign'); setMsg(null)
    const r = await send('/api/garden/assign', { op: 'assign', date: d.date, roomIds: ids, to: name })
    setBusy('')
    if (!r?.ok) setMsg({ t: r?.error || 'Could not assign.', bad: true })
    else { const c = String(r.cloudbeds || ''); setMsg({ t: `${ids.length} room${ids.length === 1 ? '' : 's'} ${name ? '→ ' + name : 'unassigned'}. ${cbNote(c)}`, bad: /refused|not known|kept/.test(c) }); setPick(new Set()) }
    load(true)
  }
  const runAuto = async () => {
    if (!auto || !d) return
    setBusy('auto'); setMsg(null)
    const r = await send('/api/garden/assign', { op: 'auto', date: d.date, people: Array.from(auto) })
    setBusy(''); setAuto(null)
    if (!r?.ok) setMsg({ t: r?.error || 'Could not auto-assign.', bad: true })
    else setMsg({ t: `${r.assigned} room${r.assigned === 1 ? '' : 's'} split: ${Object.entries(r.perPerson || {}).map(([n, v]: any) => `${n.split(' ')[0]} ${v.rooms.length} (${hrs(v.minutes)})`).join(' · ')}. ${cbNote(String(r.cloudbeds || ''))}${r.warnings?.length ? ' ' + r.warnings.join(' · ') : ''}`, bad: !!r.warnings?.length })
    load(true)
  }
  const setCond = async (r: Row, condition: 'clean' | 'inspected' | 'dirty') => {
    setBusy(r.roomId + condition); setMsg(null)
    const x = await send('/api/garden/rooms', { roomId: r.roomId, condition }, 'PATCH')
    setBusy('')
    if (!x?.ok) setMsg({ t: x?.error || 'Could not set the room.', bad: true }); else setMsg({ t: `${r.room} marked ${condition} in Cloudbeds.` })
    load(true)
  }

  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Building the housekeeping day…</p>
  if (!d.ok) return <LeanEmpty>{/does not exist|schema cache/i.test(d.error || '') ? 'The Garden Hotel tables are not in the database yet.' : d.error}</LeanEmpty>
  const s = d.summary, live = d.live
  const openAuto = () => { const on = people.filter(p => p.onShift).map(p => p.name); const withRooms = people.filter(p => p.rooms).map(p => p.name); setAuto(new Set(on.length ? on : withRooms)) }
  const tile = (k: TypeKey, x: any) => {
    const T = TYPE[k], I = T.icon, pct = x.total ? Math.round(((x.done + x.skip) / x.total) * 100) : 0
    return (
      <button key={k} onClick={() => setFilter(f => f === k ? 'all' : k)} title={T.what} className={`text-left rounded-xl border bg-white px-3 py-2 min-w-0 ${filter === k ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-neutral-400'}`}>
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted"><I size={12} />{T.plural}</div>
        <div className="text-[22px] font-semibold tabular-nums text-ink leading-tight mt-0.5">{live ? <>{x.done}<span className="text-[13px] text-muted font-normal"> / {x.total}</span></> : x.total}</div>
        {live ? <div className="h-1 rounded bg-app overflow-hidden mt-1"><div className={`h-full ${T.bar}`} style={{ width: pct + '%' }} /></div> : null}
        <div className="text-[11px] text-muted mt-1 truncate">{!live ? 'forecast from bookings' : x.total === 0 ? 'none today' : [x.open - x.waiting > 0 ? `${x.open - x.waiting} to do` : '', x.waiting ? `${x.waiting} guest still in` : '', x.skip ? `${x.skip} skip` : ''].filter(Boolean).join(' · ') || 'all done'}</div>
      </button>
    )
  }

  return (
    <div id="hkplan" className="pb-10">
      <style dangerouslySetInnerHTML={{ __html: '@media print { body * { visibility: hidden } #hkplan, #hkplan * { visibility: visible } #hkplan { position: absolute; left: 0; top: 0; width: 100%; padding: 12px } #hkplan .np { display: none !important } }' }} />
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Sparkles size={18} className="text-ink" /><h1 className="text-[20px] font-semibold text-ink">Housekeeping</h1>
        <span className="text-[13px] text-muted">{dayLong(d.date)}{live ? '' : ' · forecast'}</span>
        <span className="flex-1" />
        <span className="np text-[12px] text-muted" title="Last Cloudbeds sync">Cloudbeds {ago(d.syncAt)}</span>
        <button onClick={() => load()} className="np h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line bg-white" title="Reload">{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
        <button onClick={() => window.print()} className="np h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white text-[12.5px] font-semibold" title="Print this list (what is on screen)"><Printer size={13} /> Print</button>
      </div>

      {/* The week: what each day holds, in rooms. */}
      <div className="np grid grid-cols-4 sm:grid-cols-7 gap-1.5 mb-3">
        {d.week.map((w: any) => (
          <button key={w.date} onClick={() => setDate(w.date)} className={`rounded-xl border px-2 py-1.5 text-left ${w.date === d.date ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-neutral-400'}`}>
            <div className="flex items-baseline gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{w.date === d.today ? 'Today' : dow(w.date)}</span><span className="text-[16px] font-semibold tabular-nums">{dnum(w.date)}</span><span className="flex-1" />{w.need ? <span className="text-[10.5px] opacity-70" title="Housekeepers the day needs">{w.need} HK</span> : null}</div>
            <div className="text-[11px] tabular-nums opacity-80 mt-0.5 truncate" title={`${w.turns} same-day turns · ${w.checkouts} checkouts · ${w.stayovers} stayovers · ${w.arrivals} arrivals`}>
              {w.turns ? <b className={w.date === d.date ? '' : 'text-rose-700'}>{w.turns} turn · </b> : null}{w.checkouts + w.turns} out · {w.stayovers} stay · {w.arrivals} in
            </div>
          </button>
        ))}
      </div>

      {/* The check against Cloudbeds. */}
      {live ? (d.mismatches.length || d.notArrived.length || d.syncError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 mb-3 text-[12.5px] text-amber-900">
          <div className="font-semibold inline-flex items-center gap-1.5"><TriangleAlert size={13} /> Check these rooms</div>
          {d.syncError ? <div className="mt-0.5">Last Cloudbeds sync had a problem: {d.syncError}</div> : null}
          {d.mismatches.length ? <div className="mt-0.5">Cloudbeds labels {d.mismatches.length === 1 ? 'this room' : 'these rooms'} differently: {d.mismatches.slice(0, 12).map((m: any) => `${m.room} (here ${m.ours}, Cloudbeds ${m.cloudbeds})`).join(' · ')}{d.mismatches.length > 12 ? ` · +${d.mismatches.length - 12} more` : ''}</div> : null}
          {d.notArrived.length ? <div className="mt-0.5">Booked from an earlier day but not checked in and the room is empty, so no stayover clean: {d.notArrived.map((m: any) => `${m.room} ${m.guest}`).join(' · ')}</div> : null}
        </div>
      ) : (
        <div className="np rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 mb-3 text-[12.5px] text-emerald-900 inline-flex items-center gap-1.5"><ShieldCheck size={13} /> Matches Cloudbeds: every room here carries the same label Cloudbeds gives it ({rows.length} rooms with work of {s.rooms}).</div>
      )) : <p className="np text-[12px] text-muted mb-3">A day ahead is a forecast from the bookings as they stand; rooms and guests can still change. Assignments made here are sent to Cloudbeds on the morning of the day.</p>}

      {/* The day in numbers; each tile filters. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 mb-2">
        {ORDER.filter(k => k !== 'dirty' || live).map(k => tile(k, s[k]))}
        <div className="rounded-xl border border-line bg-white px-3 py-2 min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Work left</div>
          <div className="text-[22px] font-semibold tabular-nums text-ink leading-tight mt-0.5">{hrs(s.minutes)}</div>
          <div className="text-[11px] text-muted mt-1 truncate" title="At 45 min a checkout or turn, 20 a stayover, 7 working hours a shift">needs {s.need} housekeeper{s.need === 1 ? '' : 's'}</div>
          <div className="text-[11px] mt-0.5 truncate">{live ? <span className={s.arrivalsReady === s.arrivals ? 'text-emerald-700' : 'text-amber-700'}>{s.arrivalsReady}/{s.arrivals} arrival rooms ready</span> : <span className="text-muted">{s.arrivals} arrivals</span>}</div>
        </div>
      </div>
      <div className="np flex items-center gap-1.5 flex-wrap mb-3 text-[12px]">
        {s.unassigned ? <button onClick={() => setFilter(f => f === 'unassigned' ? 'all' : 'unassigned')} className={`rounded-full border px-2.5 py-1 font-semibold ${filter === 'unassigned' ? 'border-ink bg-ink text-white' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{s.unassigned} unassigned</button> : rows.length ? <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-2.5 py-1 font-semibold">Everything is assigned</span> : null}
        {live && s.toInspect ? <button onClick={() => setFilter(f => f === 'inspect' ? 'all' : 'inspect')} className={`rounded-full border px-2.5 py-1 font-semibold ${filter === 'inspect' ? 'border-ink bg-ink text-white' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{s.toInspect} clean, waiting for inspection</button> : null}
        {filter !== 'all' ? <button onClick={() => setFilter('all')} className="rounded-full border border-line bg-white px-2.5 py-1 font-semibold inline-flex items-center gap-1"><X size={11} /> Show everything</button> : null}
        <span className="flex-1" />
        <span className="text-muted">Group by</span>
        {(['type', 'person', 'area'] as Group[]).map(g => <button key={g} onClick={() => setGroup(g)} className={`rounded-full border px-2.5 py-1 font-semibold ${group === g ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{g === 'type' ? 'Kind of clean' : g === 'person' ? 'Housekeeper' : 'Wing'}</button>)}
        <select value={who} onChange={e => setWho(e.target.value)} className="h-7 rounded-lg border border-line bg-white px-2 text-[12px]"><option value="">Everyone</option><option value="—">Unassigned</option>{people.filter(p => p.rooms).map(p => <option key={p.name} value={p.name}>{p.name} · {p.rooms}</option>)}</select>
        <label className="inline-flex items-center gap-1 text-muted"><input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> hide finished</label>
        <label className="relative"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Room, guest, person" className="h-7 w-40 rounded-lg border border-line bg-white pl-6 pr-2 text-[12px]" /></label>
      </div>

      {/* Who has what. */}
      {people.some(p => p.rooms || p.onShift) ? (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {people.filter(p => p.rooms || p.onShift).map(p => (
            <button key={p.name} onClick={() => setWho(w => w === p.name ? '' : p.name)} className={`np text-left rounded-xl border bg-white px-2.5 py-1.5 ${who === p.name ? 'border-ink ring-1 ring-ink' : 'border-line'}`}>
              <div className="text-[12.5px] font-semibold text-ink">{p.name}{p.onShift ? <span className="ml-1 text-[10.5px] font-semibold text-emerald-700">on shift</span> : null}</div>
              <div className="text-[11px] text-muted tabular-nums">{p.rooms ? <>{live ? `${p.done}/${p.rooms} rooms` : `${p.rooms} rooms`} · {hrs(p.minutes)} left{p.minutes > 420 ? <span className="text-rose-700 font-semibold"> · over a shift</span> : null}</> : 'no rooms yet'}</div>
            </button>
          ))}
        </div>
      ) : null}

      {/* Assign. */}
      {canEdit ? (
        <div className="np sticky top-0 z-10 rounded-xl border border-line bg-white px-3 py-2 mb-3 flex items-center gap-2 flex-wrap shadow-sm">
          <span className="text-[12.5px] font-semibold text-ink">{pick.size ? `${pick.size} room${pick.size === 1 ? '' : 's'} picked` : 'Tick rooms to hand them out'}</span>
          <select value={to} onChange={e => setTo(e.target.value)} className="h-8 rounded-lg border border-line bg-white px-2 text-[12.5px] min-w-[11rem]"><option value="">Give to…</option>{people.map(p => <option key={p.name} value={p.name}>{p.name}{p.rooms ? ` · ${p.rooms} rooms, ${hrs(p.minutes)}` : ''}</option>)}</select>
          <button disabled={!pick.size || !to || !!busy} onClick={() => assign(Array.from(pick), to)} className="h-8 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">{busy === 'assign' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Assign{live ? ' & send to Cloudbeds' : ''}</button>
          {pick.size ? <button disabled={!!busy} onClick={() => assign(Array.from(pick), null)} className="h-8 px-2.5 rounded-lg border border-line text-[12.5px] font-semibold">Unassign</button> : null}
          <button onClick={() => setPick(new Set(shown.filter(r => !closed(r) && r.state !== 'inspect' && !r.assignedTo).map(r => r.roomId)))} className="h-8 px-2.5 rounded-lg border border-line text-[12.5px] font-semibold">Pick unassigned</button>
          {pick.size ? <button onClick={() => setPick(new Set())} className="text-[12px] text-muted hover:text-ink">clear</button> : null}
          <span className="flex-1" />
          <button disabled={!!busy || !s.unassigned} onClick={openAuto} className="h-8 px-3 rounded-lg border border-ink text-ink text-[12.5px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5" title="Split every unassigned room across the people you pick, by minutes, wing by wing"><Wand2 size={13} /> Auto-assign {s.unassigned || ''}</button>
        </div>
      ) : null}
      {msg ? <p className={`np text-[12.5px] mb-2 ${msg.bad ? 'text-amber-800' : 'text-emerald-800'}`}>{msg.t}</p> : null}

      {auto ? (
        <div className="np rounded-xl border border-ink bg-white p-3 mb-3">
          <div className="text-[13px] font-semibold text-ink">Who is working {live ? 'today' : dayShort(d.date)}?</div>
          <p className="text-[12px] text-muted mb-2">The {s.unassigned} unassigned rooms are split across them by minutes. Rooms already given to someone stay where they are.</p>
          <div className="flex gap-1.5 flex-wrap">
            {names.map(n => <button key={n} onClick={() => setAuto(a => { const x = new Set(a); x.has(n) ? x.delete(n) : x.add(n); return x })} className={`rounded-full border px-2.5 py-1 text-[12.5px] font-semibold ${auto.has(n) ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{n}</button>)}
          </div>
          {!names.length ? <p className="text-[12px] text-amber-800 mt-1">No housekeepers on the roster yet — add them under Staff week.</p> : null}
          <div className="flex items-center gap-2 mt-2.5">
            <button disabled={!auto.size || !!busy} onClick={runAuto} className="h-8 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">{busy === 'auto' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Split across {auto.size}{auto.size ? ` · about ${hrs(Math.round(s.minutes / auto.size))} each` : ''}</button>
            <button onClick={() => setAuto(null)} className="h-8 px-2.5 rounded-lg border border-line text-[12.5px] font-semibold">Cancel</button>
          </div>
        </div>
      ) : null}

      {/* The rooms. */}
      {!rows.length ? <LeanEmpty>{live ? 'No housekeeping work today: nobody leaving, staying or arriving, and no vacant dirty rooms.' : 'No bookings touch this day yet.'}</LeanEmpty> : !shown.length ? <LeanEmpty>No rooms in this view.</LeanEmpty> : groups.map(g => {
        const T = group === 'type' ? TYPE[g.key as TypeKey] : null
        const mins = g.rows.reduce((a, r) => a + r.minutes, 0), left = g.rows.filter(r => !closed(r)).length
        return (
          <section key={g.key} className="mb-4 break-inside-avoid">
            <div className="flex items-baseline gap-2 mb-1 px-1">
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-ink">{T ? T.plural : g.key}</h2>
              <span className="text-[12px] text-muted tabular-nums">{g.rows.length} room{g.rows.length === 1 ? '' : 's'}{live ? ` · ${left} left` : ''}{mins ? ` · ${hrs(mins)}` : ''}</span>
              {T ? <span className="text-[11.5px] text-muted hidden sm:inline">{T.what}</span> : null}
              <span className="flex-1" />
              {canEdit ? <button onClick={() => setPick(p => { const n = new Set(p); const ids = g.rows.filter(r => !closed(r)).map(r => r.roomId); const all = ids.every(i => n.has(i)); ids.forEach(i => all ? n.delete(i) : n.add(i)); return n })} className="np text-[11.5px] font-semibold text-muted hover:text-ink">pick all</button> : null}
            </div>
            <div className="rounded-xl border border-line bg-white divide-y divide-line/70 overflow-hidden">
              {g.rows.map(r => {
                const TT = TYPE[r.type as TypeKey], st = STATE[r.state], I = TT.icon
                const tags = [...(r.out?.tags || []), ...(r.in?.tags || []), ...(r.stay?.tags || [])].filter((t: any, i: number, a: any[]) => a.findIndex(x => x.key === t.key) === i)
                return (
                  <div key={r.roomId} className={`flex items-stretch ${closed(r) ? 'opacity-55' : ''} ${pick.has(r.roomId) ? 'bg-brand-50/60' : ''}`}>
                    <div className={`w-1 shrink-0 ${TT.bar}`} />
                    {canEdit ? <label className="np flex items-center pl-2.5 pr-1 cursor-pointer"><input type="checkbox" checked={pick.has(r.roomId)} onChange={() => toggle(r.roomId)} className="h-4 w-4" aria-label={`Pick room ${r.room}`} /></label> : null}
                    <div className="w-[4.6rem] shrink-0 px-2 py-2">
                      <div className="text-[19px] font-semibold tabular-nums text-ink leading-none">{r.room}</div>
                      <div className="text-[10.5px] text-muted truncate mt-0.5" title={r.roomType || ''}>{r.roomType || r.area}</div>
                    </div>
                    <div className="flex-1 min-w-0 py-2 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {group !== 'type' ? <Tag tone={TT.tone}><I size={10} className="inline -mt-0.5 mr-0.5" />{TT.label}</Tag> : null}
                        <Tag tone={st.tone}>{r.state === 'skip' ? r.skipWhy || 'Skip' : st.label}</Tag>
                        {r.flag ? <Tag tone="amber" title={r.flag}>{r.flag}</Tag> : null}
                        {r.dnd && r.state !== 'skip' ? <Tag tone="violet">DND</Tag> : null}
                        {tags.map((t: any) => <Tag key={t.key} tone={t.tone as Tone}>{t.label}</Tag>)}
                      </div>
                      <div className="text-[12.5px] text-ink mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                        {r.out ? <span className="inline-flex items-center gap-1 min-w-0"><LogOut size={12} className="text-muted shrink-0" /><span className="truncate max-w-[11rem]">{r.out.name}</span>{live ? <span className={r.out.status === 'checked_out' ? 'text-emerald-700 font-semibold' : 'text-violet-700 font-semibold'}>{r.out.status === 'checked_out' ? 'left' : 'still in'}</span> : null}</span> : null}
                        {r.in ? <span className="inline-flex items-center gap-1 min-w-0"><LogIn size={12} className="text-muted shrink-0" /><span className="truncate max-w-[11rem]">{r.in.name}</span><span className="text-muted">{r.in.people} guest{r.in.people === '1' ? '' : 's'} · {r.in.nights ?? '?'} nt{live && r.in.status === 'checked_in' ? <span className="text-emerald-700 font-semibold"> · arrived</span> : ''}</span></span> : null}
                        {r.stay ? <span className="inline-flex items-center gap-1 min-w-0"><Moon size={12} className="text-muted shrink-0" /><span className="truncate max-w-[11rem]">{r.stay.name}</span><span className="text-muted">night {r.stay.night} of {r.stay.nights ?? '?'} · leaves {dayShort(r.stay.checkOut)}</span></span> : null}
                        {r.type === 'dirty' ? <span className="text-muted inline-flex items-center gap-1"><DoorOpen size={12} /> empty · no booking today</span> : null}
                      </div>
                      {r.comments ? <div className="text-[11.5px] text-muted mt-0.5 truncate" title={r.comments}>Cloudbeds note: {r.comments}</div> : null}
                    </div>
                    <div className="shrink-0 py-2 pr-2.5 flex flex-col items-end justify-center gap-1">
                      {canEdit ? (
                        <select value={r.assignedTo || ''} disabled={!!busy} onChange={e => assign([r.roomId], e.target.value || null)} className={`np h-7 max-w-[10.5rem] rounded-lg border px-1.5 text-[12px] ${r.assignedTo ? 'border-line bg-white text-ink' : closed(r) ? 'border-line bg-white text-muted' : 'border-rose-200 bg-rose-50 text-rose-800 font-semibold'}`} title={r.assignedFrom === 'cloudbeds' ? 'Assigned in Cloudbeds' : r.assignedFrom === 'lighthouse' ? 'Assigned here' : 'Nobody yet'}>
                          <option value="">Unassigned</option>
                          {r.assignedTo && !names.includes(r.assignedTo) ? <option value={r.assignedTo}>{r.assignedTo}</option> : null}
                          {names.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      ) : null}
                      <span className="hidden print:inline text-[12px] font-semibold">{r.assignedTo || '________'}</span>
                      {!canEdit ? <span className="np text-[12px] text-ink">{r.assignedTo || <span className="text-rose-700">unassigned</span>}</span> : null}
                      {canEdit && live ? (
                        <div className="np flex gap-1">
                          {(r.state === 'todo' || r.state === 'cleaning') ? <button disabled={!!busy} onClick={() => setCond(r, 'clean')} className="h-7 px-2 rounded-lg border border-emerald-300 text-emerald-800 text-[11.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-40" title="Marks the room Clean in Cloudbeds">{busy === r.roomId + 'clean' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Clean</button> : null}
                          {(r.state === 'inspect' || ((r.state === 'todo' || r.state === 'cleaning') && r.type !== 'stayover')) ? <button disabled={!!busy} onClick={() => setCond(r, 'inspected')} className="h-7 px-2 rounded-lg border border-sky-300 text-sky-800 text-[11.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-40" title="Marks the room Inspected in Cloudbeds — ready for the guest">{busy === r.roomId + 'inspected' ? <Loader2 size={11} className="animate-spin" /> : <CheckCheck size={11} />} Inspected</button> : null}
                          {(r.state === 'ready' || r.state === 'inspect' || (r.state === 'done' && r.type === 'stayover')) ? <button disabled={!!busy} onClick={() => setCond(r, 'dirty')} className="h-7 px-2 rounded-lg border border-line text-muted text-[11.5px] font-semibold disabled:opacity-40" title="Back to Dirty in Cloudbeds">undo</button> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
