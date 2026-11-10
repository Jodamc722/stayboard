'use client'
// UPKEEP — the recurring programs as a daily KPI page (Jon, 2026-10-03: "take the today page and
// build an operation page … track PM, deep cleans, AC filter changes, battery changes, inspections,
// FFE audits … late, coming soon, etc.").
//
// Built the way the Today page is built: a strip of tiles, one per program, grouped by trade; a
// tile opens the full list under it with the actions in place. The number on a tile is what is
// LATE, because that is the one that costs a guest something; "due in 14 days" is the second line
// so a supervisor can book next week before it turns red. A matrix view (Grid) shows every unit
// against every program for the building you are standing in.
//
// Where the facts come from (nothing new to maintain): the cadence catalogue in Settings → Cadences
// says what each program is and how often; a completed Breezeway task whose name matches the
// program IS the record it was done (and a finished /ffe walk, for FF&E audits). "No record" is a
// unit nobody has logged the job on — not "late", because it is far more often a data gap.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, Plus, ExternalLink, Search, LayoutGrid, List, CalendarDays, Pencil, Wrench, Sparkles, Fan, ClipboardCheck, Building2, Zap, ArrowRight } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { LeanHead, Pill, Tag, LeanEmpty, type Tone } from '@/components/lean'
import type { Upkeep, UpkeepProgram, UpkeepRow, UpkeepState, UpkeepRows } from '@/app/api/upkeep/route'
import { UpkeepCalendar } from '@/components/UpkeepCalendar'
import { UpkeepPrograms } from '@/components/UpkeepPrograms'
import { UpkeepProgramEdit } from '@/components/UpkeepProgramEdit'
import { UpkeepAutomations } from '@/components/UpkeepAutomations'
import type { CadenceDef } from '@/lib/cadences'
import type { ProgramTile as PropTileData } from '@/lib/site-programs'

const url = (market: string) => '/api/upkeep?market=' + encodeURIComponent(market)
// The SAME key the Property programs tab reads (components/UpkeepPrograms URL_MAIN), so the two share one request.
const PROP_URL = '/api/upkeep/programs?options=1'
type PropData = { ok: boolean; day: string; tiles?: PropTileData[]; lastReport?: Record<string, { code: string; date: string; passed: number; issues: number; open: number }>; planError?: string | null }
/** The group a just-saved program's tile sits in until the server answers (the same rule as /api/upkeep groupOf). */
const groupGuess = (c: CadenceDef): UpkeepProgram['group'] => /\b(a\/?c|air ?con|hvac|mini ?split|coil|filter)\b/i.test(c.label) ? 'ac' : c.dept === 'housekeeping' ? 'housekeeping' : c.dept === 'inspection' ? 'quality' : 'maintenance'
const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const nice = (ymd: string | null) => { if (!ymd) return '—'; const d = new Date(ymd + 'T12:00:00Z'); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getUTCFullYear() === new Date().getFullYear() ? undefined : 'numeric', timeZone: 'UTC' }) }
const every = (d: number) => d % 365 === 0 ? (d / 365 === 1 ? 'yearly' : 'every ' + d / 365 + ' years') : d % 30 === 0 && d >= 60 ? 'every ' + d / 30 + ' months' : d === 182 || d === 180 ? 'every 6 months' : 'every ' + d + ' days'
const whenWord = (r: UpkeepRow) => r.state === 'none' ? 'never recorded' : r.daysOver > 0 ? r.daysOver + 'd late' : r.daysOver === 0 ? 'due today' : 'in ' + (-r.daysOver) + 'd'

const STATE: Record<UpkeepState, { label: string; tone: Tone; bar: string; dot: string }> = {
  late:   { label: 'Late',       tone: 'roseSolid', bar: 'bg-rose-500',    dot: 'bg-rose-500' },
  soon:   { label: 'Due soon',   tone: 'amber',     bar: 'bg-amber-400',   dot: 'bg-amber-400' },
  booked: { label: 'Booked',     tone: 'sky',       bar: 'bg-sky-400',     dot: 'bg-sky-400' },
  ok:     { label: 'On track',   tone: 'emerald',   bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  none:   { label: 'No record',  tone: 'slate',     bar: 'bg-slate-200',   dot: 'bg-slate-200' },
}
const ORDER: UpkeepState[] = ['late', 'soon', 'booked', 'ok', 'none']
const GROUPS: { key: UpkeepProgram['group']; label: string; Icon: any }[] = [
  { key: 'ac', label: 'Air conditioning', Icon: Fan },
  { key: 'housekeeping', label: 'Housekeeping', Icon: Sparkles },
  { key: 'maintenance', label: 'Maintenance', Icon: Wrench },
  { key: 'quality', label: 'Quality', Icon: ClipboardCheck },
  { key: 'other', label: 'Other programs', Icon: Wrench },
]

export function UpkeepBoard() {
  const [market, setMarket] = useState<string>(() => { try { return localStorage.getItem('upkeep.market') || 'all' } catch { return 'all' } })
  const { data, loading, error, refresh } = useCachedFetch<Upkeep & { error?: string }>(url(market), { ttl: 10 * 60_000 })
  const [open, setOpen] = useState<string>('')
  const [state, setState] = useState<UpkeepState | 'all'>('all')
  const [building, setBuilding] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  // TWO TABS (Jon, 2026-10-19: "make a tab for calendar view instead of at the bottom"): the programs
  // (tiles + list) and the calendar, which gets the whole width and its own program filter.
  // Always opens on Programs (Jon, 2026-10-19); the calendar is one click away.
  // A FOURTH TAB (Jon, 2026-11-09: "automated task creations (should live in upkeep)"): every creator
  // of Breezeway tasks, its switch, cap and last run — components/UpkeepAutomations.
  const [tab, setTab] = useState<'programs' | 'calendar' | 'property' | 'automations'>('programs')
  const [calProg, setCalProg] = useState<string>('')
  const [editProg, setEditProg] = useState<string | null>(null)   // cadence key, '' = new program, null = closed
  const [savedMsg, setSavedMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [filed, setFiled] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [recording, setRecording] = useState<string>('')      // row id with the date box open
  const [recDate, setRecDate] = useState<string>('')
  const [infoEdit, setInfoEdit] = useState<{ listingId: string; filterSize: string; filterQty: string; filterLocation: string; notes: string } | null>(null)
  const [infoLocal, setInfoLocal] = useState<Record<string, any>>({})
  const [done, setDone] = useState<Record<string, string>>({})  // row id → what happened ("recorded Oct 1", "approved — Oct 15")
  // PROPERTY PROGRAMS ON THIS BOARD TOO (Jon, 2026-11-09: "programs should show on the board as well
  // when new one is created"): their own group of tiles, read from the same route the tab uses.
  const prop = useCachedFetch<PropData>(PROP_URL, { ttl: 5 * 60_000 })
  const [focusProp, setFocusProp] = useState('')
  // A program saved a moment ago: its tile shows at once, before the ledger has been re-read.
  const [pending, setPending] = useState<Record<string, CadenceDef>>({})

  // A PERSON RECORDS THE LAST TIME (2026-10-13: "no record" was two thirds of the ledger). The date
  // lands on the ledger and the clock starts from it — no task is created.
  const record = async (r: UpkeepRow) => {
    if (!recDate || busy) return
    setBusy(r.id); setErr('')
    try {
      const res = await fetch('/api/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'record', listingId: r.listingId, cadenceKey: prog?.key, lastDone: recDate }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'could not record it')
      setDone(d => ({ ...d, [r.id]: 'recorded ' + nice(j.lastDone) + ' · next ' + nice(j.nextDue) })); setRecording('')
      // Re-read, not only forget: the tile's numbers stayed as they were until the page was left and reopened.
      reread()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }
  // AN APPROVER SAYS YES (Jon, 2026-10-07): the task is booked — next empty day, or the next departure
  // for Salato — with the billing line on it. Decline parks it for 30 days.
  const decide = async (r: UpkeepRow, op: 'approve' | 'decline') => {
    if (busy) return
    setBusy(r.id); setErr('')
    try {
      const res = await fetch('/api/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, listingId: r.listingId, cadenceKey: prog?.key, dueOn: r.dueOn }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'could not ' + op)
      if (op === 'approve') { setFiled(f => ({ ...f, [r.id]: String(j.taskId || '') })); setDone(d => ({ ...d, [r.id]: 'booked ' + nice(j.date) + (Array.isArray(j.assignees) && j.assignees.length ? ' · ' + j.assignees.join(', ') : '') + (j.why ? ' — ' + j.why : '') + (j.blockAdvice ? ' · ' + j.blockAdvice : '') })) }
      else setDone(d => ({ ...d, [r.id]: 'declined — back in 30 days' }))
      reread()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }
  // UNIT INFO (Jon, 2026-10-16: "should add info, like AC filter sizes etc"): saved per unit, printed
  // on every upkeep task booked for it.
  const infoOf = (lid: string): any => (lid in infoLocal ? infoLocal[lid] : unitInfo[lid]) || null
  const saveInfo = async () => {
    if (!infoEdit || busy) return
    setBusy('info'); setErr('')
    try {
      const res = await fetch('/api/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'info', cadenceKey: prog?.key, ...infoEdit, filterQty: Number(infoEdit.filterQty) || null }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'could not save the unit info')
      setInfoLocal(m => ({ ...m, [infoEdit.listingId]: j.info || null })); setInfoEdit(null)
      invalidateCache(url(market)); if (rowsUrl) invalidateCache(rowsUrl)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }
  // Booking from the calendar changed the ledger, but re-reading while the calendar is open would
  // redraw it under the person mid-booking — so the re-read happens when they leave the calendar tab,
  // and the tiles and pills then agree with what was just booked.
  const calDirty = useRef(false)
  const rereadSoon = () => { calDirty.current = true }
  useEffect(() => {
    if (tab !== 'calendar' && calDirty.current) { calDirty.current = false; invalidateCache(url(market)); invalidateCache(url(market) + '&rows=all'); refresh() }
  }, [tab, market, refresh])
  const pickMarket = (m: string) => { setMarket(m); try { localStorage.setItem('upkeep.market', m) } catch { /* fine */ } }
  const reload = () => reread()

  // THE UNIT ROWS LOAD WHEN THEY ARE NEEDED (2026-11-10: the board shipped every row of every program
  // on every load — 602 KB, 4.4 s). The first read is the summary; an opened tile asks for its own
  // rows; the Calendar tab and the Grid need every program's, so they ask for all of them.
  const rowsWhich = !data || !data.rowsOnDemand ? '' : tab === 'calendar' || (tab === 'programs' && !!open && view === 'grid') ? 'all' : tab === 'programs' && open ? open : ''
  const rowsUrl = rowsWhich ? url(market) + '&rows=' + encodeURIComponent(rowsWhich) : null
  const rowsQ = useCachedFetch<UpkeepRows>(rowsUrl, { ttl: 10 * 60_000, persist: false })
  // Only rows read for THIS area and day; a summary from before this change still carries its own.
  const rowsFor = rowsQ.data && rowsQ.data.market === market ? rowsQ.data.rows : null
  const programs = useMemo(() => {
    const base = data?.programs || []
    if (!data?.rowsOnDemand) return base
    return base.map(p => (rowsFor && rowsFor[p.key] ? { ...p, rows: rowsFor[p.key] } : p))
  }, [data, rowsFor])
  /** Are this program's unit rows on the page yet? (A program with no units has nothing to wait for.) */
  const rowsReady = (p: UpkeepProgram) => !data?.rowsOnDemand || !(p.late + p.soon + p.ok + p.booked + p.none) || !!(rowsFor && rowsFor[p.key])
  const unitInfo: Record<string, any> = data?.rowsOnDemand ? (rowsQ.data?.info || {}) : (data?.info || {})
  // After anything that changes the ledger: the summary AND whichever rows are on screen.
  const reread = () => { invalidateCache(url(market)); refresh(); if (rowsUrl) { invalidateCache(rowsUrl); rowsQ.refresh() } }
  const prog = programs.find(p => p.key === open) || null
  const rows = useMemo(() => {
    if (!prog) return [] as UpkeepRow[]
    const needle = q.trim().toLowerCase()
    return prog.rows
      .filter(r => state === 'all' ? r.state !== 'ok' || prog.late + prog.soon + prog.none === 0 : r.state === state)
      .filter(r => !building || r.building === building)
      .filter(r => !needle || (r.unit + ' ' + r.building).toLowerCase().includes(needle))
  }, [prog, state, building, q])

  // One row → one Breezeway task, through the route the Add sheet uses. The description says why
  // it exists, so whoever opens it in the field app is not guessing.
  const t = data?.totals
  const head = (
    <LeanHead title="Upkeep" sub={data ? (() => {
      const live = programs.filter(p => !(p.setup || p.inert)).length, setup = programs.length - live
      const tiles = prop.data?.tiles || null
      const total = programs.length + (tiles ? tiles.length : 0)
      return `${t && typeof t.units === 'number' ? t.units : new Set(programs.flatMap(p => p.rows.map(r => r.listingId))).size} units · ${total} programs — ${live} on a clock${setup ? ` (+${setup} to set up)` : ''}${tiles ? ` · ${tiles.length} property program${tiles.length === 1 ? '' : 's'}` : ' · property programs not read yet'} · as of ${nice(data.today)}`
    })() : 'Recurring programs, every unit, on their clocks'}>
      {t ? <>
        <Pill tone={t.late ? 'roseSolid' : 'emerald'} title="Jobs past their due date">{t.late} late{t.lateUnits ? ' · ' + t.lateUnits + ' units' : ''}{t.late90plus ? ' · ' + t.late90plus + ' over 90d' : ''}</Pill>
        <Pill tone="amber" title={'Due in the next ' + (data?.soonDays || 14) + ' days'}>{t.soon} due soon</Pill>
        {t.awaiting ? <Pill tone="amber" title="Due on a program that needs an approver's yes before it is booked">{t.awaiting} to approve</Pill> : null}
        <Pill tone="sky" title="Already on the board in Breezeway">{t.booked} booked</Pill>
        {t.bookedLate ? <Pill tone="amber" title="Booked, but the task's day has passed and it is still open — on the board, not done. Counted inside “booked”.">{t.bookedLate} booked past their day</Pill> : null}
        {(() => { const n = typeof t.onClock === 'number' ? t.onClock : programs.reduce((k, p) => k + p.rows.filter(r => r.source === 'clock').length, 0); return n ? <Pill tone="slate" title="Never recorded, so the clock was started — first rounds are spread over one interval. Record a real date to replace one.">{n} on a new clock</Pill> : null })()}
        {t.none ? <Pill tone="slate" title="Never recorded on this unit — a data gap more often than neglect">{t.none} no record</Pill> : null}
      </> : null}
      {data && data.markets.length > 1 ? (
        <select value={market} onChange={e => pickMarket(e.target.value)} className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] font-semibold text-ink" aria-label="Area">
          <option value="all">All areas</option>
          {data.markets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : null}
      <button onClick={reload} title="Re-read the ledger" className="h-8 w-8 rounded-lg border border-line bg-white text-muted hover:text-ink grid place-items-center"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      {/* THE PROGRAMS ARE BUILT IN SETTINGS (Jon, 2026-10-03: "build out proper specific activities that
          need to be done in a particular period of time, so there should be a settings where we can
          build that into") — Settings → Preventative cadences: name, every N days, trade, what counts
          as done, which equipment / buildings, whether the next one is filed automatically. */}
      <button onClick={() => { setTab('programs'); setEditProg(''); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* fine */ } }} disabled={data ? data.canProgram === false : false}
        title={data && data.canProgram === false ? 'Programs are added by the owner' : 'A new recurring program — name, how often, where, who'}
        className="lh-primary h-9 sm:h-8 px-3 sm:px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-40"><Plus size={12} /> Program</button>
    </LeanHead>
  )

  if (loading && !data) return <>{head}<LeanEmpty><Loader2 size={14} className="animate-spin inline mr-2" /> Reading every unit against every program…</LeanEmpty></>
  if (!data) return <>{head}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error || 'Nothing loaded.'}</div></>

  return (
    <div className="space-y-4">
      {head}
      {!data.enabled && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">The cadence engine is switched off in Settings → Cadences, so nothing is being proposed or created automatically. This page still reads the ledger.</p>}
      {data.degraded.length ? <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Some of this could not be read in full, so the numbers are a floor: {data.degraded.join(' · ')}</p> : null}
      {/* A refresh that failed says so — the numbers below are the last good read, not today's. */}
      {error ? <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">Could not refresh just now ({error}) — showing the last read. <button onClick={reload} className="underline font-semibold">Try again</button></p> : null}

      {/* ── THE TABS ── */}
      <div className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {([['programs', 'Programs', LayoutGrid], ['property', 'Property programs', Building2], ['calendar', 'Calendar', CalendarDays], ['automations', 'Automations', Zap]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className={'h-9 px-3 -mb-px shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-[13px] font-semibold border-b-2 ' + (tab === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            <Icon size={14} /> {label}
          </button>
        ))}
        {tab === 'calendar' ? <span className="ml-2 text-[12px] text-muted hidden sm:inline">Green = you can get in · grey = guest in · coloured bars = reservations · click any day to book or block</span> : null}
      </div>

      {savedMsg ? <p className="text-[12.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{savedMsg}</p> : null}
      {editProg !== null && tab === 'programs' ? <UpkeepProgramEdit cadenceKey={editProg || undefined} onClose={() => setEditProg(null)} onSaved={(label, saved, isNew) => {
        setEditProg(null)
        if (saved && saved.key) setPending(m => ({ ...m, [saved.key]: saved }))
        setSavedMsg('Saved ' + label + (isNew ? ' — its tile is on the board below; the numbers fill in as every unit is counted.' : ' — the tiles refresh with it.'))
        reload()
      }} /> : null}
      {tab === 'automations' ? <UpkeepAutomations onOpenPrograms={() => setTab('property')} /> : tab === 'property' ? <UpkeepPrograms focusId={focusProp} onChanged={() => { prop.refresh() }} /> : tab === 'calendar' ? (
        <section className="rounded-2xl border border-line bg-white overflow-hidden">
          <header className="px-3 py-2 border-b border-line flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 flex-wrap">
              <button onClick={() => setCalProg('')} aria-pressed={!calProg} className={'text-[11.5px] font-semibold px-2.5 h-7 rounded-full border ' + (!calProg ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')}>Everything due</button>
              {programs.filter(p => !p.inert && (p.late + p.soon + p.none) > 0).map(p => (
                <button key={p.key} onClick={() => setCalProg(p.key)} aria-pressed={calProg === p.key} className={'text-[11.5px] font-semibold px-2.5 h-7 rounded-full border inline-flex items-center gap-1 ' + (calProg === p.key ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')}>
                  {p.label.replace(/ \(.*\)$/, '')}<span className={'text-[10.5px] font-bold px-1 rounded ' + (calProg === p.key ? 'bg-white/20' : p.late ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}>{p.late + p.soon + p.none}</span>
                </button>
              ))}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <select value={building} onChange={e => setBuilding(e.target.value)} className="h-7 rounded-md border border-line bg-white px-1.5 text-[11.5px] font-semibold text-ink max-w-[11rem]" aria-label="Building">
                <option value="">All buildings</option>
                {data.buildings.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <label className="h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 text-[11.5px]"><Search size={11} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="unit" className="w-16 bg-transparent outline-none text-ink" /></label>
            </span>
          </header>
          {(() => {
            const cp = programs.find(p => p.key === calProg) || null
            // Every program's rows are needed here; say so while they load (or if they could not be read).
            if (data.rowsOnDemand && !(rowsFor && rowsQ.data?.which === 'all')) return rowsQ.error
              ? <p className="px-3 py-4 text-[12.5px] text-rose-700">The units could not be read ({rowsQ.error}). <button onClick={() => { if (rowsUrl) invalidateCache(rowsUrl); rowsQ.refresh() }} className="underline font-semibold">Try again</button></p>
              : <p className="px-3 py-6 text-[12.5px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading every unit that is due…</p>
            return <UpkeepCalendar key={calProg || 'all'} programs={programs} prog={cp} rows={cp ? cp.rows.filter(r => r.state !== 'ok') : []} building={building} q={q}
              canEdit={!!data.canEdit} canApprove={data.canApprove || []} info={unitInfo}
              onBooked={(id, msg, taskId) => { setDone(d => ({ ...d, [id]: msg })); setFiled(f => ({ ...f, [id]: taskId })); rereadSoon() }} />
          })()}
        </section>
      ) : (<>
      {/* ── THE TILES, BY TRADE ── */}
      {!programs.length ? <LeanEmpty>No programs came back from the ledger. Press refresh; if it stays empty, the cadence settings could not be read — nothing here means “not read”, not “nothing due”.</LeanEmpty> : null}
      {GROUPS.map(g => {
        const ps = programs.filter(p => p.group === g.key)
        // Saved a moment ago and not in the ledger read yet: shown at once, in its group.
        const fresh = Object.values(pending).filter(c => groupGuess(c) === g.key && !programs.some(p => p.key === c.key))
        if (!ps.length && !fresh.length) return null
        const canProgram = data.canProgram !== false
        return (
          <section key={g.key}>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted mb-1.5 flex items-center gap-1.5"><g.Icon size={12} /> {g.label}</p>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {ps.map(p => <ProgramTile key={p.key} p={p} on={open === p.key} canProgram={canProgram} justSaved={!!pending[p.key]}
                onSetup={() => { setEditProg(p.key); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* fine */ } }}
                onClick={() => { setOpen(open === p.key ? '' : p.key); setState('all'); setQ('') }} />)}
              {fresh.map(c => (
                <div key={'new-' + c.key} className="rounded-2xl border border-dashed border-brand-300 bg-white px-3 py-2.5 min-h-[92px] flex flex-col gap-1.5 min-w-0">
                  <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted truncate">{c.label}</span>
                  <span className="text-[12.5px] font-semibold text-ink inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin text-muted" /> {c.mode === 'off' ? 'Saved — switched off' : 'Saved — counting every unit…'}</span>
                  <span className="text-[11px] text-muted">{every(c.everyDays)} · {(c.scopeBuildings || []).length + (c.scopeUnits || []).length ? (c.scopeBuildings || []).concat((c.scopeUnits || []).length ? [(c.scopeUnits || []).length + ' unit' + ((c.scopeUnits || []).length === 1 ? '' : 's')] : []).join(', ') : 'every unit'}</span>
                </div>
              ))}
            </div>
          </section>
        )
      })}

      {/* ── PROPERTY PROGRAMS: the scheduled walks and checks at a building or unit ── */}
      <section>
        <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted mb-1.5 flex items-center gap-1.5"><Building2 size={12} /> Property programs
          <button onClick={() => { setFocusProp(''); setTab('property') }} className="ml-1 normal-case tracking-normal font-semibold text-brand-700 hover:underline">manage</button></p>
        {prop.loading && !prop.data ? <p className="text-[12px] text-muted"><Loader2 size={12} className="animate-spin inline mr-1.5" /> Reading the property programs…</p>
          : !prop.data ? <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">The property programs could not be read{prop.error ? ' (' + prop.error + ')' : ''}. <button onClick={() => { invalidateCache(PROP_URL); prop.refresh() }} className="underline font-semibold">Try again</button></p>
          : !prop.data.tiles ? <p className="text-[12px] text-muted">The property programs load on the next refresh. <button onClick={() => { invalidateCache(PROP_URL); prop.refresh() }} className="underline font-semibold">Refresh</button></p>
          : !prop.data.tiles.length ? <button onClick={() => { setFocusProp(''); setTab('property') }} className="w-full sm:w-auto text-left rounded-2xl border border-dashed border-line bg-white px-3 py-3 min-h-[44px] text-[12.5px] text-muted hover:border-ink/30">No property program yet — <span className="font-semibold text-ink">create one</span> (a checklist on a schedule at a building or unit).</button>
          : <>
            {prop.data.planError ? <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">Today’s plan could not be read ({prop.data.planError}) — the counts on these tiles are not reliable until it can.</p> : null}
            {prop.error ? <p className="text-[12px] text-amber-800 mb-2">Could not refresh the property programs just now — showing the last read.</p> : null}
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {prop.data.tiles.map(tl => <PropertyTile key={tl.id} t={tl} today={prop.data!.day} report={(prop.data!.lastReport || {})[tl.id] || null} planBroken={!!prop.data!.planError} onClick={() => { setFocusProp(tl.id); setTab('property') }} />)}
            </div>
          </>}
      </section>

      {/* ── THE LIST / GRID UNDER THE OPEN TILE ── */}
      {prog ? (
        <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
          <header className="px-3 py-2 border-b border-line flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-ink">{prog.label}</span>
            <span className="text-[11.5px] text-muted">{every(prog.everyDays)} · {prog.units} units{prog.equipment !== 'any' ? ' · ' + prog.equipment.replace('non-central', 'mini-split / wall') + ' A/C' : ''}</span>
            <span className="inline-flex items-center gap-1 flex-wrap ml-1">
              {(['all', ...ORDER] as const).map(k => {
                const n = k === 'all' ? prog.late + prog.soon + prog.ok + prog.booked + prog.none : prog[k]
                if (k !== 'all' && !n) return null
                return <button key={k} onClick={() => setState(k)} aria-pressed={state === k} className={'text-[11px] font-semibold px-2 h-6 rounded-md border ' + (state === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{k === 'all' ? 'Needs attention' : STATE[k].label} {n}</button>
              })}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <select value={building} onChange={e => setBuilding(e.target.value)} className="h-7 rounded-md border border-line bg-white px-1.5 text-[11.5px] font-semibold text-ink max-w-[11rem]" aria-label="Building">
                <option value="">All buildings</option>
                {Array.from(new Set(prog.rows.map(r => r.building))).sort().map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <label className="h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 text-[11.5px]"><Search size={11} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="unit" className="w-16 bg-transparent outline-none text-ink" /></label>
              <span className="inline-flex rounded-md border border-line overflow-hidden">
                {([['list', 'List', List, 'One row per unit'], ['grid', 'Grid', LayoutGrid, 'Every unit against every program']] as const).map(([k, label, Icon, tip]) => (
                  <button key={k} onClick={() => setView(k)} aria-pressed={view === k} title={tip} className={'h-7 px-2 inline-flex items-center gap-1 text-[11.5px] font-semibold ' + (view === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}><Icon size={12} /> {label}</button>
                ))}
                <button onClick={() => { setEditProg(prog.key); window.scrollTo({ top: 0, behavior: 'smooth' }) }} title="Edit this program — how often, auto-create, where, who gets it" className="h-7 px-2 inline-flex items-center gap-1 text-[11.5px] font-semibold bg-white text-muted hover:text-ink border-r border-line"><Pencil size={12} /> Edit</button>
                <button onClick={() => { setCalProg(prog.key); setTab('calendar') }} title="This program on the calendar — open days, who is there, click a day to book" className="h-7 px-2 inline-flex items-center gap-1 text-[11.5px] font-semibold bg-white text-muted hover:text-ink"><CalendarDays size={12} /> Calendar</button>
              </span>
            </span>
          </header>
          {prog ? <p className="px-3 py-1.5 text-[11.5px] text-muted border-b border-line bg-app/40">{prog.how}{prog.awaiting ? ` · ${prog.awaiting} waiting on an approver` : ''}{prog.late90plus ? ` · ${prog.late90plus} over 90 days late` : ''}</p> : null}
          {err ? <p className="px-3 py-1.5 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">{err}</p> : null}
          {!rowsReady(prog) || (view === 'grid' && data.rowsOnDemand && rowsQ.data?.which !== 'all') ? (
            rowsQ.error
              ? <p className="px-3 py-4 text-[12.5px] text-rose-700">This program’s units could not be read ({rowsQ.error}). <button onClick={() => { if (rowsUrl) invalidateCache(rowsUrl); rowsQ.refresh() }} className="underline font-semibold">Try again</button></p>
              : <p className="px-3 py-5 text-[12.5px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading {view === 'grid' ? 'every unit against every program' : 'its ' + prog.units + ' units'}…</p>
          ) : view === 'grid' ? (
            <Matrix programs={programs} building={building} market={market} q={q} />
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">{state === 'all' ? 'Nothing needs attention here — every unit is on track or booked.' : 'Nothing in this state.'}</p>
          ) : (
            <ul className="divide-y divide-line max-h-[60vh] overflow-y-auto">
              {rows.slice(0, 400).map(r => {
                const taskId = filed[r.id] || r.task?.id || ''
                const st = filed[r.id] ? 'booked' : r.state
                return (
                  <li key={r.id} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                    <span className={'w-2 h-2 rounded-full shrink-0 ' + STATE[st].dot} />
                    <span className="text-[13px] font-semibold text-ink min-w-[7rem]">{r.unit}</span>
                    <span className="text-[11.5px] text-muted">{r.building}{r.market && market === 'all' ? ' · ' + r.market : ''}</span>
                    <Tag tone={st === 'late' && r.daysOver > 90 ? 'roseSolid' : STATE[st].tone}>{st === 'late' && r.daysOver > 90 ? 'Late 90+' : STATE[st].label}</Tag>
                    {r.taskLate && !filed[r.id] ? <Tag tone="amber" title="The booked task's day has passed and it is still open in Breezeway — on the board, not done">task past its day</Tag> : null}
                    {r.approval?.waiting && !filed[r.id] ? <Tag tone="amber">Needs approval</Tag> : null}
                    {r.approval?.declined ? <Tag tone="slate" title={r.approval.declined}>Declined</Tag> : null}
                    {r.source === 'recorded' ? <Tag tone="slate" title="A person recorded this date on the Upkeep page">recorded</Tag> : null}
                    {r.source === 'clock' ? <Tag tone="slate" title="Nothing was ever recorded for this, so the clock was started that day. The first round is spread out so a whole program does not land on one day. Record the real date if you know it.">clock started {nice(r.clockStarted || null)}</Tag> : null}
                    {r.source === 'new' ? <Tag tone="slate" title="No record yet, and the unit went live more recently than this program's interval — the clock started the day it went live">new unit · live {nice(r.goLive || r.lastDone)}</Tag> : null}
                    {done[r.id] ? <span className="text-[11.5px] text-emerald-700 font-semibold">{done[r.id]}</span> : null}
                    <span className={'text-[11.5px] tabular-nums ' + (r.state === 'late' ? 'text-rose-700 font-semibold' : 'text-muted')}>{r.state === 'none' ? 'never recorded' : r.source === 'clock' ? 'first due ' + nice(r.dueOn) + ' · ' + whenWord(r) : (r.source === 'new' ? 'live since ' : 'last ') + nice(r.lastDone) + ' · due ' + nice(r.dueOn) + ' · ' + whenWord(r)}</span>
                    {!taskId && !done[r.id] && (r.state === 'late' || r.state === 'soon' || r.state === 'none') ? (
                      r.plan ? <span className="text-[11.5px] text-sky-800" title="Smart booking: the day somebody of this trade is already going there. Approve / Add task books it on this day, with this person.">→ {r.plan.why}</span>
                        : r.plan === null ? <span className="text-[11.5px] text-faint" title="Nobody of this trade has work in this building in the next 3 weeks — Add task books the next empty day">nobody going there in 3 weeks</span>
                        : (/departure/.test(prog?.how || '') || /salato/i.test(r.building)) ? <span className="text-[11.5px] text-faint">→ with the next departure clean</span> : null
                    ) : null}
                    {(() => {
                      const inf = infoOf(r.listingId), ac = prog?.group === 'ac'
                      const label = inf ? [inf.filterSize ? 'Filter ' + inf.filterSize + (inf.filterQty ? ' ×' + inf.filterQty : '') : '', inf.filterLocation || '', inf.notes ? 'notes' : ''].filter(Boolean).join(' · ') : ''
                      if (!label && !(ac && data.canEdit)) return null
                      return data.canEdit
                        ? <button onClick={() => setInfoEdit({ listingId: r.listingId, filterSize: inf?.filterSize || '', filterQty: inf?.filterQty ? String(inf.filterQty) : '', filterLocation: inf?.filterLocation || '', notes: inf?.notes || '' })} title={(inf?.notes ? inf.notes + '\n\n' : '') + 'Unit info — printed on every upkeep task for this unit. Click to edit.'} className={'text-[11px] px-1.5 h-6 rounded-md border ' + (label ? 'border-line bg-white text-ink' : 'border-amber-300 bg-amber-50 text-amber-800')}>{label || '+ filter size'}</button>
                        : <Tag tone="slate" title={inf?.notes || ''}>{label}</Tag>
                    })()}
                    {infoEdit && infoEdit.listingId === r.listingId ? (
                      <span className="basis-full flex items-center gap-1.5 flex-wrap pl-4 pt-1">
                        <input value={infoEdit.filterSize} onChange={e => setInfoEdit({ ...infoEdit, filterSize: e.target.value })} placeholder="Filter size (20x25x1)" className="h-7 w-36 rounded-md border border-line px-1.5 text-[11.5px]" />
                        <input value={infoEdit.filterQty} onChange={e => setInfoEdit({ ...infoEdit, filterQty: e.target.value.replace(/[^0-9]/g, '') })} placeholder="Qty" className="h-7 w-12 rounded-md border border-line px-1.5 text-[11.5px]" />
                        <input value={infoEdit.filterLocation} onChange={e => setInfoEdit({ ...infoEdit, filterLocation: e.target.value })} placeholder="Where (hall ceiling, closet…)" className="h-7 w-48 rounded-md border border-line px-1.5 text-[11.5px]" />
                        <input value={infoEdit.notes} onChange={e => setInfoEdit({ ...infoEdit, notes: e.target.value })} placeholder="Notes (bring a ladder, breaker #12…)" className="h-7 flex-1 min-w-[10rem] rounded-md border border-line px-1.5 text-[11.5px]" />
                        <button onClick={saveInfo} disabled={busy === 'info'} className="text-[11.5px] font-semibold px-2 h-7 rounded-md bg-ink text-white disabled:opacity-50">Save</button>
                        <button onClick={() => setInfoEdit(null)} className="text-[11.5px] text-muted px-1">✕</button>
                      </span>
                    ) : null}
                    <span className="ml-auto inline-flex items-center gap-1.5 flex-wrap">
                      {data.canEdit && !taskId && recording === r.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="date" value={recDate} max={data.today} onChange={e => setRecDate(e.target.value)} className="h-7 rounded-md border border-line px-1.5 text-[11.5px]" />
                          <button onClick={() => record(r)} disabled={!recDate || !!busy} className="text-[12px] sm:text-[11.5px] font-semibold px-3 sm:px-2 h-9 sm:h-7 rounded-md bg-ink text-white disabled:opacity-50">Save</button>
                          <button onClick={() => setRecording('')} className="text-[11.5px] text-muted px-1">✕</button>
                        </span>
                      ) : data.canEdit && !taskId && !done[r.id] ? (
                        <button onClick={() => { setRecording(r.id); setRecDate(r.lastDone || '') }} title="Record when this was last done — the clock starts from that day; no task is created" className="text-[11.5px] font-semibold px-2 h-7 rounded-md border border-line bg-white text-muted hover:text-ink">{r.state === 'none' || r.source === 'clock' ? 'Record last done' : 'Fix date'}</button>
                      ) : null}
                      {!taskId && !done[r.id] && r.approval?.waiting && prog && data.canApprove.includes(prog.key) ? (
                        <>
                          <button onClick={() => decide(r, 'approve')} disabled={!!busy} title={(r.bill ? r.bill + '. ' : '') + 'Books the task — next empty day, or the next departure for Salato.'} className="inline-flex items-center gap-1 text-[12px] sm:text-[11.5px] font-semibold px-3 sm:px-2 h-9 sm:h-7 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                          <button onClick={() => decide(r, 'decline')} disabled={!!busy} className="text-[12px] sm:text-[11.5px] font-semibold px-3 sm:px-2 h-9 sm:h-7 rounded-md border border-line bg-white text-muted hover:text-ink disabled:opacity-50">Not now</button>
                        </>
                      ) : null}
                      {taskId ? <a href={bzTask(taskId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-sky-700 hover:underline"><ExternalLink size={11} /> {r.task?.date ? 'Task ' + nice(r.task.date) : 'Task filed'}</a>
                        : data.canEdit && !(prog?.needsApproval) ? <button onClick={() => decide(r, 'approve')} title={r.plan ? 'Books it ' + r.plan.why : 'Books it on the next empty day'} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] sm:text-[11.5px] font-semibold px-3 sm:px-2 h-9 sm:h-7 rounded-md border border-line bg-white text-ink hover:border-ink/40 disabled:opacity-40">{busy === r.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add task</button> : null}
                    </span>
                  </li>
                )
              })}
              {rows.length > 400 ? <li className="px-3 py-2 text-[11.5px] text-muted">{rows.length - 400} more — narrow by building.</li> : null}
            </ul>
          )}
        </section>
      ) : (
        <p className="text-[12px] text-muted">Open a tile to see its units. A program's clock restarts whenever a Breezeway task matching it is completed (or, for FF&E, a finished walk in /ffe). To add an activity on a period — what it is called, every how many days, which trade, which equipment or buildings, what counts as done — use <b className="text-ink">+ Program</b> at the top; its tile shows here the moment it is saved. Finer settings (equipment, billing, approvers) are in <Link href="/users?tab=settings&panel=cadences" className="font-semibold text-brand-700 hover:underline">Settings → Cadences</Link>.</p>
      )}
      </>)}
    </div>
  )
}

function ProgramTile({ p, on, onClick, onSetup, canProgram, justSaved }: { p: UpkeepProgram; on: boolean; onClick: () => void; onSetup: () => void; canProgram: boolean; justSaved?: boolean }) {
  const total = p.late + p.soon + p.ok + p.booked + p.none
  // NOT SET UP YET (2026-11-09): switched off, no buildings picked, or nothing matches where it
  // applies. These were greyed, disabled cards. Now the tile says which, and the whole tile is the
  // one action that finishes the setup (it opens the program's editor).
  const setup = p.setup || (p.inert ? (/switched off/.test(p.inert) ? 'off' : 'scope') : null)
  if (setup) {
    const line = setup === 'off' ? 'Switched off' : setup === 'scope' ? 'New — pick buildings' : 'No unit matches where it applies'
    const sub = setup === 'off' ? 'Nothing is counted or booked until it is turned on.' : setup === 'scope' ? 'It applies to nothing until its buildings or units are picked.' : 'Its buildings, equipment rule or this area leave it with no units.'
    const act = setup === 'off' ? 'Turn on' : setup === 'scope' ? 'Pick buildings' : 'Fix where it applies'
    return (
      <button onClick={canProgram ? onSetup : undefined} disabled={!canProgram}
        title={p.label + ' — ' + line + (canProgram ? ' · opens the program to finish setting it up' : ' · the owner sets programs up')}
        className="text-left rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 px-3 py-2.5 min-h-[92px] transition flex flex-col gap-1.5 min-w-0 hover:border-amber-500 disabled:hover:border-amber-300">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted truncate">{p.label}</span>
          <span className="text-[10.5px] text-muted/70 shrink-0">{every(p.everyDays)}</span>
        </div>
        <span className="text-[13px] font-bold text-amber-900">{line}</span>
        <span className="text-[11px] text-muted">{sub}</span>
        {canProgram
          ? <span className="mt-auto self-start inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg bg-ink text-white text-[12px] font-semibold">{act} <ArrowRight size={12} /></span>
          : <span className="mt-auto text-[11px] text-muted">The owner sets programs up.</span>}
      </button>
    )
  }
  const tone = p.late ? 'text-rose-700' : p.soon ? 'text-amber-700' : 'text-emerald-700'
  return (
    <button onClick={onClick} aria-pressed={on}
      title={p.label + ' — ' + every(p.everyDays) + ' · ' + p.units + ' units · ' + p.healthPct + '% current' + (on ? ' — click to close' : ' — click to open the list')}
      className={'text-left rounded-2xl border bg-white px-3 py-2.5 min-h-[92px] shadow-soft transition flex flex-col gap-1.5 min-w-0 ' + (on ? 'border-brand-400 ring-2 ring-brand-100' : justSaved ? 'border-emerald-300 hover:border-ink/30' : 'border-line hover:border-ink/30')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted truncate">{p.label}</span>
        <span className="text-[10.5px] font-bold tabular-nums text-muted/70 shrink-0" title="Current: on track, due soon or booked for a day that has not passed — of the units with a date">{total ? p.healthPct + '%' : ''}</span>
      </div>
      <div className="flex items-baseline gap-x-1.5 gap-y-0.5 flex-wrap">
        <span className={'text-[22px] leading-none font-bold tabular-nums ' + tone}>{p.late}</span>
        <span className="text-[11px] text-muted">late{p.late90plus ? <span className="text-rose-700 font-semibold"> · {p.late90plus} over 90d</span> : null}</span>
        {p.soon ? <span className="text-[11px] text-amber-700 font-semibold ml-1">{p.soon} due soon</span> : null}
        {p.awaiting ? <span className="text-[11px] text-amber-700 font-semibold ml-1">{p.awaiting} to approve</span> : null}
      </div>
      <div className="w-full h-1.5 rounded-full bg-line overflow-hidden flex" aria-hidden>
        {total > 0 && ORDER.filter(k => p[k] > 0).map(k => <span key={k} className={'block h-full ' + STATE[k].bar} style={{ width: (p[k] / total) * 100 + '%' }} title={p[k] + ' ' + STATE[k].label.toLowerCase()} />)}
      </div>
      <div className="text-[11px] text-muted truncate w-full">
        {p.countingSince
          ? <span className="text-sky-800 font-semibold" title="Nothing has been done or recorded on this program yet, so each unit's clock was started; the first round is spread over one interval. Record real dates in the list to replace them.">{p.countingSince >= new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) ? 'Counting from today' : 'Counting from ' + nice(p.countingSince)} · {p.units} units</span>
          : [every(p.everyDays), p.booked ? p.booked + ' booked' + (p.bookedLate ? ' (' + p.bookedLate + ' past their day)' : '') : '', p.ok ? p.ok + ' on track' : '', p.none ? p.none + ' no record' : ''].filter(Boolean).join(' · ')}
      </div>
    </button>
  )
}

/** One property program (lib/site-programs) on the main board: places, today's count, next run, last walk. */
function PropertyTile({ t, today, report, planBroken, onClick }: { t: PropTileData; today: string; report: { code: string; date: string; passed: number; issues: number; open: number } | null; planBroken: boolean; onClick: () => void }) {
  const dueToday = t.done + t.open + t.late
  const setupLine = t.setup === 'off' ? 'Paused' : t.setup === 'noPlaces' ? 'New — add a building or unit' : t.setup === 'noDays' ? 'New — pick its days' : t.setup === 'blocked' ? 'No Breezeway property at its places' : ''
  const act = t.setup === 'off' ? 'Resume' : t.setup === 'noPlaces' ? 'Add places' : t.setup === 'noDays' ? 'Pick days' : t.setup === 'blocked' ? 'Fix places' : ''
  const next = t.nextRun ? 'Next run ' + (t.nextRun === today ? 'today' : nice(t.nextRun)) : t.schedule
  const last = report ? 'Last walk ' + nice(report.date) + ' · ' + report.passed + ' pass · ' + report.issues + ' issue' + (report.issues === 1 ? '' : 's') + (report.open ? ' · ' + report.open + ' not done' : '')
    : t.last ? 'Last done ' + nice(t.last.date) + (t.last.place ? ' · ' + t.last.place : '') : t.setup ? '' : 'No finished walk in 45 days'
  return (
    <button onClick={onClick} title={t.name + ' — opens it in Property programs'}
      className={'text-left rounded-2xl border px-3 py-2.5 min-h-[92px] transition flex flex-col gap-1.5 min-w-0 ' + (t.setup ? 'border-dashed border-amber-300 bg-amber-50/40 hover:border-amber-500' : 'border-line bg-white shadow-soft hover:border-ink/30')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted truncate">{t.name}</span>
        <span className="text-[10.5px] text-muted/70 shrink-0" title={t.placeLabels.join(', ')}>{t.places} place{t.places === 1 ? '' : 's'}</span>
      </div>
      {t.setup ? (
        <>
          <span className="text-[13px] font-bold text-amber-900">{setupLine}</span>
          <span className="mt-auto self-start inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg bg-ink text-white text-[12px] font-semibold">{act} <ArrowRight size={12} /></span>
        </>
      ) : planBroken ? (
        <span className="text-[12px] text-amber-800">Today’s count could not be read.</span>
      ) : (
        <>
          <div className="flex items-baseline gap-x-1.5 gap-y-0.5 flex-wrap">
            <span className={'text-[22px] leading-none font-bold tabular-nums ' + (t.late ? 'text-rose-700' : t.open ? 'text-amber-700' : 'text-emerald-700')}>{t.late}</span>
            <span className="text-[11px] text-muted">late</span>
            {dueToday ? <span className="text-[11px] font-semibold ml-1 text-ink">{t.done} of {dueToday} done today</span> : <span className="text-[11px] text-muted ml-1">nothing due today</span>}
            {t.blocked ? <span className="text-[11px] text-rose-700 font-semibold ml-1" title="These places have no Breezeway property, so no task can be created there">{t.blocked} cannot run</span> : null}
          </div>
          <div className="w-full h-1.5 rounded-full bg-line overflow-hidden flex" aria-hidden>
            {dueToday > 0 ? <>
              {t.late ? <span className="block h-full bg-rose-500" style={{ width: (t.late / dueToday) * 100 + '%' }} /> : null}
              {t.open ? <span className="block h-full bg-amber-400" style={{ width: (t.open / dueToday) * 100 + '%' }} /> : null}
              {t.done ? <span className="block h-full bg-emerald-500" style={{ width: (t.done / dueToday) * 100 + '%' }} /> : null}
            </> : null}
          </div>
        </>
      )}
      <div className="text-[11px] text-muted w-full">
        {!t.setup && next ? <span className="block truncate">{next}{t.people ? ' · ' + t.people + ' on it' : ''}</span> : null}
        {last ? <span className={'block truncate ' + (report && report.issues ? 'text-rose-700 font-semibold' : '')}>{last}</span> : null}
      </div>
    </button>
  )
}

/** Every unit against every program — the building's whole clock on one screen. */
function Matrix({ programs, building, market, q }: { programs: UpkeepProgram[]; building: string; market: string; q: string }) {
  const ps = programs.filter(p => !p.inert && p.rows.length)
  const units = useMemo(() => {
    const m = new Map<string, { unit: string; building: string; cells: Record<string, UpkeepRow> }>()
    for (const p of ps) for (const r of p.rows) {
      if (building && r.building !== building) continue
      if (q && !(r.unit + ' ' + r.building).toLowerCase().includes(q.trim().toLowerCase())) continue
      const u = m.get(r.listingId) || { unit: r.unit, building: r.building, cells: {} }
      u.cells[p.key] = r; m.set(r.listingId, u)
    }
    return Array.from(m.values()).sort((a, b) => a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit))
  }, [ps, building, q])
  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="text-[11.5px] border-collapse min-w-full">
        <thead className="sticky top-0 bg-white z-10">
          <tr>
            <th className="text-left px-3 py-1.5 font-semibold text-muted border-b border-line">Unit</th>
            {ps.map(p => <th key={p.key} className="px-1.5 py-1.5 font-semibold text-muted border-b border-line whitespace-nowrap text-center" title={p.label + ' · ' + every(p.everyDays)}>{p.label.replace(' (central A/C)', '').replace('Unit inspection (every 45–60 days)', 'Inspection')}</th>)}
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => (
            <tr key={i} className="border-b border-line/60 hover:bg-app/50">
              <td className="px-3 py-1 whitespace-nowrap"><span className="font-semibold text-ink">{u.unit}</span>{!building ? <span className="text-muted"> · {u.building}</span> : null}{market === 'all' ? null : null}</td>
              {ps.map(p => {
                const r = u.cells[p.key]
                return <td key={p.key} className="px-1.5 py-1 text-center">
                  {r ? <span className={'inline-block w-3.5 h-3.5 rounded-full ' + STATE[r.state].dot} title={p.label + ': ' + STATE[r.state].label + (r.state !== 'none' ? (r.source === 'clock' ? ' · clock started ' + nice(r.clockStarted || null) : ' · last ' + nice(r.lastDone)) + ' · ' + whenWord(r) : '')} /> : <span className="text-faint" title="Not on this unit">·</span>}
                </td>
              })}
            </tr>
          ))}
          {!units.length ? <tr><td colSpan={ps.length + 1} className="px-3 py-4 text-muted">No units match.</td></tr> : null}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted flex items-center gap-3 flex-wrap">{ORDER.map(k => <span key={k} className="inline-flex items-center gap-1"><span className={'w-2.5 h-2.5 rounded-full ' + STATE[k].dot} /> {STATE[k].label}</span>)}</p>
    </div>
  )
}
