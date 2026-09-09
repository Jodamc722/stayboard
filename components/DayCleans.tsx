'use client'
// WHO IS WORKING TODAY, AND WHAT THEY ARE CLEANING (Jon, 2026-09-09: "the goal is to review the
// actual cleans for the day" · "we need to see by whole market, then break by market" · "think
// robust visual to see who is working for cleans").
//
// The first version of this was a bulleted list, and a list is the wrong shape for the question.
// You do not read a day to find out that eleven cleans exist; you read it to see whether the load
// sits on one person, who is free, and which market is carrying it. So:
//
//   ONE CARD PER CLEANER, with the count big enough to compare across the grid at a glance and a
//   load bar underneath measured against the busiest person that day. Cards side by side say
//   "Miriam has six and everyone else has one" in the time it takes to look.
//
//   A CLEAN IS COUNTED ONCE, however many people are on it. Two cleaners sent to the same unit is
//   normal on a big turnover, and counting the rows instead of the units made a two-person clean
//   read as two cleans — the day's headline number was quietly inflated wherever the crew doubled
//   up. Both names still show it; the count does not move, and the unit carries a "2 on" chip so
//   the pairing is visible rather than implied.
//
//   ONLY PEOPLE WITH CLEANS GET A CARD. The first cut gave everyone one, and a board headed "12
//   cleans" filled up with six people carrying zero of them — a trash pickup, a fob to buy, a
//   quality inspection. Real work, but not this board's question, and it made a light day look
//   chaotic. Support jobs now sit on one line under the market, and the people doing them are
//   named there instead of taking a card each.
//
//   ALSO ON, NOTHING BOOKED. A rota view that only shows people with work cannot answer the
//   question a supervisor actually has at 8am, which is who is free. The roster already knows;
//   this shows it under each market instead of leaving it in the calendar grid.
//
//   PORTFOLIO FIRST, THEN THE SPLIT. The number the company owes today, then Miami and Broward
//   separately, because that is where the phone call goes when one of them is behind.
//
// The turnover is called out from prep and touch-up work with the same predicate the labor and
// billing maths use — a strip or a walkthrough is real work but it is not the clean that has to
// happen before somebody arrives tonight.
//
// MANAGING, NOT JUST READING. Signed in, every clean carries a reassign control that writes to
// Breezeway through the same gated endpoint the cockpit uses, then reloads from the mirror rather
// than pretending locally — a row that claims it moved when Breezeway refused is worse than no
// control at all. The share link never gets it: a passcode is not a login, and the payload it
// receives carries no task id to act on.
//
// Only ASSIGNED work reaches this component; the planner drops jobs with nobody on them. A quiet
// day here means nobody has been given the work yet, not that there is none, and the empty state
// says exactly that rather than reading as "all done".
import { useMemo, useState } from 'react'
import { Sparkles, Wrench, Check, Loader2, UserCog, AlertTriangle } from 'lucide-react'
import type { PDay, PBlock, PJob, PTag } from './PlannerView'

const TAG_CHIP: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200',
}
const longDay = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }
const dowOf = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) } catch { return '' } }
const dayNum = (iso: string) => iso.slice(8)
function initials(name: string): string {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

type Person = { id: number; name: string }
type Row = { person: string; jobs: PJob[]; cleans: PJob[]; support: PJob[]; turnovers: number }
type MarketDay = {
  market: string
  rows: Row[]                                   // people with at least one clean
  support: { person: string; n: number }[]      // people with none, and how many jobs they do have
  alsoOn: string[]                              // rostered on, nothing booked at all
  turnovers: number; otherCleans: number; supportJobs: number
  /** How many people are on each clean, so a shared one is counted once and labelled. */
  crewOn: Record<string, number>
}

/** One clean, identified across the people holding it. The task id in-app, the unit on a share link. */
const keyOf = (j: PJob) => String(j.id || (j.unit + '|' + j.task))

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
    const m = new Map<string, MarketDay[]>()
    for (const d of days) m.set(d.date, [])
    for (const b of scoped) {
      for (const d of days) {
        const markets = m.get(d.date)!
        let mk = markets.find(x => x.market === b.market)
        if (!mk) { mk = { market: b.market, rows: [], support: [], alsoOn: [], turnovers: 0, otherCleans: 0, supportJobs: 0, crewOn: {} }; markets.push(mk) }
        for (const p of b.people) {
          const jobs = p.byDay[d.date] || []
          if (jobs.length) {
            const cleans = jobs.filter(j => j.isClean)
            const support = jobs.filter(j => !j.isClean)
            if (cleans.length) {
              const turnovers = cleans.filter(j => j.departure).length
              mk.rows.push({ person: p.name, jobs, cleans, support, turnovers })
              // Count the CLEAN, not the row: a unit two people are sent to is one clean.
              for (const j of cleans) {
                const k = keyOf(j)
                mk.crewOn[k] = (mk.crewOn[k] || 0) + 1
                if (mk.crewOn[k] === 1) { if (j.departure) mk.turnovers++; else mk.otherCleans++ }
              }
              mk.supportJobs += support.length
            } else {
              // On today, but not on a clean. Named on one line, not given a card.
              mk.support.push({ person: p.name, n: support.length })
              mk.supportJobs += support.length
            }
          } else if (/work|on.?call/i.test(String((p.roster || {})[d.date] || ''))) {
            // On the roster, nothing on their day — the free capacity a supervisor is looking for.
            mk.alsoOn.push(p.name)
          }
        }
      }
    }
    for (const markets of Array.from(m.values())) {
      markets.sort((a, b2) => b2.turnovers - a.turnovers || a.market.localeCompare(b2.market))
      for (const mk of markets) {
        mk.rows.sort((a, b2) => b2.turnovers - a.turnovers || b2.cleans.length - a.cleans.length || a.person.localeCompare(b2.person))
        mk.support.sort((a, b2) => b2.n - a.n || a.person.localeCompare(b2.person))
      }
    }
    return m
  }, [days, scoped])

  const countOf = (date: string) => {
    const markets = byDate.get(date) || []
    let turnovers = 0, otherCleans = 0, cleaners = 0, support = 0, free = 0
    for (const mk of markets) {
      turnovers += mk.turnovers; otherCleans += mk.otherCleans
      cleaners += mk.rows.length; support += mk.support.length; free += mk.alsoOn.length
    }
    return { turnovers, otherCleans, cleaners, support, free, markets: markets.filter(mk => mk.rows.length || mk.support.length || mk.alsoOn.length) }
  }

  const [picked, setPicked] = useState<string>(() => (days.find(d => d.today) || days[0] || { date: '' }).date)
  const day = days.find(d => d.date === picked) || days[0]
  if (!day) return null
  const c = countOf(day.date)
  const label = dept === 'maintenance' ? 'work order' : 'clean'
  const busiest = Math.max(1, ...c.markets.flatMap(mk => mk.rows.map(r => r.cleans.length)))

  return (
    <div className="space-y-3">
      {/* ── THE FORTNIGHT, ONE TAP PER DAY ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
        <div className="flex overflow-x-auto">
          {days.map(d => {
            const n = countOf(d.date)
            const on = d.date === day.date
            return (
              <button key={d.date} onClick={() => setPicked(d.date)}
                className={'shrink-0 w-[64px] py-2.5 text-center border-r border-line last:border-r-0 transition ' +
                  (on ? 'bg-ink' : d.weekend ? 'bg-app/50 hover:bg-app' : 'hover:bg-app/60')}>
                <span className={'block text-[10px] font-bold uppercase tracking-wide ' + (on ? 'text-white/60' : d.today ? 'text-brand-600' : 'text-muted')}>
                  {dowOf(d.date)}
                </span>
                <span className={'block text-[11px] tabular-nums ' + (on ? 'text-white/50' : 'text-muted/70')}>{dayNum(d.date)}</span>
                <span className={'block text-[18px] font-bold tabular-nums leading-tight mt-0.5 ' +
                  (on ? 'text-white' : n.turnovers ? 'text-ink' : 'text-line')}>
                  {n.turnovers || '—'}
                </span>
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

      {/* ── THE WHOLE PORTFOLIO FOR THIS DAY ──────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
        <div className="px-5 py-4 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-bold text-muted">{longDay(day.date)}{day.today ? ' · today' : ''}</p>
            <p className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[34px] font-bold text-ink leading-none tabular-nums">{c.turnovers}</span>
              <span className="text-[14px] font-semibold text-muted">{label}{c.turnovers === 1 ? '' : 's'}</span>
            </p>
            <p className="text-[12px] text-muted mt-1">
              across {c.cleaners} {c.cleaners === 1 ? 'cleaner' : 'cleaners'}
              {c.otherCleans ? ' · ' + c.otherCleans + ' other clean' + (c.otherCleans === 1 ? '' : 's') : ''}
              {c.support ? ' · ' + c.support + ' on support work' : ''}
              {c.free ? ' · ' + c.free + ' free' : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {c.markets.map(mk => (
              <div key={mk.market} className="rounded-xl bg-app px-3 py-2 min-w-[92px]">
                <p className="text-[10.5px] uppercase tracking-wide font-bold text-muted">{mk.market}</p>
                <p className="text-[19px] font-bold text-ink tabular-nums leading-tight">{mk.turnovers}</p>
                <p className="text-[11px] text-muted">{mk.rows.length} cleaning{mk.alsoOn.length ? ' · ' + mk.alsoOn.length + ' free' : ''}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── EACH MARKET, PERSON BY PERSON ─────────────────────────────────────────────────── */}
      {!c.markets.length ? (
        <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-10 text-center">
          <p className="text-[13px] text-muted">Nothing assigned on this day.</p>
          <p className="text-[11.5px] text-muted/80 mt-1">Work with nobody on it yet never reaches this board — check the schedule to hand it out.</p>
        </div>
      ) : c.markets.map(mk => (
        <section key={mk.market} className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
          <header className="px-5 py-3 border-b border-line flex items-baseline gap-2.5 flex-wrap">
            <h3 className="text-[15px] font-bold text-ink tracking-tight">{mk.market}</h3>
            <span className="text-[12px] text-muted tabular-nums">
              {mk.turnovers} {label}{mk.turnovers === 1 ? '' : 's'}
              {mk.otherCleans ? ' · ' + mk.otherCleans + ' other clean' : ''} · {mk.rows.length} {mk.rows.length === 1 ? 'cleaner' : 'cleaners'}
            </span>
          </header>

          {!mk.rows.length ? (
            <p className="px-5 py-5 text-[12.5px] text-muted">No cleans assigned in {mk.market} on this day.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 divide-y md:divide-y-0 divide-line">
              {mk.rows.map((r, idx) => {
                const done = r.cleans.filter(j => j.status === 'done').length
                const heavy = r.cleans.length >= 6
                return (
                  <article key={r.person}
                    className={'px-4 py-3.5 min-w-0 ' + (idx % 2 === 1 ? 'md:border-l md:border-line' : '') + ' xl:border-l xl:border-line xl:first:border-l-0'}>
                    <div className="flex items-center gap-2.5">
                      <span className={'h-9 w-9 shrink-0 rounded-full grid place-items-center text-[11.5px] font-bold ' +
                        (heavy ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100')}>
                        {initials(r.person)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-bold text-ink truncate leading-tight">{r.person}</p>
                        <p className="text-[11px] text-muted">
                          {r.turnovers} turnover{r.turnovers === 1 ? '' : 's'}
                          {r.cleans.length - r.turnovers ? ' · ' + (r.cleans.length - r.turnovers) + ' other clean' : ''}
                          {done ? ' · ' + done + ' done' : ''}
                        </p>
                      </div>
                      <span className={'text-[22px] font-bold tabular-nums leading-none ' + (heavy ? 'text-amber-700' : 'text-ink')}>{r.cleans.length}</span>
                    </div>

                    {/* Load against the busiest person on the board today. */}
                    <div className="h-1.5 rounded-full bg-app mt-2.5 overflow-hidden">
                      <div className={'h-full rounded-full ' + (heavy ? 'bg-amber-400' : 'bg-brand-400')}
                        style={{ width: Math.round((r.cleans.length / busiest) * 100) + '%' }} />
                    </div>

                    <ul className="mt-2.5 space-y-1.5">
                      {r.cleans.slice().sort((a, b2) => Number(!!b2.departure) - Number(!!a.departure)).map((j, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[12.5px] min-w-0">
                          {j.status === 'done'
                            ? <Check size={12} className="text-emerald-600 mt-0.5 shrink-0" />
                            : j.departure
                              ? <Sparkles size={12} className="text-brand-500 mt-0.5 shrink-0" />
                              : <Wrench size={12} className="text-muted/50 mt-0.5 shrink-0" />}
                          <span className="min-w-0 flex-1">
                            <span className={'font-semibold ' + (j.status === 'done' ? 'text-muted line-through decoration-line' : 'text-ink')}>{j.unit}</span>
                            {!j.departure ? <span className="text-[11px] text-muted"> · {j.task}</span> : null}
                            {j.status === 'in progress' ? <span className="text-[10px] font-bold uppercase text-sky-700 ml-1">started</span> : null}
                            {(mk.crewOn[keyOf(j)] || 1) > 1 ? (
                              <span className="ml-1 text-[9.5px] font-semibold px-1 py-0.5 rounded ring-1 bg-app text-muted ring-line">{mk.crewOn[keyOf(j)]} on</span>
                            ) : null}
                            {(j.tags || []).map((t: PTag) => (
                              <span key={t.key} className={'ml-1 text-[9.5px] font-semibold px-1 py-0.5 rounded ring-1 ' + (TAG_CHIP[t.tone] || 'bg-app text-muted ring-line')}>{t.label}</span>
                            ))}
                            {canManage && j.id && j.status !== 'done' ? (
                              openFor === j.id ? (
                                <span className="inline-flex items-center gap-1 ml-1 align-middle">
                                  <select autoFocus disabled={saving === j.id} defaultValue=""
                                    onChange={e => { const v = Number(e.target.value); if (v) reassign(j.id as string, v) }}
                                    className="text-[11px] rounded-lg border border-line bg-white px-1 py-0.5 text-ink max-w-[150px]">
                                    <option value="" disabled>{people.length ? 'Move to…' : 'Loading…'}</option>
                                    {people.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
                                  </select>
                                  {saving === j.id
                                    ? <Loader2 size={11} className="animate-spin text-muted" />
                                    : <button onClick={() => setOpenFor('')} className="text-[10.5px] text-muted hover:text-ink">cancel</button>}
                                </span>
                              ) : (
                                <button onClick={() => openReassign(j.id as string)} title="Reassign in Breezeway"
                                  className="ml-1 text-muted/70 hover:text-brand-700 align-middle"><UserCog size={11} /></button>
                              )
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {r.support.length ? (
                      <p className="text-[11px] text-muted mt-2 pt-2 border-t border-line">
                        also: {r.support.map(j => j.task).join(' · ')}
                      </p>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}

          {mk.support.length ? (
            <p className="px-5 py-2.5 border-t border-line bg-app/40 text-[12px] text-muted">
              <b className="text-ink font-semibold">On support work:</b>{' '}
              {mk.support.map(x => x.person + ' (' + x.n + ')').join(' · ')}
            </p>
          ) : null}
          {mk.alsoOn.length ? (
            <p className="px-5 py-2.5 border-t border-line bg-app/40 text-[12px] text-muted">
              <b className="text-ink font-semibold">On, nothing booked:</b> {mk.alsoOn.join(', ')}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  )
}
