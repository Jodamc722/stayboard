'use client'
// UPKEEP CALENDAR — book upkeep by availability (Jon, 2026-10-16: "quickly assign, maybe have multi
// calendar view to see open days, be able to assign by day of availability … make it easy for
// coordinator, needs to be clean and multi needs to be accurate").
//
// One row per unit that needs this program, one column per day. Each cell is what the unit is that
// day — open, guest leaving (workable after checkout), guest arriving (workable in the morning), a
// turn, a stay, or a Guesty block with its label — from the stays and Guesty's own calendar
// (/api/upkeep/calendar). On top of that: who of the trade is already in that building that day
// (a filled initial = in this very unit), the due date (red underline) and the suggested day (blue
// ring). Click a workable day → pick who → booked in Breezeway on that day, with the unit info and
// billing line on the task. Nothing is guessed: a short read is said out loud above the grid.
import { useMemo, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import type { UpkeepRow, UpkeepProgram } from '@/app/api/upkeep/route'
import type { UpkeepCalendar, CalCell, CalKind } from '@/app/api/upkeep/calendar/route'

const dow = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })
const dnum = (d: string) => Number(d.slice(8, 10))
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || n
const initials = (n: string) => String(n || '').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase()

const KIND: Record<CalKind, { label: string; cls: string; workable: boolean; hint: string }> = {
  open:  { label: 'Open',        cls: 'bg-emerald-100',                                               workable: true,  hint: 'Empty all day' },
  out:   { label: 'Checkout',    cls: 'bg-[linear-gradient(90deg,#cbd5e1_0_40%,#d1fae5_40%)]',       workable: true,  hint: 'Guest leaves ~11am — workable after' },
  in:    { label: 'Check-in',    cls: 'bg-[linear-gradient(90deg,#d1fae5_0_60%,#cbd5e1_60%)]',       workable: true,  hint: 'Guest arrives ~4pm — workable in the morning' },
  hold:  { label: 'Hold',        cls: 'bg-[repeating-linear-gradient(135deg,#d1fae5_0_4px,#ecfdf5_4px_8px)]', workable: true, hint: 'Blocked in Guesty but nobody staying — workable' },
  turn:  { label: 'Turn',        cls: 'bg-amber-200',                                                 workable: false, hint: 'Guest out and guest in the same day — housekeeping owns it' },
  stay:  { label: 'Guest in',    cls: 'bg-slate-300',                                                 workable: false, hint: 'A guest is in the unit all day' },
  block: { label: 'Owner / block', cls: 'bg-[repeating-linear-gradient(135deg,#cbd5e1_0_4px,#e2e8f0_4px_8px)]', workable: false, hint: 'Owner or someone staying (Guesty block)' },
}

export function UpkeepCalendar({ prog, rows, canBook, onBooked }: {
  prog: UpkeepProgram
  rows: UpkeepRow[]
  canBook: boolean
  onBooked: (rowId: string, msg: string, taskId: string) => void
}) {
  const [span, setSpan] = useState<14 | 21>(14)
  const [pick, setPick] = useState<{ row: UpkeepRow; cell: CalCell } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [booked, setBooked] = useState<Record<string, string>>({})   // row id → "Tue Oct 21 · Carlos"
  const open = rows.filter(r => !r.task && !booked[r.id]).slice(0, 120)
  const ids = Array.from(new Set(open.map(r => r.listingId)))
  const key = ids.length ? `/api/upkeep/calendar?dept=${encodeURIComponent(prog.dept)}&days=${span}&ids=${ids.join(',')}` : null
  const { data, loading, error } = useCachedFetch<UpkeepCalendar & { error?: string }>(key, { ttl: 5 * 60_000, persist: false })
  const byUnit = useMemo(() => new Map((data?.units || []).map(u => [u.listingId, u])), [data])

  const book = async (assignee: string) => {
    if (!pick || busy) return
    setBusy(assignee || '-'); setErr('')
    try {
      const res = await fetch('/api/upkeep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'approve', listingId: pick.row.listingId, cadenceKey: prog.key, dueOn: pick.row.dueOn, date: pick.cell.d, assignee }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Breezeway would not take it')
      const msg = nice(j.date) + (assignee ? ' · ' + first(assignee) : ' · unassigned')
      setBooked(b => ({ ...b, [pick.row.id]: msg }))
      onBooked(pick.row.id, 'booked ' + msg, String(j.taskId || ''))
      if (key) invalidateCache(key)
      setPick(null)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy('') }
  }

  if (!open.length) return <p className="px-3 py-4 text-[12.5px] text-muted">Nothing to book here — everything in this view is on track or already booked.</p>
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
      {data.unsure.length ? <p className="px-3 py-1.5 text-[11.5px] text-amber-800 bg-amber-50 border-b border-amber-200">Partial read: {data.unsure.join(' · ')}.</p> : null}
      {err ? <p className="px-3 py-1.5 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">{err}</p> : null}

      <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
        <table className="w-full border-separate border-spacing-0 text-[11px] table-fixed">
          <thead className="sticky top-0 z-20 bg-white">
            <tr>
              <th className="sticky left-0 z-30 bg-white text-left font-semibold text-muted px-3 py-1.5 border-b border-line w-[13rem]">Unit</th>
              {days.map(d => (
                <th key={d} className={'px-0 py-1 border-b border-line min-w-[2.25rem] text-center font-semibold ' + (d === data.today ? 'text-ink' : 'text-muted') + (/^S/.test(dow(d)) ? ' bg-app/60' : '')}>
                  <div className="text-[9.5px] leading-none">{dow(d)}</div>
                  <div className={'text-[11px] leading-tight ' + (d === data.today ? 'inline-block px-1 rounded bg-ink text-white' : '')}>{dnum(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {open.map(r => {
              const u = byUnit.get(r.listingId)
              const isPick = pick?.row.id === r.id
              return (
                <tr key={r.id} className={isPick ? 'bg-sky-50/60' : ''}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-1 border-b border-line">
                    <div className="flex items-center gap-1.5">
                      <span className={'w-2 h-2 rounded-full shrink-0 ' + (r.state === 'late' ? 'bg-rose-500' : r.state === 'soon' ? 'bg-amber-400' : 'bg-slate-300')} />
                      <span className="font-semibold text-ink truncate max-w-[9rem]" title={r.unit}>{r.unit}</span>
                    </div>
                    <div className={'pl-3.5 text-[10.5px] ' + (r.state === 'late' ? 'text-rose-700' : 'text-muted')}>{booked[r.id] ? <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5"><Check size={10} /> {booked[r.id]}</span> : r.daysOver > 0 ? `${r.daysOver}d late` : r.daysOver === 0 ? 'due today' : `due in ${-r.daysOver}d`}</div>
                  </td>
                  {days.map(d => {
                    const c = u?.cells.find(x => x.d === d)
                    if (!c) return <td key={d} className="border-b border-l border-white bg-white" />
                    const K = KIND[c.k]
                    const due = r.dueOn === d || (r.daysOver > 0 && d === data.today)
                    const sug = r.plan?.date === d && K.workable
                    const sel = isPick && pick?.cell.d === d
                    const lead = c.team[0]
                    const title = `${r.unit} · ${nice(d)} — ${c.label || K.hint}` + (c.team.length ? '\n' + c.team.map(t => `${t.name}${t.atUnit ? ' (in this unit)' : ''} · ${t.jobs} job${t.jobs === 1 ? '' : 's'}`).join('\n') : '\nNobody of this trade in the building')
                    return (
                      <td key={d} className="p-0 border-b border-l border-white">
                        <button
                          disabled={!K.workable || !canBook || !!booked[r.id]}
                          onClick={() => setPick(sel ? null : { row: r, cell: c })}
                          title={title}
                          className={'relative w-full h-9 grid place-items-center ' + K.cls + (K.workable && canBook ? ' hover:brightness-95 cursor-pointer' : ' cursor-default') + (sug ? ' ring-2 ring-inset ring-sky-500' : '') + (sel ? ' outline outline-2 outline-ink -outline-offset-2' : '')}
                        >
                          {lead ? (
                            <span className={'w-5 h-5 rounded-full text-[8.5px] font-bold grid place-items-center ' + (lead.atUnit ? 'bg-sky-600 text-white' : 'ring-1 ring-sky-600 text-sky-700 bg-white/80')}>{initials(lead.name)}</span>
                          ) : null}
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

      {pick ? (() => {
        const c = pick.cell, r = pick.row
        const here = c.team
        const hereNames = new Set(here.map(h => h.name.toLowerCase()))
        const others = data.people.filter(p => !hereNames.has(p.name.toLowerCase())).map(p => ({ name: p.name, jobs: p.perDay[c.d] || 0 }))
          .sort((a, b) => Number(b.jobs > 0) - Number(a.jobs > 0) || a.jobs - b.jobs || a.name.localeCompare(b.name))
        const Btn = ({ name, sub, strong }: { name: string; sub: string; strong?: boolean }) => (
          <button onClick={() => book(name)} disabled={!!busy} className={'text-left px-2.5 py-1.5 rounded-lg border text-[12px] disabled:opacity-50 ' + (strong ? 'border-sky-300 bg-sky-50 hover:bg-sky-100' : 'border-line bg-white hover:border-ink/40')}>
            <div className="font-semibold text-ink inline-flex items-center gap-1">{busy === name ? <Loader2 size={11} className="animate-spin" /> : null}{name}</div>
            <div className="text-[10.5px] text-muted">{sub}</div>
          </button>
        )
        return (
          <div className="fixed z-50 bottom-4 left-1/2 -translate-x-1/2 w-[min(56rem,calc(100vw-2rem))] max-h-[45vh] overflow-y-auto rounded-xl border border-line bg-white px-3 py-2.5 shadow-2xl">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[12.5px] font-semibold text-ink">Book {prog.label.toLowerCase()} · {r.unit} · {nice(c.d)}</span>
              <span className="text-[11px] text-muted">{KIND[c.k].hint}</span>
              {r.bill ? <span className="text-[11px] text-amber-800">{r.bill}</span> : null}
              <button onClick={() => setPick(null)} className="ml-auto text-[11.5px] text-muted hover:text-ink">Cancel</button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {here.map(h => <Btn key={h.name} name={h.name} strong sub={(h.atUnit ? 'already in this unit' : 'already in the building') + ` · ${h.jobs} job${h.jobs === 1 ? '' : 's'} that day`} />)}
              {others.slice(0, here.length ? 6 : 10).map(p => <Btn key={p.name} name={p.name} sub={p.jobs ? `elsewhere · ${p.jobs} job${p.jobs === 1 ? '' : 's'} that day` : 'nothing booked that day'} />)}
              <button onClick={() => book('')} disabled={!!busy} className="px-2.5 py-1.5 rounded-lg border border-dashed border-line text-[12px] text-muted hover:text-ink disabled:opacity-50">{busy === '-' ? <Loader2 size={11} className="animate-spin inline" /> : null} Book unassigned</button>
            </div>
          </div>
        )
      })() : null}
    </div>
  )
}
