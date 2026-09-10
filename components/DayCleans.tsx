'use client'
// THE HOUSEKEEPING DAY — who is on, what they are cleaning, what it cost (Jon, 2026-09-09/10:
// "the goal is to manage cleans here and review it" · "make sure HK team scheduled is showing
// regardless of tasks" · "most important is the housekeeping team").
//
// WHY ROWS, NOT CARDS. The card grid read as chaos because every card was a different height and
// the eye had nothing to run down. A rota is a comparison — this person against that person — so
// it wants aligned columns: who, their hours, their units, their count. Fifteen rows of that scan
// in a second; fifteen ragged cards do not.
//
// EVERYONE ROSTERED APPEARS, WITH OR WITHOUT WORK. A board that only lists people holding cleans
// cannot answer the question a supervisor actually has at 8am — who is on and still free — and it
// hides the expensive case: somebody clocked in with nothing assigned. So the row list is the union
// of three sources, and a person missing from two of them still gets a line:
//   · assigned on the board   (Breezeway, via the planner)
//   · punched or rostered     (Homebase, via the labor pass — housekeeping roles only)
//   · marked Working          (the roster kept on the Turnover Schedule)
//
// A clean is counted ONCE however many people are on it — two cleaners on a big turnover is normal,
// two cleans is not — and the unit carries a "2 on" chip so the pairing is visible. Turnovers are
// separated from strip/touch-up work with the same predicate the billing maths uses.
//
// Managing: signed in, every clean can be reassigned in place, writing to Breezeway through the
// gated endpoint the cockpit uses and reloading from the mirror afterwards. The share link never
// gets it — a passcode is not a login, and its payload carries no task id to act on.
import { useMemo, useState } from 'react'
import { Loader2, UserCog, AlertTriangle, CalendarRange, Check } from 'lucide-react'
import type { PDay, PBlock, PJob, PTag } from './PlannerView'
import { nameMatches } from '@/lib/person-name'

export type DayPerson = {
  name: string; hours: number | null; cost: number | null; billable: number
  basis: 'actual' | 'scheduled' | 'none'; offBoard: boolean
}
export type DayLabor = {
  byDay: Record<string, DayPerson[]>
  billableByTask: Record<string, number>
  days?: { date: string; revenue: number; cleans: number }[]
  payrollComplete: boolean
}

const TAG_RING: Record<string, string> = {
  amber: 'ring-amber-200 bg-amber-50 text-amber-900',
  violet: 'ring-violet-200 bg-violet-50 text-violet-900',
  emerald: 'ring-emerald-200 bg-emerald-50 text-emerald-900',
  sky: 'ring-sky-200 bg-sky-50 text-sky-900',
}
const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString()
const longDay = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }
const dowOf = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) } catch { return '' } }
function initials(name: string): string {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}
/**
 * Is this the same person? The roster keeps first names ("Yunisleydis", "Maryurie"), Homebase keeps
 * full ones spelled differently ("Yunisleydi Perez", "Maryuris Brazon"). A first-name equality test
 * splits those into two rows — one carrying the cleans with no hours, one carrying the hours with
 * no cleans — which is the exact false alarm this board exists to avoid. lib/person-name is the
 * app's one answer to this question and handles the near-spellings and the swapped order.
 */
const sameName = (a: string, b: string) => nameMatches(a, b)

type Person = { id: number; name: string }
type Row = {
  person: string
  turnovers: PJob[]
  otherWork: PJob[]
  hours: number | null
  cost: number | null
  basis: 'actual' | 'scheduled' | 'none'
  rostered: boolean
}
type MarketDay = { market: string; rows: Row[]; turnovers: number; otherJobs: number; crewOn: Record<string, number> }

const keyOf = (j: PJob) => String(j.id || (j.unit + '|' + j.task))

export function DayCleans({ days, blocks, dept, marketFilter, labor, canManage, onChanged }: {
  days: PDay[]
  blocks: PBlock[]
  dept: 'cleaning' | 'maintenance' | 'all'
  marketFilter?: string
  labor?: DayLabor | null
  canManage?: boolean
  onChanged?: () => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [openFor, setOpenFor] = useState<string>('')
  const [saving, setSaving] = useState<string>('')
  const [failed, setFailed] = useState<string>('')

  const openReassign = async (taskId: string) => {
    setOpenFor(taskId); setFailed('')
    if (people.length) return
    try {
      const r = await fetch('/api/breezeway/people?department=housekeeping', { cache: 'no-store' })
      const j = await r.json()
      if (Array.isArray(j?.people)) setPeople(j.people.map((p: any) => ({ id: Number(p.id), name: String(p.name) })).filter((p: Person) => p.id && p.name))
    } catch { /* the select stays empty and says so */ }
  }
  const reassign = async (taskId: string, personId: number) => {
    setSaving(taskId); setFailed('')
    try {
      const r = await fetch('/api/breezeway/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, assigneeIds: [personId] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Breezeway refused the change.')
      setOpenFor(''); onChanged?.()
    } catch (e: any) { setFailed(String(e?.message || e)) }
    setSaving('')
  }

  const scoped = useMemo(
    () => (!marketFilter || marketFilter === 'all') ? blocks : blocks.filter(b => b.market.toLowerCase() === marketFilter),
    [blocks, marketFilter])

  const byDate = useMemo(() => {
    const out = new Map<string, MarketDay[]>()
    for (const d of days) {
      const markets: MarketDay[] = []
      for (const b of scoped) {
        const mk: MarketDay = { market: b.market, rows: [], turnovers: 0, otherJobs: 0, crewOn: {} }
        for (const p of b.people) {
          const jobs = p.byDay[d.date] || []
          const rostered = /work|on.?call/i.test(String((p.roster || {})[d.date] || ''))
          if (!jobs.length && !rostered) continue
          const turnovers = jobs.filter(j => j.departure)
          const otherWork = jobs.filter(j => !j.departure)
          mk.rows.push({ person: p.name, turnovers, otherWork, hours: null, cost: null, basis: 'none', rostered })
          for (const j of turnovers) {
            const k = keyOf(j)
            mk.crewOn[k] = (mk.crewOn[k] || 0) + 1
            if (mk.crewOn[k] === 1) mk.turnovers++
          }
          mk.otherJobs += otherWork.length
        }
        if (mk.rows.length) markets.push(mk)
      }
      // Anyone the clock knows about who never reached the board — punched in with nothing on them,
      // which is the most expensive row here and the one that used to be invisible.
      const clocked = (labor?.byDay?.[d.date] || [])
      if (markets.length && clocked.length) {
        const home = markets[0]
        for (const c of clocked) {
          const found = markets.some(m => m.rows.some(r => sameName(r.person, c.name)))
          if (!found) home.rows.push({ person: c.name, turnovers: [], otherWork: [], hours: c.hours, cost: c.cost, basis: c.basis, rostered: false })
        }
      }
      // Stamp hours onto whoever we can match.
      for (const m of markets) {
        for (const r of m.rows) {
          const c = clocked.find(x => sameName(x.name, r.person))
          if (c) { r.hours = c.hours; r.cost = c.cost; r.basis = c.basis }
        }
        m.rows.sort((a, b) =>
          b.turnovers.length - a.turnovers.length ||
          b.otherWork.length - a.otherWork.length ||
          (b.hours || 0) - (a.hours || 0) ||
          a.person.localeCompare(b.person))
      }
      markets.sort((a, b) => b.turnovers - a.turnovers || a.market.localeCompare(b.market))
      out.set(d.date, markets)
    }
    return out
  }, [days, scoped, labor])

  const countOf = (date: string) => {
    const markets = byDate.get(date) || []
    let turnovers = 0, other = 0, on = 0, free = 0
    for (const mk of markets) {
      turnovers += mk.turnovers; other += mk.otherJobs
      for (const r of mk.rows) { on++; if (!r.turnovers.length && !r.otherWork.length) free++ }
    }
    return { turnovers, other, on, free, markets }
  }

  const [picked, setPicked] = useState<string>(() => (days.find(d => d.today) || days[0] || { date: '' }).date)
  const day = days.find(d => d.date === picked) || days[0]
  if (!day) return null
  const c = countOf(day.date)
  const label = dept === 'maintenance' ? 'work order' : 'clean'
  const busiest = Math.max(1, ...c.markets.flatMap(mk => mk.rows.map(r => r.turnovers.length)))
  const clocked = labor?.byDay?.[day.date] || []
  const ahead = clocked.length > 0 && clocked.every(p => p.basis !== 'actual')
  const dayHours = clocked.reduce((a, p) => a + (p.hours || 0), 0)
  const dayCost = clocked.some(p => p.cost != null) ? clocked.reduce((a, p) => a + (p.cost || 0), 0) : null
  const dayBillable = clocked.reduce((a, p) => a + (p.billable || 0), 0)
  const dayRevenue = (labor?.days || []).find(x => x.date === day.date)?.revenue || 0

  const Kpi = ({ label: l, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="px-4 py-2.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted truncate">{l}</p>
      <p className={'text-[16px] font-bold tabular-nums leading-tight ' + (tone || 'text-ink')}>{value}</p>
      {sub ? <p className="text-[10.5px] text-muted truncate">{sub}</p> : null}
    </div>
  )

  return (
    <div className="space-y-3">
      {/* ── PICK A DAY ─────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
        <div className="flex overflow-x-auto">
          {days.map(d => {
            const n = countOf(d.date)
            const on = d.date === day.date
            return (
              <button key={d.date} onClick={() => setPicked(d.date)}
                className={'shrink-0 w-[62px] py-2 text-center border-r border-line last:border-r-0 transition ' +
                  (on ? 'bg-ink' : d.weekend ? 'bg-app/50 hover:bg-app' : 'hover:bg-app/60')}>
                <span className={'block text-[10px] font-bold uppercase tracking-wide ' + (on ? 'text-white/60' : d.today ? 'text-brand-600' : 'text-muted')}>{dowOf(d.date)}</span>
                <span className={'block text-[10.5px] tabular-nums ' + (on ? 'text-white/50' : 'text-muted/70')}>{d.date.slice(8)}</span>
                <span className={'block text-[17px] font-bold tabular-nums leading-tight ' + (on ? 'text-white' : n.turnovers ? 'text-ink' : 'text-line')}>{n.turnovers || '—'}</span>
              </button>
            )
          })}
        </div>
      </div>

      {failed ? (
        <div className="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3.5 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-rose-600 mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-rose-800">{failed}</p>
        </div>
      ) : null}

      {/* ── THE DAY, WHOLE ─────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
        <div className="px-5 py-4 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted">{longDay(day.date)}{day.today ? ' · today' : ''}</p>
            <p className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[32px] font-bold text-ink leading-none tabular-nums">{c.turnovers}</span>
              <span className="text-[13.5px] font-semibold text-muted">{label}{c.turnovers === 1 ? '' : 's'}</span>
            </p>
            <p className="text-[12px] text-muted mt-1">
              {c.on} on the housekeeping schedule
              {c.free ? ' · ' + c.free + ' with nothing assigned' : ''}
              {c.other ? ' · ' + c.other + ' other job' + (c.other === 1 ? '' : 's') : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {c.markets.map(mk => (
              <div key={mk.market} className="rounded-xl bg-app px-3 py-2 min-w-[88px]">
                <p className="text-[10.5px] uppercase tracking-wide font-bold text-muted">{mk.market}</p>
                <p className="text-[18px] font-bold text-ink tabular-nums leading-tight">{mk.turnovers}</p>
                <p className="text-[11px] text-muted">{mk.rows.length} on</p>
              </div>
            ))}
          </div>
        </div>

        {labor && clocked.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-line divide-x divide-line">
            <Kpi label={'Hours ' + (ahead ? 'rostered' : 'worked')} value={dayHours ? dayHours.toFixed(1) : '—'} sub={ahead ? 'not worked yet' : undefined} />
            <Kpi label={'Labor ' + (ahead ? 'planned' : 'cost')} value={money(dayCost)} tone={ahead ? 'text-amber-700' : 'text-ink'} />
            {/* Owner-billable where there is any; the guest's cleaning fee where there is not.
                Measured 2026-09-09: no housekeeping task in a fortnight carried an owner cost line,
                because a departure clean is paid for by the guest. */}
            <Kpi label={dayBillable > 0 ? 'Owner billable' : 'Cleaning revenue'}
              value={dayBillable > 0 ? money(dayBillable) : (dayRevenue ? money(dayRevenue) : '—')}
              sub={dayBillable > 0 && dayRevenue ? '+ ' + money(dayRevenue) + ' guest fees' : undefined} />
            <Kpi label={ahead ? 'Per clean, planned' : 'Cost per clean'}
              value={dayCost != null && c.turnovers ? money(Math.round(dayCost / c.turnovers)) : '—'}
              tone={ahead ? 'text-amber-700' : 'text-ink'} />
          </div>
        ) : null}
        {labor && !labor.payrollComplete && !ahead ? (
          <p className="px-5 py-2 border-t border-amber-200 bg-amber-50 text-[11.5px] text-amber-900">
            Homebase came back short for part of this window — hours and cost are a floor, not the figure.
          </p>
        ) : null}
      </section>

      {/* ── THE CREW, ONE ROW EACH ─────────────────────────────────────────────────────────── */}
      {!c.markets.length ? (
        <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-10 text-center">
          <p className="text-[13px] text-muted">Nobody on the housekeeping schedule for this day.</p>
          <p className="text-[11.5px] text-muted/80 mt-1">Set who is working on the Turnover Schedule, and unassigned work never reaches this board.</p>
        </div>
      ) : c.markets.map(mk => (
        <section key={mk.market} className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
          <header className="px-5 py-2.5 border-b border-line flex items-baseline gap-2.5 flex-wrap bg-app/40">
            <h3 className="text-[14px] font-bold text-ink tracking-tight">{mk.market}</h3>
            <span className="text-[12px] text-muted tabular-nums">
              {mk.turnovers} {label}{mk.turnovers === 1 ? '' : 's'} · {mk.rows.length} on
              {mk.otherJobs ? ' · ' + mk.otherJobs + ' other' : ''}
            </span>
          </header>

          <ul className="divide-y divide-line">
            {mk.rows.map(r => {
              const nothing = !r.turnovers.length && !r.otherWork.length
              const done = r.turnovers.filter(j => j.status === 'done').length
              return (
                <li key={r.person + mk.market} className={'grid gap-3 px-4 py-2.5 items-start ' + (nothing ? 'bg-app/30' : '')}
                  style={{ gridTemplateColumns: 'minmax(150px,190px) 1fr auto' }}>
                  {/* who + their clock */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={'h-8 w-8 shrink-0 rounded-full grid place-items-center text-[11px] font-bold ' +
                      (nothing ? 'bg-app text-muted ring-1 ring-line' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100')}>
                      {initials(r.person)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold text-ink truncate leading-tight">{r.person}</span>
                      <span className="block text-[11px] text-muted tabular-nums">
                        {r.hours != null
                          ? r.hours + 'h ' + (r.basis === 'scheduled' ? 'rostered' : 'worked') + (r.cost != null ? ' · ' + money(r.cost) : '')
                          : r.rostered ? 'on the roster' : 'no hours'}
                      </span>
                    </span>
                  </div>

                  {/* what they are cleaning */}
                  <div className="min-w-0 flex flex-wrap gap-1 items-center pt-0.5">
                    {nothing ? (
                      <span className="text-[12px] text-muted italic">nothing assigned</span>
                    ) : (
                      <>
                        {r.turnovers.map((j, i) => (
                          <span key={i}
                            className={'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[12px] ring-1 ' +
                              (j.status === 'done' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-white text-ink ring-line')}>
                            {j.status === 'done' ? <Check size={10} className="shrink-0" /> : null}
                            <span className="font-semibold">{j.unit}</span>
                            {(mk.crewOn[keyOf(j)] || 1) > 1 ? <span className="text-[9.5px] font-bold uppercase text-muted">{mk.crewOn[keyOf(j)]} on</span> : null}
                            {(j.tags || []).map((t: PTag) => (
                              <span key={t.key} className={'text-[9.5px] font-semibold px-1 rounded ring-1 ' + (TAG_RING[t.tone] || 'ring-line bg-app text-muted')}>{t.label}</span>
                            ))}
                            {canManage && j.id && j.status !== 'done' ? (
                              openFor === j.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <select autoFocus disabled={saving === j.id} defaultValue=""
                                    onChange={e => { const v = Number(e.target.value); if (v) reassign(j.id as string, v) }}
                                    className="text-[11px] rounded border border-line bg-white px-1 text-ink max-w-[130px]">
                                    <option value="" disabled>{people.length ? 'Move to…' : 'Loading…'}</option>
                                    {people.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                                  </select>
                                  {saving === j.id ? <Loader2 size={10} className="animate-spin text-muted" /> : null}
                                </span>
                              ) : (
                                <button onClick={() => openReassign(j.id as string)} title="Reassign in Breezeway"
                                  className="text-muted/60 hover:text-brand-700"><UserCog size={11} /></button>
                              )
                            ) : null}
                          </span>
                        ))}
                        {r.otherWork.length ? (
                          <span className="text-[11px] text-muted">
                            + {r.otherWork.length} other: {r.otherWork.map(j => j.task).join(', ').slice(0, 70)}
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>

                  {/* the count, and how it compares */}
                  <div className="text-right shrink-0 w-[64px]">
                    <span className={'text-[19px] font-bold tabular-nums leading-none ' + (nothing ? 'text-line' : 'text-ink')}>
                      {r.turnovers.length || '—'}
                    </span>
                    {done ? <span className="block text-[10px] text-emerald-700 font-semibold">{done} done</span> : null}
                    <div className="h-1 rounded-full bg-app mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-400" style={{ width: Math.round((r.turnovers.length / busiest) * 100) + '%' }} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {canManage ? (
        <a href="/schedule" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-700 hover:text-brand-800">
          <CalendarRange size={13} /> Open the Turnover Schedule to assign or move cleans
        </a>
      ) : null}
    </div>
  )
}
