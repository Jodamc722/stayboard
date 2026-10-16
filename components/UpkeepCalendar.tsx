'use client'
// UPKEEP CALENDAR — book upkeep by availability (Jon, 2026-10-16: "quickly assign, multi calendar view
// to see open days, assign by day of availability … clean, and the multi needs to be accurate"; then:
// "click into the unit date, see what's pending and assign each one, add notes … more robust").
//
// GRID: one row per unit, one column per day. A cell is what the unit is that day — open, guest
// leaving (workable after checkout), guest arriving (workable in the morning), a hold, a turn, a stay,
// or an owner block with its Guesty label — from the stays and Guesty's own calendar
// (/api/upkeep/calendar). On top: who of the trade is already in that building that day (filled
// initial = in this very unit), the due date (red underline), the suggested day (blue box).
// In "All programs" mode a row is a unit with everything it owes, and the count sits in the name.
//
// CLICK ANY CELL → the unit-day panel: who is leaving/arriving, what is already booked for the unit,
// who is in the building, and EVERY pending upkeep item for that unit (all programs). Each item gets
// its own person, date and note; tick what to book and it is filed in Breezeway, one task each,
// with the unit info and the billing line on it. The unit info (filter size…) is edited right there.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Check, ExternalLink, AlertTriangle } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { Sheet } from '@/components/Sheet'
import type { UpkeepRow, UpkeepProgram } from '@/app/api/upkeep/route'
import type { UpkeepCalendar as CalData, CalCell, CalKind } from '@/app/api/upkeep/calendar/route'
import { bestDay, fitsDay, pickFor, tradeFits } from '@/lib/upkeep-schedule'
import type { UnitDay } from '@/app/api/upkeep/unit-day/route'

const dow = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })
const dnum = (d: string) => Number(d.slice(8, 10))
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const short = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || n
const initials = (n: string) => String(n || '').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase()
const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const when = (r: UpkeepRow) => r.daysOver > 0 ? `${r.daysOver}d late` : r.daysOver === 0 ? 'due today' : `due ${short(r.dueOn)}`

const KIND: Record<CalKind, { label: string; cls: string; workable: boolean; hint: string }> = {
  open:  { label: 'Open',        cls: 'bg-emerald-100',                                               workable: true,  hint: 'Empty all day' },
  out:   { label: 'Checkout',    cls: 'bg-[linear-gradient(90deg,#cbd5e1_0_40%,#d1fae5_40%)]',       workable: true,  hint: 'Guest leaves ~11am — workable after' },
  in:    { label: 'Check-in',    cls: 'bg-[linear-gradient(90deg,#d1fae5_0_60%,#cbd5e1_60%)]',       workable: true,  hint: 'Guest arrives ~4pm — workable in the morning' },
  hold:  { label: 'Hold',        cls: 'bg-[repeating-linear-gradient(135deg,#d1fae5_0_4px,#ecfdf5_4px_8px)]', workable: true, hint: 'Blocked in Guesty but nobody staying — workable' },
  turn:  { label: 'Turn',        cls: 'bg-amber-200',                                                 workable: false, hint: 'Guest out and guest in the same day — housekeeping owns it' },
  stay:  { label: 'Guest in',    cls: 'bg-slate-300',                                                 workable: false, hint: 'A guest is in the unit all day' },
  block: { label: 'Owner / block', cls: 'bg-[repeating-linear-gradient(135deg,#cbd5e1_0_4px,#e2e8f0_4px_8px)]', workable: false, hint: 'Owner or someone staying (Guesty block)' },
}
const RANK: Record<string, number> = { late: 0, soon: 1, none: 2, ok: 3, booked: 4 }

type Item = { row: UpkeepRow; prog: UpkeepProgram }
type CalRow = { key: string; listingId: string; unit: string; worst: UpkeepRow['state']; daysOver: number; dueOn: string; planDate: string | null; items: Item[] }

export function UpkeepCalendar({ programs, prog, rows, building, q, canEdit, canApprove, info, onBooked }: {
  programs: UpkeepProgram[]
  /** null = every program at once. */
  prog: UpkeepProgram | null
  /** The program's filtered rows (program mode). */
  rows: UpkeepRow[]
  building: string; q: string
  canEdit: boolean; canApprove: string[]
  info: Record<string, any>
  onBooked: (rowId: string, msg: string, taskId: string) => void
}) {
  const [span, setSpan] = useState<14 | 21>(14)
  const [panel, setPanel] = useState<{ row: CalRow; date: string } | null>(null)
  const [booked, setBooked] = useState<Record<string, string>>({})   // upkeep row id → "Tue Oct 21 · Carlos"
  const [infoLocal, setInfoLocal] = useState<Record<string, any>>({})

  // Every pending item per unit, all programs — the panel always shows the whole unit.
  const pendingByUnit = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const p of programs) for (const r of p.rows) {
      if (r.task || booked[r.id]) continue
      const soonEnough = r.state === 'late' || r.state === 'soon' || r.state === 'none' || (r.state === 'ok' && r.daysOver >= -45)
      if (!soonEnough) continue
      ;(m.get(r.listingId) || m.set(r.listingId, []).get(r.listingId)!).push({ row: r, prog: p })
    }
    for (const list of Array.from(m.values())) list.sort((a, b) => RANK[a.row.state] - RANK[b.row.state] || b.row.daysOver - a.row.daysOver)
    return m
  }, [programs, booked])

  const calRows: CalRow[] = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const keep = (r: UpkeepRow) => (!building || r.building === building) && (!needle || (r.unit + ' ' + r.building).toLowerCase().includes(needle))
    if (prog) {
      return rows.filter(r => !r.task && !booked[r.id] && r.state !== 'ok').filter(keep).slice(0, 150)
        .map(r => ({ key: r.id, listingId: r.listingId, unit: r.unit, worst: r.state, daysOver: r.daysOver, dueOn: r.dueOn, planDate: r.plan?.date || null, items: [{ row: r, prog }] }))
    }
    const out: CalRow[] = []
    for (const [lid, items] of Array.from(pendingByUnit.entries())) {
      const urgent = items.filter(i => i.row.state !== 'ok')
      if (!urgent.length || !keep(urgent[0].row)) continue
      const w = urgent[0].row
      const plan = urgent.map(i => i.row.plan?.date).filter(Boolean).sort()[0] || null
      out.push({ key: lid, listingId: lid, unit: w.unit, worst: w.state, daysOver: Math.max(...urgent.map(i => i.row.daysOver)), dueOn: urgent.map(i => i.row.dueOn).sort()[0], planDate: plan, items: urgent })
    }
    return out.sort((a, b) => RANK[a.worst] - RANK[b.worst] || b.items.length - a.items.length || b.daysOver - a.daysOver).slice(0, 150)
  }, [prog, rows, building, q, pendingByUnit, booked])

  const ids = Array.from(new Set(calRows.map(r => r.listingId)))
  const key = ids.length ? `/api/upkeep/calendar?dept=${encodeURIComponent(prog?.dept || 'any')}&days=${span}&ids=${ids.join(',')}` : null
  const { data, loading, error } = useCachedFetch<CalData & { error?: string }>(key, { ttl: 5 * 60_000, persist: false })
  const byUnit = useMemo(() => new Map((data?.units || []).map(u => [u.listingId, u])), [data])

  if (!calRows.length) return <p className="px-3 py-4 text-[12.5px] text-muted">Nothing to book here — everything in this view is on track or already booked.</p>
  if (loading && !data) return <p className="px-3 py-6 text-[12.5px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading stays, Guesty blocks and the team's schedule…</p>
  if (error || data?.error) return <p className="px-3 py-4 text-[12.5px] text-rose-700">Could not read the calendar — {String(data?.error || error)}</p>
  if (!data) return null
  const days = data.days

  return (
    <div>
      <div className="px-3 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap border-b border-line text-[11px] text-muted">
        {(['open', 'out', 'in', 'hold', 'turn', 'stay', 'block'] as CalKind[]).map(k => (
          <span key={k} className="inline-flex items-center gap-1" title={KIND[k].hint}><span className={'w-3.5 h-3.5 rounded-sm border border-line ' + KIND[k].cls} />{KIND[k].label}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-sky-600 text-white text-[8px] font-bold grid place-items-center">AB</span>in this unit</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full ring-1 ring-sky-600 text-sky-700 text-[8px] font-bold grid place-items-center">AB</span>in the building</span>
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-0.5 bg-rose-500" />due</span>
        <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-sm ring-2 ring-sky-500" />suggested</span>
        <span className="ml-auto inline-flex rounded-md border border-line overflow-hidden">
          {[14, 21].map(n => <button key={n} onClick={() => setSpan(n as 14 | 21)} aria-pressed={span === n} className={'px-2 h-6 font-semibold ' + (span === n ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>{n} days</button>)}
        </span>
      </div>
      <p className="px-3 py-1 text-[11px] text-muted border-b border-line">Click any day on a unit to see everything it owes, who is around, and book each job with its own person, date and note.</p>
      {data.unsure.length ? <p className="px-3 py-1.5 text-[11.5px] text-amber-800 bg-amber-50 border-b border-amber-200">Partial read: {data.unsure.join(' · ')}.</p> : null}

      <div className="overflow-x-auto max-h-[64vh] overflow-y-auto">
        <table className="w-full border-separate border-spacing-0 text-[11px] table-fixed">
          <thead className="sticky top-0 z-20 bg-white">
            <tr>
              <th className="sticky left-0 z-30 bg-white text-left font-semibold text-muted px-3 py-1.5 border-b border-line w-[14rem]">Unit</th>
              {days.map(d => (
                <th key={d} className={'px-0 py-1 border-b border-line min-w-[2.25rem] text-center font-semibold ' + (d === data.today ? 'text-ink' : 'text-muted') + (/^S/.test(dow(d)) ? ' bg-app/60' : '')}>
                  <div className="text-[9.5px] leading-none">{dow(d)}</div>
                  <div className={'text-[11px] leading-tight ' + (d === data.today ? 'inline-block px-1 rounded bg-ink text-white' : '')}>{dnum(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calRows.map(r => {
              const u = byUnit.get(r.listingId)
              const isOpen = panel?.row.key === r.key
              // The smart day (checkout first, unit empty for every night the job needs) — the earliest across what the row owes.
              const bestD = u ? r.items.map(i => bestDay(u.cells, { today: data.today, dueOn: i.row.dueOn, late: i.row.state === 'late', dept: i.prog.dept, needsVacant: !!i.prog.needsVacant, needsDays: i.prog.needsDays || 1 })?.date).filter(Boolean).sort()[0] || null : null
              const doneHere = r.items.filter(i => booked[i.row.id]).length
              return (
                <tr key={r.key} className={isOpen ? 'bg-sky-50/60' : ''}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-1 border-b border-line">
                    <div className="flex items-center gap-1.5">
                      <span className={'w-2 h-2 rounded-full shrink-0 ' + (r.worst === 'late' ? 'bg-rose-500' : r.worst === 'soon' ? 'bg-amber-400' : 'bg-slate-300')} />
                      <span className="font-semibold text-ink truncate max-w-[9.5rem]" title={r.unit}>{r.unit}</span>
                      {!prog ? <span className="text-[10px] font-bold px-1 rounded bg-slate-100 text-slate-700" title={r.items.map(i => i.prog.label).join(', ')}>{r.items.length}</span> : null}
                    </div>
                    <div className={'pl-3.5 text-[10.5px] truncate ' + (r.worst === 'late' ? 'text-rose-700' : 'text-muted')}>
                      {doneHere ? <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5"><Check size={10} /> {doneHere} booked</span>
                        : prog ? when(r.items[0].row) : r.items.slice(0, 3).map(i => i.prog.label.replace(/ \(.*\)$/, '')).join(' · ')}
                    </div>
                  </td>
                  {days.map(d => {
                    const c = u?.cells.find(x => x.d === d)
                    if (!c) return <td key={d} className="border-b border-l border-white bg-white" />
                    const K = KIND[c.k]
                    const due = r.dueOn === d || (r.daysOver > 0 && d === data.today)
                    const sug = (bestD || r.planDate) === d && K.workable
                    const sel = isOpen && panel?.date === d
                    const lead = c.team[0]
                    const title = `${r.unit} · ${nice(d)} — ${c.label || K.hint}` + (c.team.length ? '\n' + c.team.map(t => `${t.name}${t.atUnit ? ' (in this unit)' : ''} · ${t.trade} · ${t.jobs} job${t.jobs === 1 ? '' : 's'}`).join('\n') : '\nNobody in the building') + '\nClick to open the day'
                    return (
                      <td key={d} className="p-0 border-b border-l border-white">
                        <button onClick={() => setPanel({ row: r, date: d })} title={title}
                          className={'relative w-full h-9 grid place-items-center hover:brightness-95 ' + K.cls + (sug ? ' ring-2 ring-inset ring-sky-500' : '') + (sel ? ' outline outline-2 outline-ink -outline-offset-2' : '')}>
                          {lead ? <span className={'w-5 h-5 rounded-full text-[8.5px] font-bold grid place-items-center ' + (lead.atUnit ? 'bg-sky-600 text-white' : 'ring-1 ring-sky-600 text-sky-700 bg-white/80')}>{initials(lead.name)}</span> : null}
                          {c.team.length > 1 ? <span className="absolute top-0 right-0.5 text-[8px] font-bold text-sky-700">+{c.team.length - 1}</span> : null}
                          {due ? <span className="absolute bottom-0 left-1 right-1 h-0.5 bg-rose-500" /> : null}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {panel ? (
        <DayPanel
          key={panel.row.listingId + panel.date}
          unit={panel.row.unit} listingId={panel.row.listingId} date={panel.date} today={data.today}
          cells={byUnit.get(panel.row.listingId)?.cells || []}
          people={data.people}
          items={pendingByUnit.get(panel.row.listingId) || []}
          focus={new Set(panel.row.items.map(i => i.row.id))}
          canEdit={canEdit} canApprove={canApprove}
          info={panel.row.listingId in infoLocal ? infoLocal[panel.row.listingId] : info[panel.row.listingId] || null}
          onInfo={v => setInfoLocal(m => ({ ...m, [panel.row.listingId]: v }))}
          onBooked={(rowId, msg, taskId) => { setBooked(b => ({ ...b, [rowId]: msg })); onBooked(rowId, msg, taskId) }}
          onDate={d => setPanel(p => p ? { ...p, date: d } : p)}
          onClose={() => { setPanel(null); if (key) invalidateCache(key) }}
        />
      ) : null}
    </div>
  )
}

// ── the unit-day panel ─────────────────────────────────────────────────────────────────────────────
type Line = { on: boolean; who: string; date: string; note: string; block: boolean; state?: 'busy' | 'done' | 'err'; msg?: string; taskId?: string }

function DayPanel({ unit, listingId, date, today, cells, people, items, focus, canEdit, canApprove, info, onInfo, onBooked, onDate, onClose }: {
  unit: string; listingId: string; date: string; today: string
  cells: CalCell[]; people: CalData['people']
  items: Item[]; focus: Set<string>
  canEdit: boolean; canApprove: string[]
  info: any; onInfo: (v: any) => void
  onBooked: (rowId: string, msg: string, taskId: string) => void
  onDate: (d: string) => void
  onClose: () => void
}) {
  const cellOf = (d: string) => cells.find(c => c.d === d) || null
  const cell = cellOf(date)
  const K = cell ? KIND[cell.k] : null
  const { data: ud, loading: udLoading } = useCachedFetch<UnitDay & { error?: string }>(`/api/upkeep/unit-day?listingId=${encodeURIComponent(listingId)}&date=${date}`, { ttl: 60_000, persist: false })
  const canBookItem = (it: Item) => canEdit && (!it.prog.needsApproval || canApprove.includes(it.prog.key))

  // Who to suggest for an item on a day: the right trade already in the unit, then in the building.
  const suggest = (it: Item, d: string): string => {
    const team = cellOf(d)?.team || []
    const want = it.prog.dept
    const ok = (t: { trade: string }) => want === 'housekeeping' ? t.trade === 'housekeeping' : want === 'inspection' ? t.trade !== 'housekeeping' : t.trade === 'maintenance' || t.trade === 'inspection'
    const pick = team.filter(ok).sort((a, b) => Number(b.atUnit) - Number(a.atUnit))[0]
    if (pick) return pick.name
    if (it.row.plan && it.row.plan.date === d && people.some(p => p.name === it.row.plan!.person && tradeFits(want, p.trade))) return it.row.plan.person
    return ''
  }
  const idxOf = (d: string) => cells.findIndex(c => c.d === d)
  const optsOf = (it: Item) => ({ dept: it.prog.dept, needsVacant: !!it.prog.needsVacant, needsDays: it.prog.needsDays || 1 })
  const fitsHere = (it: Item, d: string) => { const i = idxOf(d); return i >= 0 && fitsDay(cells, i, !!it.prog.needsVacant, it.prog.needsDays || 1) }
  const best = (it: Item) => bestDay(cells, { today, dueOn: it.row.dueOn, late: it.row.state === 'late', ...optsOf(it) })
  const [lines, setLines] = useState<Record<string, Line>>(() => {
    const o: Record<string, Line> = {}
    for (const it of items) {
      // The clicked day when the job fits it; else the smart day (checkout first, unit empty for every night it needs).
      const d = fitsHere(it, date) ? date : (best(it)?.date || date)
      o[it.row.id] = { on: canBookItem(it) && (focus.has(it.row.id) || it.row.state === 'late' || it.row.state === 'soon') && fitsHere(it, d), who: suggest(it, d), date: d, note: '', block: true }
    }
    return o
  })
  // When the coordinator moves the panel's day, unbooked lines follow it (and re-suggest a person).
  // (Not on first open — the initial lines already chose the clicked day or each job's smart day.)
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setLines(ls => { const o = { ...ls }; for (const it of items) { const l = o[it.row.id]; if (l && l.state !== 'done') { const d = fitsHere(it, date) ? date : l.date; o[it.row.id] = { ...l, date: d, who: suggest(it, d) || l.who } } } return o })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])
  const set = (id: string, patch: Partial<Line>) => setLines(ls => ({ ...ls, [id]: { ...ls[id], ...patch } }))

  const chosen = items.filter(it => lines[it.row.id]?.on && lines[it.row.id]?.state !== 'done' && canBookItem(it))
  const [running, setRunning] = useState(false)
  const bookAll = async () => {
    if (running || !chosen.length) return
    setRunning(true)
    for (const it of chosen) {
      const l = lines[it.row.id]
      set(it.row.id, { state: 'busy', msg: '' })
      try {
        const i = idxOf(l.date)
        const wantBlock = !!it.prog.needsVacant && l.block && i >= 0 && pickFor(cells, i, optsOf(it)).recommendBlock
        const res = await fetch('/api/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'approve', listingId, cadenceKey: it.prog.key, dueOn: it.row.dueOn, date: l.date, assignee: l.who, note: l.note.trim() || undefined, block: wantBlock || undefined }) })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) throw new Error(j?.error || 'Breezeway would not take it')
        const msg = nice(j.date) + (l.who ? ' · ' + first(l.who) : ' · unassigned') + (j.blocked ? ` · blocked in Guesty ${short(j.blocked.from)}${j.blocked.to !== j.blocked.from ? '–' + short(j.blocked.to) : ''}` : '') + (j.blockError ? ` · NOT blocked: ${j.blockError}` : '')
        set(it.row.id, { state: 'done', msg, taskId: String(j.taskId || '') })
        onBooked(it.row.id, 'booked ' + msg, String(j.taskId || ''))
      } catch (e: any) { set(it.row.id, { state: 'err', msg: String(e?.message || e) }) }
    }
    setRunning(false)
  }

  // Unit info, edited in place.
  const [inf, setInf] = useState({ filterSize: info?.filterSize || '', filterQty: info?.filterQty ? String(info.filterQty) : '', filterLocation: info?.filterLocation || '', notes: info?.notes || '' })
  const [infBusy, setInfBusy] = useState(false)
  const [infMsg, setInfMsg] = useState('')
  const saveInfo = async () => {
    if (infBusy || !items[0]) return
    setInfBusy(true); setInfMsg('')
    try {
      const res = await fetch('/api/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'info', listingId, cadenceKey: items[0].prog.key, ...inf, filterQty: Number(inf.filterQty) || null }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'could not save')
      onInfo(j.info || null); setInfMsg('Saved — printed on every upkeep task for this unit')
    } catch (e: any) { setInfMsg(String(e?.message || e)) } finally { setInfBusy(false) }
  }

  const team = cell?.team || []
  const nextDays = cells.filter(c => c.d >= today).slice(0, 21)
  const relWord: Record<string, string> = { leaving: 'leaves today', arriving: 'arrives today', 'in-house': 'in-house', next: 'next stay', previous: 'last stay' }

  return (
    <Sheet open onClose={onClose} wide title={`${unit} · ${nice(date)}`} subtitle={<span className="inline-flex items-center gap-1.5">{K ? <><span className={'w-3 h-3 rounded-sm border border-line ' + K.cls} />{cell?.label || K.hint}</> : 'Outside the calendar window'}</span>}
      footer={
        <div className="flex items-center gap-2 w-full">
          <span className="text-[12px] text-muted">{chosen.length ? `${chosen.length} to book` : 'Tick the jobs to book'}</span>
          <button onClick={onClose} className="ml-auto h-9 px-3 rounded-lg border border-line bg-white text-[13px] font-semibold text-muted hover:text-ink">Close</button>
          <button onClick={bookAll} disabled={!chosen.length || running} className="h-9 px-4 rounded-lg bg-ink text-white text-[13px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">{running ? <Loader2 size={13} className="animate-spin" /> : null}Book {chosen.length || ''} in Breezeway</button>
        </div>
      }>
      <div className="space-y-4">
        {/* the day strip: move the day without leaving the panel */}
        <div className="flex gap-0.5 overflow-x-auto pb-1">
          {nextDays.map(c => (
            <button key={c.d} onClick={() => onDate(c.d)} title={(c.label || KIND[c.k].hint) + (c.team.length ? ' · ' + c.team.map(t => first(t.name)).join(', ') : '')}
              className={'shrink-0 w-10 rounded-md border text-center py-0.5 ' + KIND[c.k].cls + (c.d === date ? ' border-ink border-2' : ' border-line')}>
              <div className="text-[9px] text-muted leading-none">{dow(c.d)}</div>
              <div className="text-[11.5px] font-semibold text-ink leading-tight">{dnum(c.d)}</div>
              <div className="h-3 text-[8px] font-bold text-sky-700">{c.team.length ? initials(c.team[0].name) + (c.team.length > 1 ? '+' : '') : ''}</div>
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Guests</h4>
            {udLoading && !ud ? <p className="text-[12px] text-muted">Reading…</p> : (ud?.stays || []).length === 0 ? <p className="text-[12px] text-muted">No stays around this day.</p> : (
              <ul className="space-y-0.5">{ud!.stays.map((s, i) => (
                <li key={i} className={'text-[12px] ' + (s.relation === 'leaving' || s.relation === 'arriving' || s.relation === 'in-house' ? 'text-ink' : 'text-muted')}>
                  <span className="font-semibold">{relWord[s.relation]}</span> · {s.guest} · {short(s.checkIn)} → {short(s.checkOut)}{s.nights ? ` (${s.nights}n)` : ''}{s.source ? ` · ${s.source}` : ''}
                </li>))}</ul>
            )}
          </section>
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">In the building that day</h4>
            {team.length === 0 ? <p className="text-[12px] text-muted">Nobody has work in this building that day.</p> : (
              <div className="flex flex-wrap gap-1">{team.map(t => <span key={t.name} className={'text-[11.5px] px-1.5 py-0.5 rounded-md border ' + (t.atUnit ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-line bg-white text-ink')}>{t.name} · {t.trade || '—'} · {t.jobs}{t.atUnit ? ' · in this unit' : ''}</span>)}</div>
            )}
          </section>
        </div>

        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Already on the books for this unit</h4>
          {udLoading && !ud ? <p className="text-[12px] text-muted">Reading…</p> : (ud?.tasks || []).length === 0 ? <p className="text-[12px] text-muted">No open tasks from a week ago to three weeks out.</p> : (
            <ul className="divide-y divide-line border border-line rounded-lg">{ud!.tasks.map(t => (
              <li key={t.id} className={'px-2.5 py-1.5 flex items-center gap-2 text-[12px] ' + (t.date === date ? 'bg-sky-50/60' : '')}>
                <span className="tabular-nums text-muted w-14 shrink-0">{short(t.date)}</span>
                <span className="text-ink truncate">{t.name}</span>
                <span className="text-muted text-[11px] shrink-0">{t.dept}{t.assignees.length ? ' · ' + t.assignees.map(first).join(', ') : ' · unassigned'}</span>
                <a href={bzTask(t.id)} target="_blank" rel="noreferrer" className="ml-auto text-sky-700 shrink-0"><ExternalLink size={12} /></a>
              </li>))}</ul>
          )}
        </section>

        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Upkeep this unit owes ({items.length})</h4>
          {items.length === 0 ? <p className="text-[12px] text-muted">Nothing pending on this unit.</p> : (
            <ul className="space-y-1.5">{items.map(it => {
              const l = lines[it.row.id] || { on: false, who: '', date, note: '' }
              const can = canBookItem(it)
              const lc = cellOf(l.date)
              const li = idxOf(l.date)
              const fits = fitsHere(it, l.date)
              const bad = !!lc && !fits
              const b = best(it)
              const here = li >= 0 ? pickFor(cells, li, optsOf(it)) : null
              // Right trade first, in the building before elsewhere; the wrong trade last but never hidden.
              const fitT = (tr: string) => tradeFits(it.prog.dept, tr) ? 0 : 1
              const options = [
                ...(lc?.team || []).slice().sort((x, y) => fitT(x.trade) - fitT(y.trade) || Number(y.atUnit) - Number(x.atUnit)).map(t => ({ name: t.name, sub: `${t.atUnit ? 'in this unit' : 'in the building'} · ${t.trade} · ${t.jobs} job${t.jobs === 1 ? '' : 's'}` })),
                ...people.filter(p => !(lc?.team || []).some(t => t.name.toLowerCase() === p.name.toLowerCase())).sort((x, y) => fitT(x.trade) - fitT(y.trade) || x.name.localeCompare(y.name)).map(p => ({ name: p.name, sub: `${p.trade} · ${p.perDay[l.date] ? p.perDay[l.date] + ' jobs elsewhere' : 'nothing that day'}` })),
              ]
              if (l.who && !options.some(o => o.name === l.who)) options.unshift({ name: l.who, sub: 'suggested' })
              return (
                <li key={it.row.id} className={'rounded-lg border px-2.5 py-2 ' + (l.state === 'done' ? 'border-emerald-300 bg-emerald-50/60' : l.on ? 'border-ink/30 bg-white' : 'border-line bg-white')}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {l.state === 'done' ? <Check size={14} className="text-emerald-700" /> : <input type="checkbox" checked={l.on} disabled={!can || running} onChange={e => set(it.row.id, { on: e.target.checked })} className="w-4 h-4" />}
                    <span className="text-[13px] font-semibold text-ink">{it.prog.label}</span>
                    <span className={'text-[11px] font-semibold px-1.5 rounded ' + (it.row.state === 'late' ? 'bg-rose-100 text-rose-800' : it.row.state === 'soon' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700')}>{when(it.row)}</span>
                    <span className="text-[11px] text-muted">{it.prog.dept} · ~{it.row.minutes} min</span>
                    {it.row.bill ? <span className="text-[11px] text-amber-800" title={it.row.bill}>billable</span> : null}
                    {!can ? <span className="text-[11px] text-muted">{it.prog.needsApproval ? 'needs an approver' : 'view only'}</span> : null}
                    {l.state === 'done' ? <span className="ml-auto text-[12px] text-emerald-800 font-semibold inline-flex items-center gap-1">Booked {l.msg}{l.taskId ? <a href={bzTask(l.taskId)} target="_blank" rel="noreferrer" className="text-sky-700"><ExternalLink size={12} /></a> : null}</span> : null}
                  </div>
                  {l.state !== 'done' && can ? (
                    <div className="mt-1.5 pl-6 grid gap-1.5 sm:grid-cols-[1fr_9.5rem] items-start">
                      <select value={l.who} onChange={e => set(it.row.id, { who: e.target.value, on: true })} disabled={running} className="h-8 rounded-md border border-line bg-white px-1.5 text-[12px]">
                        <option value="">Unassigned</option>
                        {options.map(o => <option key={o.name} value={o.name}>{o.name} — {o.sub}</option>)}
                      </select>
                      <input type="date" value={l.date} min={today} onChange={e => set(it.row.id, { date: e.target.value, on: true })} disabled={running} className="h-8 rounded-md border border-line px-1.5 text-[12px]" />
                      <input value={l.note} onChange={e => set(it.row.id, { note: e.target.value })} disabled={running} placeholder="Note on the task (optional) — e.g. ask the front desk for the key" className="h-8 rounded-md border border-line px-2 text-[12px] sm:col-span-2" />
                      <div className="sm:col-span-2 flex items-center gap-2 flex-wrap text-[11.5px]">
                        {b ? (b.date === l.date
                          ? <span className="text-emerald-800 inline-flex items-center gap-1"><Check size={12} /> Best day · {b.why}</span>
                          : <span className="text-sky-800">Best day: {b.why} <button onClick={() => set(it.row.id, { date: b.date, who: b.who || l.who, on: true })} className="ml-1 font-semibold underline">Use it</button></span>)
                          : <span className="text-muted">No day in the next 3 weeks fits{it.prog.needsVacant ? ` (needs the unit empty ${it.prog.needsDays || 1} night${(it.prog.needsDays || 1) === 1 ? '' : 's'})` : ''}.</span>}
                      </div>
                      {bad ? <p className="sm:col-span-2 text-[11.5px] text-amber-800 inline-flex items-center gap-1"><AlertTriangle size={12} /> {it.prog.needsVacant ? `Needs the unit empty ${it.prog.needsDays || 1} night${(it.prog.needsDays || 1) === 1 ? '' : 's'} from ${nice(l.date)} — ${KIND[lc!.k].hint.toLowerCase()} or a guest arrives inside that window.` : `${KIND[lc!.k].hint} on ${nice(l.date)}.`} Pick another day unless it can be done around the guest.</p> : null}
                      {it.prog.needsVacant && fits && here?.recommendBlock ? (
                        <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-[11.5px] text-ink">
                          <input type="checkbox" checked={l.block} onChange={e => set(it.row.id, { block: e.target.checked })} disabled={running} />
                          Block {here.nights.length === 1 ? `the night of ${short(here.nights[0])}` : `${short(here.nights[0])}–${short(here.nights[here.nights.length - 1])}`} in Guesty (Maintenance) — no arrival is booked, so it can't be sold over the work
                        </label>
                      ) : it.prog.needsVacant && fits && lc?.k === 'hold' ? <p className="sm:col-span-2 text-[11.5px] text-muted">Already held in Guesty that night.</p> : null}
                      {l.state === 'err' ? <p className="sm:col-span-2 text-[11.5px] text-rose-700">{l.msg}</p> : null}
                      {it.row.bill ? <p className="sm:col-span-2 text-[11px] text-amber-800">{it.row.bill}</p> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}</ul>
          )}
        </section>

        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">Unit info — printed on every upkeep task</h4>
          {canEdit ? (
            <div className="grid gap-1.5 sm:grid-cols-[9rem_4rem_1fr]">
              <input value={inf.filterSize} onChange={e => setInf({ ...inf, filterSize: e.target.value })} placeholder="Filter size (20x25x1)" className="h-8 rounded-md border border-line px-2 text-[12px]" />
              <input value={inf.filterQty} onChange={e => setInf({ ...inf, filterQty: e.target.value.replace(/[^0-9]/g, '') })} placeholder="Qty" className="h-8 rounded-md border border-line px-2 text-[12px]" />
              <input value={inf.filterLocation} onChange={e => setInf({ ...inf, filterLocation: e.target.value })} placeholder="Where (hall ceiling, closet…)" className="h-8 rounded-md border border-line px-2 text-[12px]" />
              <input value={inf.notes} onChange={e => setInf({ ...inf, notes: e.target.value })} placeholder="Notes for whoever goes (ladder, breaker #, access…)" className="h-8 rounded-md border border-line px-2 text-[12px] sm:col-span-3" />
              <div className="sm:col-span-3 flex items-center gap-2">
                <button onClick={saveInfo} disabled={infBusy} className="h-8 px-3 rounded-md border border-line bg-white text-[12px] font-semibold text-ink hover:border-ink/40 disabled:opacity-50">{infBusy ? 'Saving…' : 'Save unit info'}</button>
                {infMsg ? <span className="text-[11.5px] text-muted">{infMsg}</span> : null}
              </div>
            </div>
          ) : <p className="text-[12px] text-ink">{[inf.filterSize && 'Filter ' + inf.filterSize + (inf.filterQty ? ' ×' + inf.filterQty : ''), inf.filterLocation, inf.notes].filter(Boolean).join(' · ') || 'Nothing recorded.'}</p>}
        </section>
      </div>
    </Sheet>
  )
}
