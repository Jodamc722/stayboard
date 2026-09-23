'use client'
// SUGGEST A SCHEDULE — the sandbox (Jon, 2026-09-23).
//
// "A scheduler suggester option that shows a mock-up schedule in a pop up, we can move things around
// and approve. Select who is working, or who we want to work. That way it's in a pop up, sandbox type
// environment."
//
// Pick a day. Who is working comes in from Homebase (via /api/capacity) and can be changed with a
// tap. lib/schedule-suggest proposes who takes each departure clean. Drag a card to another person
// (or use the small menu on the card on a phone), add or drop people, re-suggest. NOTHING is written
// until Approve, and Approve pushes only the cleans whose person changed, through the same
// /api/schedule/assign the board uses, so the Breezeway description and cleaner notes come along.
//
// ROUND TWO, same day, after Jon tested tomorrow: clean times come from each unit's own Breezeway
// history where it has one (/api/schedule/clean-times); fewer people with fuller days (up to four
// cleans, up to an hour over); supervisors clean only as a last resort, per the Ops presets roster;
// and the board can be looked at one market at a time.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wand2, X, Loader2, RotateCcw, Check, UserPlus, AlertTriangle } from 'lucide-react'
import { useModal } from '@/components/Modal'
import { matchRoster, personKey } from '@/lib/roster-match'
import { useOpsPresets } from '@/lib/useOpsPresets'
import { suggestSchedule, standardMinutes, loadFor, hubCentres, DEFAULT_CAPACITY_MIN, type SugClean, type SugPerson } from '@/lib/schedule-suggest'

type Person = { id: number; name: string; region: string | null }
type Row = SugClean & { raw: any; minSource: 'unit' | 'standard'; minN: number }
const MARKETS = ['All', 'Miami', 'Broward', 'North'] as const
type MarketTab = typeof MARKETS[number]

function etDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}
const hm = (m: number) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r}m` }
const shortUnit = (u: string) => String(u || '').split(' - ')[0]
const first = (n: string) => String(n || '').split(/\s+/)[0]
function marketFromRegion(r: string | null): string | null {
  const s = String(r || '').toLowerCase()
  if (/miami|17\s*west|arya|elser/.test(s)) return 'Miami'
  if (/broward|lauderdale|hollywood/.test(s)) return 'Broward'
  if (/north|palm|lake\s*worth|capri|lucerne/.test(s)) return 'North'
  return null
}
function descFor(c: any): string {
  return [c.unit, c.rebook ? 'RE-BOOK (same guest)' : '', c.doorCode ? 'Door code: ' + c.doorCode : '', c.guestOut ? 'Guest out: ' + c.guestOut : ''].filter(Boolean).join(' | ')
}

export function ScheduleSuggesterButton() {
  const [open, setOpen] = useState(false)
  const [pushed, setPushed] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-ink text-white text-[12.5px] font-bold">
        <Wand2 size={14} /> Suggest a schedule
      </button>
      {open && typeof document !== 'undefined' ? createPortal(
        <ScheduleSuggester onClose={() => { setOpen(false); if (pushed) window.location.reload() }} onPushed={() => setPushed(true)} />,
        document.body) : null}
    </>
  )
}

export function ScheduleSuggester({ onClose, onPushed }: { onClose: () => void; onPushed?: () => void }) {
  const [date, setDate] = useState(etDate(1))
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [skipped, setSkipped] = useState(0)
  const [roster, setRoster] = useState<Person[]>([])
  const [capBy, setCapBy] = useState<Record<number, number>>({})
  const [working, setWorking] = useState<number[]>([])
  const [keepCurrent, setKeepCurrent] = useState(true)
  const [assign, setAssign] = useState<Record<string, number | null>>({})
  const [why, setWhy] = useState<Record<string, string>>({})
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ pushed: number; failed: number; errors: string[] } | null>(null)
  const [target, setTarget] = useState(4)
  const [overtime, setOvertime] = useState(60)
  const [tab, setTab] = useState<MarketTab>('All')
  const presets = useOpsPresets()
  // Roles by first name, the way the Ops presets roster keeps them ("Yoslenis": "supervisor").
  const roleOf = useCallback((name: string): 'cleaner' | 'supervisor' | 'other' => {
    const nc = presets?.roster?.nonCleaners || {}
    const f = personKey(first(name))
    for (const [k, v] of Object.entries(nc)) if (personKey(k) === f) return /supervis/i.test(String(v)) ? 'supervisor' : 'other'
    return 'cleaner'
  }, [presets])
  const { panelProps } = useModal(onClose, { closeOnEscape: !busy })

  const people: SugPerson[] = useMemo(() => working.map(id => {
    const p = roster.find(r => r.id === id)
    return { id, name: p?.name || String(id), market: marketFromRegion(p?.region || null), capacityMin: capBy[id] || DEFAULT_CAPACITY_MIN, role: roleOf(p?.name || '') }
  }), [working, roster, capBy, roleOf])

  const runSuggest = useCallback((rs: Row[], ps: SugPerson[], keep: boolean, t = target, ot = overtime) => {
    const s = suggestSchedule(rs, ps, { keepCurrent: keep, targetCleans: t, overtimeMin: ot })
    setAssign(s.assign); setWhy(s.why)
  }, [target, overtime])

  // Load the day: cleans + roster from the schedule, who is on from capacity.
  useEffect(() => {
    let dead = false
    setLoading(true); setErr(''); setResult(null)
    ;(async () => {
      try {
        const [sch, cap] = await Promise.all([
          fetch(`/api/schedule?view=day&date=${date}`, { cache: 'no-store' }).then(r => r.json()),
          fetch(`/api/capacity?date=${date}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
        ])
        if (dead) return
        if (!sch?.ok) { setErr(sch?.error || 'Could not load the schedule.'); setLoading(false); return }
        const day = (sch.days || [])[0]
        const all: any[] = day ? Object.values(day.markets || {}).flat() as any[] : []
        // Only cleans our team does, that exist in Breezeway, on this day for real.
        const usable = all.filter(c => !c.movedTo && !c.ghost && !c.vendor && !c.guestyOnly && !c.blocked)
        setSkipped(all.filter(c => !c.movedTo && !c.ghost).length - usable.length)
        // Each unit's own median clean time where it has one; the bedroom standard where it does not.
        const ids = Array.from(new Set(usable.map(c => String(c.listingId))))
        const ct = ids.length ? await fetch(`/api/schedule/clean-times?ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null) : null
        if (dead) return
        const times: Record<string, { minutes: number; n: number }> = ct?.times || {}
        const rs: Row[] = usable.map(c => {
          const t = times[String(c.listingId)]
          return {
            key: `${c.listingId}__${c.date}`, listingId: c.listingId, unit: c.unit, market: c.market, hub: c.hub || 'Other',
            lat: c.lat ?? null, lng: c.lng ?? null, bedrooms: c.bedrooms ?? null, sameDayTurn: !!c.sameDayTurn,
            minutes: t ? t.minutes : standardMinutes(c.bedrooms, c.market), minSource: t ? 'unit' : 'standard', minN: t ? t.n : 0,
            currentIds: Array.isArray(c.assignedIds) ? c.assignedIds : [], raw: c,
          }
        })
        const hk: Person[] = Array.isArray(sch.housekeepers) ? sch.housekeepers : []
        // Who is on: Homebase shifts and anyone already holding a task that day (capacity), matched
        // to Breezeway people by the one strict matcher. Plus anyone already assigned a clean here.
        const caps: Record<number, number> = {}
        const on = new Set<number>()
        for (const p of (cap?.people || [])) {
          const m = matchRoster(hk, String(p.person || ''))
          if (!m.ok) continue
          on.add(m.id)
          if (Number(p.capacityMinutes) > 0) caps[m.id] = Math.round(Number(p.capacityMinutes))
        }
        for (const r of rs) for (const id of r.currentIds) if (hk.some(h => h.id === id)) on.add(id)
        const ws = Array.from(on)
        setRows(rs); setRoster(hk); setCapBy(caps); setWorking(ws)
        const ps = ws.map(id => { const p = hk.find(h => h.id === id); return { id, name: p?.name || '', market: marketFromRegion(p?.region || null), capacityMin: caps[id] || DEFAULT_CAPACITY_MIN, role: roleOf(p?.name || '') } })
        runSuggest(rs, ps, keepCurrent)
        setLoading(false)
      } catch (e: any) { if (!dead) { setErr(String(e?.message || e)); setLoading(false) } }
    })()
    return () => { dead = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const resuggest = (ps = people, keep = keepCurrent, t = target, ot = overtime) => runSuggest(rows, ps, keep, t, ot)
  const toggleWorking = (id: number) => {
    const next = working.includes(id) ? working.filter(x => x !== id) : working.concat(id)
    setWorking(next)
    const ps = next.map(pid => { const p = roster.find(r => r.id === pid); return { id: pid, name: p?.name || '', market: marketFromRegion(p?.region || null), capacityMin: capBy[pid] || DEFAULT_CAPACITY_MIN, role: roleOf(p?.name || '') } })
    // Keep what is on the board now (including hand moves) for everyone still working; only the
    // cleans that lost their person get placed again. "Re-suggest" is the full reshuffle.
    const sandbox = rows.map(r => { const to = assign[r.key]; return { ...r, currentIds: to != null && next.includes(to) ? [to] : [] } })
    const s = suggestSchedule(sandbox, ps, { keepCurrent: true, targetCleans: target, overtimeMin: overtime })
    setAssign(s.assign); setWhy(w => { const o = { ...s.why }; for (const k of Object.keys(o)) if (o[k] === 'already assigned' && w[k]) o[k] = w[k]; return o })
  }
  const move = (key: string, to: number | null) => { setAssign(a => ({ ...a, [key]: to })); setWhy(w => ({ ...w, [key]: 'moved by hand' })) }

  const centres = useMemo(() => hubCentres(rows), [rows])
  const cols = useMemo(() => {
    const byP: Record<string, Row[]> = { none: [] }
    for (const p of people) byP[p.id] = []
    for (const r of rows) { const to = assign[r.key]; (to != null && byP[to] ? byP[to] : byP.none).push(r) }
    for (const k of Object.keys(byP)) byP[k].sort((a, b) => Number(b.sameDayTurn) - Number(a.sameDayTurn) || a.hub.localeCompare(b.hub) || a.unit.localeCompare(b.unit))
    return byP
  }, [rows, people, assign])
  const changed = rows.filter(r => { const to = assign[r.key]; return to != null && !(r.currentIds.length === 1 && r.currentIds[0] === to) })

  const approve = async () => {
    if (!changed.length) return
    setBusy(true); setResult(null)
    let pushed = 0, failed = 0
    const errors: string[] = []
    const items = changed.map(r => ({ listingId: r.listingId, date: r.raw.date, assigneeIds: [assign[r.key] as number], description: descFor(r.raw), taskId: r.raw.breezewayTaskId || null, sameDayTurn: !!r.sameDayTurn }))
    for (let i = 0; i < items.length; i += 40) {
      try {
        const j = await fetch('/api/schedule/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 40) }) }).then(r => r.json())
        if (!j?.ok) { failed += items.slice(i, i + 40).length; errors.push(j?.message || j?.error || 'Push failed.'); continue }
        pushed += Number(j.pushed) || 0; failed += Number(j.failed) || 0
        for (const r of (j.results || [])) if (!r.ok) errors.push(`${shortUnit(rows.find(x => x.listingId === r.listingId)?.unit || r.listingId)}: ${r.error || 'failed'}`)
      } catch (e: any) { failed += items.slice(i, i + 40).length; errors.push(String(e?.message || e)) }
    }
    setBusy(false); setResult({ pushed, failed, errors: errors.slice(0, 6) })
    if (pushed) {
      onPushed?.()
      // What was pushed is now the current assignment, so it stops counting as a change.
      setRows(rs => rs.map(r => changed.some(c => c.key === r.key) && assign[r.key] != null ? { ...r, currentIds: [assign[r.key] as number] } : r))
    }
  }

  // THE MARKET VIEW (Jon: "divvy it up by market"). A person belongs to their Breezeway region, else
  // to the market most of their cleans are in. A person with nothing yet shows under every market
  // they could serve, so they can be dragged work in any of them.
  const personMarket = (p: SugPerson): string | null => {
    if (p.market) return p.market
    const theirs = (cols[p.id] || []).map(r => r.market)
    if (!theirs.length) return null
    const n: Record<string, number> = {}
    for (const m of theirs) n[m] = (n[m] || 0) + 1
    return Object.keys(n).sort((a, b) => n[b] - n[a])[0]
  }
  const inTab = (m: string | null) => tab === 'All' || m == null || m === tab
  const shownPeople = people.filter(p => inTab(personMarket(p)))
  const shownRows = (list: Row[]) => tab === 'All' ? list : list.filter(r => r.market === tab)
  const countBy = (m: MarketTab) => m === 'All' ? rows.length : rows.filter(r => r.market === m).length
  const unassigned = shownRows(cols.none || [])
  const others = roster.filter(r => !working.includes(r.id))

  // Plain render functions, not components: a component defined in here would remount on every
  // render, and a card that remounts mid-drag cancels the drag.
  const card = (r: Row) => {
    const to = assign[r.key]
    const isChange = to != null && !(r.currentIds.length === 1 && r.currentIds[0] === to)
    return (
      <div key={r.key} draggable={!busy} onDragStart={() => setDragKey(r.key)} onDragEnd={() => setDragKey(null)}
        className={'rounded-lg border bg-white px-2 py-1.5 text-[12px] cursor-grab active:cursor-grabbing ' + (isChange ? 'border-brand-400 ring-1 ring-brand-200' : 'border-line')}>
        <div className="flex items-center gap-1">
          <span className="font-bold text-ink truncate flex-1">{shortUnit(r.unit)}</span>
          {r.sameDayTurn ? <span className="text-[9.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1">SAME-DAY</span> : null}
        </div>
        <div className="text-[11px] text-muted flex items-center gap-1 mt-0.5">
          <span title={r.minSource === 'unit' ? `This unit's median over its last ${r.minN} timed cleans` : 'No timing history yet: the bedroom standard'}>
            {r.bedrooms == null ? '?' : r.bedrooms === 0 ? 'Studio' : r.bedrooms + 'BR'} · ~{hm(r.minutes)}{r.minSource === 'unit' ? '' : '*'}
          </span>
          <select value={to == null ? '' : String(to)} disabled={busy} onChange={e => move(r.key, e.target.value ? Number(e.target.value) : null)}
            className="ml-auto text-[10.5px] border border-line rounded px-0.5 py-0 bg-white max-w-[92px]" title="Move to…">
            <option value="">Unassigned</option>
            {people.map(p => <option key={p.id} value={p.id}>{first(p.name)}</option>)}
          </select>
        </div>
        {why[r.key] ? <div className="text-[10px] text-faint mt-0.5">{why[r.key]}</div> : null}
      </div>
    )
  }

  const column = (id: number | null, title: string, list: Row[], cap?: number) => {
    const load = loadFor(list, centres)
    const pct = cap ? Math.round((load.minutes / cap) * 100) : 0
    const tone = !cap ? 'bg-line' : pct > 100 ? 'bg-rose-500' : pct > 85 ? 'bg-amber-500' : 'bg-emerald-500'
    return (
      <div key={id == null ? 'none' : id} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragKey) move(dragKey, id); setDragKey(null) }}
        className={'w-[210px] shrink-0 rounded-xl border p-2 flex flex-col gap-1.5 ' + (id == null ? 'border-amber-300 bg-amber-50/60' : 'border-line bg-app/60') + (dragKey ? ' outline-dashed outline-1 outline-brand-300' : '')}>
        <div>
          <div className="flex items-center gap-1">
            <p className="text-[12.5px] font-bold text-ink truncate flex-1">{title}</p>
            {id != null && roleOf(title) !== 'cleaner' ? <span className="text-[9.5px] font-bold text-violet-800 bg-violet-50 border border-violet-200 rounded px-1">{roleOf(title) === 'supervisor' ? 'SUPERVISOR' : 'NOT A CLEANER'}</span> : null}
            {id != null && !list.length ? <span className="text-[9.5px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-1">NOT NEEDED</span> : null}
            {id != null ? <button onClick={() => toggleWorking(id)} disabled={busy} title="Not working" className="text-faint hover:text-rose-700"><X size={12} /></button> : null}
          </div>
          {id != null ? (
            <>
              <p className="text-[11px] text-muted">{load.cleans} clean{load.cleans === 1 ? '' : 's'} · {hm(load.minutes)} of {hm(cap || 0)}{load.hubs.length > 1 ? ` · ${load.hubs.length} bldgs` : ''}</p>
              <div className="h-1.5 rounded bg-line mt-1 overflow-hidden"><div className={'h-full ' + tone} style={{ width: Math.min(100, pct) + '%' }} /></div>
            </>
          ) : <p className="text-[11px] text-amber-800">{list.length ? 'Drag onto someone, or add a person' : 'Everything is placed'}</p>}
        </div>
        {list.map(r => card(r))}
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]" onClick={busy ? undefined : onClose} />
      <div {...panelProps} aria-label="Suggest a schedule"
        className="fixed z-50 inset-x-0 bottom-0 sm:inset-0 sm:m-auto w-full sm:max-w-[1180px] sm:h-fit sm:max-h-[90vh] max-h-[94vh]
                   rounded-t-2xl sm:rounded-2xl border border-line bg-white shadow-2xl flex flex-col overflow-hidden outline-none">
        <div className="px-4 py-3 border-b border-line flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-ink inline-flex items-center gap-1.5"><Wand2 size={14} className="text-brand-500" /> Suggest a schedule</p>
            <p className="text-[12px] text-muted mt-0.5">A sandbox. Move cleans, change who is working, re-suggest. Nothing reaches Breezeway until you approve.</p>
          </div>
          <input type="date" value={date} disabled={busy} onChange={e => e.target.value && setDate(e.target.value)} className="text-[12.5px] border border-line rounded-lg px-2 h-8" />
          <button onClick={onClose} disabled={busy} className="text-muted hover:text-ink disabled:opacity-40 mt-1"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="p-8 text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Building the day…</div>
        ) : err ? (
          <div className="p-6 text-[13px] text-rose-700">{err}</div>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-line bg-app/60 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-semibold text-ink">Working ({people.length}):</span>
              {people.map(p => (
                <button key={p.id} onClick={() => toggleWorking(p.id)} disabled={busy}
                  className="px-2 py-0.5 rounded-full bg-ink text-white text-[11.5px] inline-flex items-center gap-1">{first(p.name)} <X size={10} /></button>
              ))}
              {others.length ? (
                <label className="inline-flex items-center gap-1 text-muted">
                  <UserPlus size={13} />
                  <select value="" disabled={busy} onChange={e => e.target.value && toggleWorking(Number(e.target.value))} className="text-[11.5px] border border-line rounded px-1 py-0.5 bg-white">
                    <option value="">Add someone…</option>
                    {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
              ) : null}
              <span className="flex-1" />
              <label className="inline-flex items-center gap-1 text-muted cursor-pointer">
                <input type="checkbox" checked={keepCurrent} disabled={busy} onChange={e => { setKeepCurrent(e.target.checked); resuggest(people, e.target.checked) }} />
                Keep current assignments
              </label>
              <button onClick={() => resuggest()} disabled={busy} className="inline-flex items-center gap-1 px-2 h-7 rounded-lg border border-line bg-white font-semibold"><RotateCcw size={12} /> Re-suggest</button>
            </div>

            <div className="px-4 py-2 border-b border-line flex items-center gap-2 flex-wrap text-[12px]">
              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                {MARKETS.map(m => (
                  <button key={m} onClick={() => setTab(m)} className={'px-2.5 h-7 font-semibold ' + (tab === m ? 'bg-ink text-white' : 'bg-white text-muted')}>
                    {m} <span className="opacity-70">{countBy(m)}</span>
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <label className="inline-flex items-center gap-1 text-muted">Up to
                <input type="number" min={1} max={10} value={target} disabled={busy} onChange={e => { const n = Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))); setTarget(n); resuggest(people, keepCurrent, n, overtime) }}
                  className="w-[44px] border border-line rounded px-1 py-0.5 text-ink font-semibold" /> cleans each, up to
                <input type="number" min={0} max={180} step={15} value={overtime} disabled={busy} onChange={e => { const n = Math.max(0, Math.min(180, Math.round(Number(e.target.value) || 0))); setOvertime(n); resuggest(people, keepCurrent, target, n) }}
                  className="w-[52px] border border-line rounded px-1 py-0.5 text-ink font-semibold" /> min over the shift
              </label>
            </div>

            <div className="px-4 py-1.5 text-[11.5px] text-muted border-b border-line">
              {rows.length} departure clean{rows.length === 1 ? '' : 's'} on {date}
              {rows.filter(r => r.sameDayTurn).length ? ` · ${rows.filter(r => r.sameDayTurn).length} same-day` : ''}
              {skipped ? ` · ${skipped} left out (vendor-cleaned, blocked, or not in Breezeway)` : ''}
              {unassigned.length ? <span className="text-amber-800 font-semibold"> · {unassigned.length} unassigned</span> : null}
              {people.filter(p => !(cols[p.id] || []).length).length ? ` · ${people.filter(p => !(cols[p.id] || []).length).length} not needed` : ''}
              {' · '}* no timing history yet, bedroom standard used
            </div>

            <div className="flex-1 overflow-auto p-3">
              {rows.length === 0 ? <p className="text-[13px] text-muted p-4">No departure cleans for our team on this day.</p> : (
                <div className="flex gap-2 items-start min-w-fit">
                  {unassigned.length ? column(null, `Unassigned (${unassigned.length})`, unassigned) : null}
                  {shownPeople.map(p => column(p.id, p.name, shownRows(cols[p.id] || []), p.capacityMin))}
                </div>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-line flex items-center gap-2 flex-wrap">
              {result ? (
                <p className={'text-[12px] font-semibold ' + (result.failed ? 'text-amber-800' : 'text-emerald-700')}>
                  {result.failed ? <AlertTriangle size={13} className="inline -mt-0.5 mr-1" /> : <Check size={13} className="inline -mt-0.5 mr-1" />}
                  Pushed {result.pushed} to Breezeway{result.failed ? `, ${result.failed} failed: ${result.errors.join('; ')}` : '.'}
                </p>
              ) : <p className="text-[12px] text-muted">{changed.length ? `${changed.length} change${changed.length === 1 ? '' : 's'} from what Breezeway has now.` : 'Matches what Breezeway has now.'} Moving a clean to Unassigned does not remove anyone.</p>}
              <span className="flex-1" />
              <button onClick={onClose} disabled={busy} className="text-[12.5px] font-semibold px-3 h-9 rounded-xl border border-line">Close</button>
              <button onClick={approve} disabled={busy || !changed.length}
                className="text-[12.5px] font-bold px-3 h-9 rounded-xl bg-ink text-white disabled:bg-line disabled:text-faint inline-flex items-center gap-1.5">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve & push {changed.length || ''}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
