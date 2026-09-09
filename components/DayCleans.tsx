'use client'
// THE CLEANS THEMSELVES, FOR ONE DAY (Jon, 2026-09-09: "the goal is to review the actual cleans for
// the day, the calendar view should be below").
//
// The grid answers "how does the week look". It does not answer the question this board exists for,
// which is: what are we actually cleaning today, and who is on each one. That was two clicks down —
// pick a day, expand it — so the review started with the abstraction and had to dig for the facts.
// This flips it. The day is the page; the calendar sits underneath for shape and planning.
//
// THE WHOLE PORTFOLIO FIRST, THEN EACH MARKET (Jon, 2026-09-09: "we need to see by whole market,
// then break by market"). The first line is the number the company is accountable for that day;
// underneath, Miami and Broward each carry their own count, because that is where the phone call
// goes when one of them is behind.
//
// Inside a market it is GROUPED BY THE PERSON, because that is how the day gets worked and how it
// gets checked: a name, then the units in their hands. The turnover is called out from everything
// else with the same predicate the labor and billing maths use — a prep or a touch-up is real work
// but it is not the clean that has to happen before someone arrives.
//
// MANAGING, NOT JUST READING (Jon, 2026-09-09: "the goal is to manage cleans here and review it").
// Signed in, every clean carries a reassign control that writes straight to Breezeway through the
// same gated endpoint the cockpit uses, and the board reloads from the mirror afterwards rather
// than pretending locally — a row that says it moved when Breezeway refused is worse than no
// control at all. The share link never gets it: a passcode is not a login, and the payload it
// receives carries no task id to act on.
//
// Only assigned work reaches this component; the planner drops jobs with nobody on them, so a
// quiet day here means nobody has been given the work yet, not that there is none. The count line
// says so rather than leaving an empty panel to be read as "all done".
import { useMemo, useState } from 'react'
import { Sparkles, Wrench, CheckCircle2, Loader2, Circle, UserCog } from 'lucide-react'
import type { PDay, PBlock, PJob, PTag } from './PlannerView'

const TAG_CHIP: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200',
}
const longDay = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }
const dowOf = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) } catch { return '' } }

function StatusDot({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={13} className="text-emerald-600 shrink-0" aria-label="done" />
  if (status === 'in progress') return <Loader2 size={13} className="text-sky-600 shrink-0" aria-label="in progress" />
  return <Circle size={13} className="text-line shrink-0" aria-label="scheduled" />
}

type Row = { person: string; market: string; jobs: PJob[] }
type MarketDay = { market: string; rows: Row[]; turnovers: number; jobs: number }

type Person = { id: number; name: string }

export function DayCleans({ days, blocks, dept, marketFilter, canManage, onChanged }: {
  days: PDay[]
  blocks: PBlock[]
  dept: 'cleaning' | 'maintenance' | 'all'
  marketFilter?: string
  /** Signed-in staff only. The share link leaves this off and stays read-only. */
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
    } catch { /* the select just stays empty and says so */ }
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
      setOpenFor('')
      onChanged?.()
    } catch (e: any) { setFailed(String(e?.message || e)) }
    setSaving('')
  }
  const scoped = useMemo(
    () => (!marketFilter || marketFilter === 'all') ? blocks : blocks.filter(b => b.market.toLowerCase() === marketFilter),
    [blocks, marketFilter])

  // Per day, per market: every assigned job, under the person holding it.
  const byDate = useMemo(() => {
    const m = new Map<string, MarketDay[]>()
    for (const d of days) m.set(d.date, [])
    for (const b of scoped) {
      for (const p of b.people) {
        for (const date of Object.keys(p.byDay)) {
          const jobs = p.byDay[date] || []
          if (!jobs.length) continue
          const markets = m.get(date); if (!markets) continue
          let mk = markets.find(x => x.market === b.market)
          if (!mk) { mk = { market: b.market, rows: [], turnovers: 0, jobs: 0 }; markets.push(mk) }
          const at = mk.rows.find(r => r.person === p.name)
          if (at) at.jobs = at.jobs.concat(jobs)
          else mk.rows.push({ person: p.name, market: b.market, jobs: jobs.slice() })
          for (const j of jobs) { mk.jobs++; if (j.departure) mk.turnovers++ }
        }
      }
    }
    for (const markets of Array.from(m.values())) {
      markets.sort((a, b2) => b2.turnovers - a.turnovers || a.market.localeCompare(b2.market))
      for (const mk of markets) {
        mk.rows.sort((a, b2) => {
          const ad = a.jobs.filter(j => j.departure).length, bd = b2.jobs.filter(j => j.departure).length
          return bd - ad || b2.jobs.length - a.jobs.length || a.person.localeCompare(b2.person)
        })
      }
    }
    return m
  }, [days, scoped])

  /** The whole portfolio for a day — the line before the split. */
  const countOf = (date: string) => {
    const markets = byDate.get(date) || []
    let turnovers = 0, jobs = 0, people = 0
    for (const mk of markets) { turnovers += mk.turnovers; jobs += mk.jobs; people += mk.rows.length }
    return { turnovers, jobs, people, markets: markets.length }
  }

  // Open on today when today is in the window, else the first day that has work on it.
  const [picked, setPicked] = useState<string>(() => {
    const t = days.find(d => d.today)
    if (t) return t.date
    return (days[0] || { date: '' }).date
  })
  const day = days.find(d => d.date === picked) || days[0]
  if (!day) return null
  const markets = byDate.get(day.date) || []
  const c = countOf(day.date)
  const label = dept === 'maintenance' ? 'work order' : 'clean'

  return (
    <section className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
      {/* Pick the day. The number under each is the turnovers, because that is the number that has
          to happen before somebody arrives — the rest is work, not a deadline. */}
      <div className="flex overflow-x-auto border-b border-line">
        {days.map(d => {
          const n = countOf(d.date)
          const on = d.date === day.date
          return (
            <button key={d.date} onClick={() => setPicked(d.date)}
              className={'shrink-0 px-3.5 py-2.5 text-center border-r border-line last:border-r-0 transition ' +
                (on ? 'bg-ink text-white' : d.weekend ? 'bg-app/60 hover:bg-app' : 'bg-white hover:bg-app/60')}>
              <span className={'block text-[10.5px] font-bold uppercase tracking-wide ' + (on ? 'text-white/70' : 'text-muted')}>
                {dowOf(d.date)}{d.today ? ' · today' : ''}
              </span>
              <span className={'block text-[17px] font-bold tabular-nums leading-tight ' + (on ? 'text-white' : n.turnovers ? 'text-ink' : 'text-line')}>
                {n.turnovers || (n.jobs ? '·' : '—')}
              </span>
            </button>
          )
        })}
      </div>

      {/* THE WHOLE PORTFOLIO, then the split. */}
      <header className="px-4 py-3 border-b border-line">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-[16px] font-bold text-ink tracking-tight">{longDay(day.date)}</h3>
          <p className="text-[12.5px] text-muted">
            <b className="text-ink">{c.turnovers}</b> {label}{c.turnovers === 1 ? '' : 's'} across {c.markets || 0} market{c.markets === 1 ? '' : 's'}
            {c.jobs - c.turnovers ? ' · ' + (c.jobs - c.turnovers) + ' other job' + (c.jobs - c.turnovers === 1 ? '' : 's') : ''}
            {c.people ? ' · ' + c.people + ' ' + (c.people === 1 ? 'person' : 'people') : ''}
          </p>
        </div>
        {markets.length > 1 ? (
          <div className="flex gap-1.5 flex-wrap mt-1.5">
            {markets.map(mk => (
              <span key={mk.market} className="text-[11.5px] rounded-lg bg-app px-2 py-0.5 text-ink">
                <b>{mk.market}</b> <span className="tabular-nums">{mk.turnovers}</span>
                <span className="text-muted"> · {mk.rows.length} on</span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {failed ? (
        <p className="px-4 py-2 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">{failed}</p>
      ) : null}

      {!markets.length ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-muted">
          Nothing assigned on this day. Work with nobody on it yet does not appear here — check the schedule board.
        </p>
      ) : (
        markets.map(mk => (
          <div key={mk.market}>
            <div className="px-4 py-1.5 bg-app/70 border-y border-line flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink">{mk.market}</span>
              <span className="text-[11.5px] text-muted tabular-nums">
                {mk.turnovers} {label}{mk.turnovers === 1 ? '' : 's'}{mk.jobs - mk.turnovers ? ' · ' + (mk.jobs - mk.turnovers) + ' other' : ''} · {mk.rows.length} {mk.rows.length === 1 ? 'person' : 'people'}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {mk.rows.map(r => {
                const turns = r.jobs.filter(j => j.departure)
                const rest = r.jobs.filter(j => !j.departure)
                return (
                  <li key={r.person} className="px-4 py-3">
                    <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
                      <span className="text-[14px] font-bold text-ink">{r.person}</span>
                      <span className="text-[11.5px] text-muted">
                        {turns.length} {label}{turns.length === 1 ? '' : 's'}{rest.length ? ' · ' + rest.length + ' other' : ''}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {turns.concat(rest).map((j, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px]">
                          <StatusDot status={j.status} />
                          {j.departure
                            ? <Sparkles size={12} className="text-brand-500 mt-0.5 shrink-0" />
                            : <Wrench size={12} className="text-muted/60 mt-0.5 shrink-0" />}
                          <span className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
                            <span className={'font-semibold ' + (j.status === 'done' ? 'text-muted line-through decoration-line' : 'text-ink')}>{j.unit}</span>
                            {!j.departure ? <span className="text-[11.5px] text-muted">{j.task}</span> : null}
                            {(j.tags || []).map((t: PTag) => (
                              <span key={t.key} className={'text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ' + (TAG_CHIP[t.tone] || 'bg-app text-muted ring-line')}>{t.label}</span>
                            ))}
                            {canManage && j.id && j.status !== 'done' ? (
                              openFor === j.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <select autoFocus disabled={saving === j.id}
                                    defaultValue=""
                                    onChange={e => { const v = Number(e.target.value); if (v) reassign(j.id as string, v) }}
                                    className="text-[11.5px] rounded-lg border border-line bg-white px-1.5 py-0.5 text-ink max-w-[170px]">
                                    <option value="" disabled>{people.length ? 'Move to…' : 'Loading people…'}</option>
                                    {people.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                                  </select>
                                  <button onClick={() => setOpenFor('')} className="text-[11px] text-muted hover:text-ink">cancel</button>
                                  {saving === j.id ? <Loader2 size={11} className="animate-spin text-muted" /> : null}
                                </span>
                              ) : (
                                <button onClick={() => openReassign(j.id as string)}
                                  title="Reassign this clean in Breezeway"
                                  className="text-[11px] text-muted hover:text-brand-700 inline-flex items-center gap-0.5">
                                  <UserCog size={11} /> reassign
                                </button>
                              )
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
