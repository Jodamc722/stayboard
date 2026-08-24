'use client'
// THE PLANNER, drawn once and used by both the staff tab and the crew link — so what Jon sees and
// what the team sees can never drift apart.
//
// Rebuilt 2026-08-21 after "still looks so bad", and he was right. The old one was a spreadsheet:
// fourteen columns of identical black number badges, 10px labels, no whitespace, every cell
// shouting equally. Four things changed:
//
//   1. ONE WEEK AT A TIME. Seven columns fit; fourteen never did, so everything was squeezed to
//      44px and overflowed anyway. The second week is one tap away.
//   2. SOFT FILLS, NOT BADGES. A rota is read at a glance — colour should say the state and size
//      should say the load. Indigo means work, green means on, grey means off, empty means nothing
//      set. Nobody has to decode a legend to see the shape of a week.
//   3. ROOM. 64px rows, real gaps between cells, a name column with an initial disc. It reads as
//      blocks of time rather than a table of figures.
//   4. THE DAY DETAIL IS A DAY, NOT A DUMP. One card per day, today open and the rest collapsed,
//      status as a dot rather than sixty repeated DONE chips.
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

export type PTag = { key: string; label: string; tone: 'amber' | 'violet' | 'emerald' | 'sky' }
export type PJob = {
  unit: string; task: string; status: string; isClean?: boolean
  market?: string; url?: string | null; tags?: PTag[]
}
export type PPerson = {
  name: string; dept?: string
  byDay: Record<string, PJob[]>
  roster?: Record<string, string>
  clashes?: Record<string, string>
  unrostered?: boolean
  daysWorked?: number; daysOn?: number; jobs?: number; cleans?: number
}
export type PDay = { date: string; dow: string; weekend: boolean; today: boolean }
export type PBlock = {
  market: string; people: PPerson[]
  perDay?: Record<string, { jobs: number; cleans: number; people: number }>
  jobs?: number; cleans?: number
}

const TAG_DOT: Record<string, string> = {
  amber: 'bg-amber-400', violet: 'bg-violet-400', emerald: 'bg-emerald-400', sky: 'bg-sky-400',
}
const TAG_CHIP: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  sky: 'bg-sky-50 text-sky-800 ring-sky-200',
}

function initials(name: string): string {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '?'
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}
function longDay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** What a single day looks like for one person. The whole visual language lives here. */
function cellOf(jobs: PJob[], status: string, dept: string) {
  const n = jobs.length
  if (n) {
    const cleans = jobs.filter(j => j.isClean).length
    return {
      wrap: 'bg-brand-50 ring-1 ring-brand-100',
      big: String(n),
      bigCls: 'text-brand-800',
      small: dept === 'maintenance' ? (n === 1 ? 'order' : 'orders') : (cleans ? (cleans === 1 ? 'clean' : 'cleans') : 'jobs'),
      smallCls: 'text-brand-600/80',
    }
  }
  if (/^working$/i.test(status)) return { wrap: 'bg-emerald-50 ring-1 ring-emerald-100', big: 'On', bigCls: 'text-emerald-700 text-[15px]', small: 'nothing yet', smallCls: 'text-emerald-600/70' }
  if (/on.?call/i.test(status)) return { wrap: 'bg-sky-50 ring-1 ring-sky-100', big: 'On call', bigCls: 'text-sky-700 text-[13px]', small: '', smallCls: '' }
  if (/^off|req/i.test(status)) return { wrap: 'bg-app ring-1 ring-line', big: 'Off', bigCls: 'text-muted/70 text-[13px]', small: '', smallCls: '' }
  return null
}

export function PlannerView({ days, blocks, dept, showLinks, marketFilter }: {
  days: PDay[]
  blocks: PBlock[]
  dept: 'cleaning' | 'maintenance' | 'all'
  /** Breezeway links only belong on the maintenance planner — a cleaner has no login. */
  showLinks?: boolean
  marketFilter?: string
}) {
  const [week, setWeek] = useState(0)
  const [openDay, setOpenDay] = useState<string>(() => (days.find(d => d.today) || days[0] || { date: '' }).date)

  const weeks = Math.max(1, Math.ceil(days.length / 7))
  const shown = useMemo(() => days.slice(week * 7, week * 7 + 7), [days, week])
  const list = useMemo(
    () => (!marketFilter || marketFilter === 'all' ? blocks : blocks.filter(b => b.market.toLowerCase() === marketFilter)),
    [blocks, marketFilter])

  if (!shown.length) return null
  const from = shown[0], to = shown[shown.length - 1]

  return (
    <div className="space-y-5">
      {/* which week */}
      {weeks > 1 ? (
        <div className="flex items-center gap-2">
          <button onClick={() => setWeek(w => Math.max(0, w - 1))} disabled={week === 0}
            className="h-9 w-9 grid place-items-center rounded-xl border border-line bg-white text-muted hover:text-ink disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          <div className="px-3">
            <p className="text-[13.5px] font-bold text-ink leading-tight">
              {week === 0 ? 'This week' : week === 1 ? 'Next week' : 'Week ' + (week + 1)}
            </p>
            <p className="text-[11.5px] text-muted">{longDay(from.date)} — {longDay(to.date)}</p>
          </div>
          <button onClick={() => setWeek(w => Math.min(weeks - 1, w + 1))} disabled={week >= weeks - 1}
            className="h-9 w-9 grid place-items-center rounded-xl border border-line bg-white text-muted hover:text-ink disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}

      {list.map(b => {
        const people = b.people.filter(p => (p.jobs || 0) > 0 || Object.keys(p.roster || {}).length > 0)
        const quiet = b.people.length - people.length
        return (
          <section key={b.market} className="rounded-2xl bg-white ring-1 ring-line overflow-hidden">
            <header className="px-5 py-4 flex items-baseline gap-3 flex-wrap">
              <h3 className="text-[17px] font-bold text-ink tracking-tight">{b.market}</h3>
              <p className="text-[12.5px] text-muted">
                {people.length} on the schedule
                {dept === 'maintenance' ? ' · ' + (b.jobs || 0) + ' work orders' : ' · ' + (b.cleans || 0) + ' cleans'}
              </p>
            </header>

            {!people.length ? (
              <p className="px-5 pb-6 text-[13px] text-muted">Nothing scheduled here for this week.</p>
            ) : (
              <div className="overflow-x-auto pb-1">
                <div className="min-w-[720px] px-5 pb-5">
                  {/* day headings */}
                  <div className="grid gap-1.5 mb-2" style={{ gridTemplateColumns: '168px repeat(7, minmax(0,1fr))' }}>
                    <div />
                    {shown.map(d => (
                      <div key={d.date} className="text-center">
                        <p className={'text-[10.5px] font-bold uppercase tracking-wider ' + (d.today ? 'text-brand-700' : 'text-muted/70')}>{d.dow}</p>
                        <p className={
                          'text-[13px] font-bold tabular-nums mt-0.5 mx-auto w-7 h-7 grid place-items-center rounded-full ' +
                          (d.today ? 'bg-ink text-white' : 'text-ink/70')
                        }>{d.date.slice(8)}</p>
                      </div>
                    ))}
                  </div>

                  {/* one row per person */}
                  <div className="space-y-1.5">
                    {people.map(p => (
                      <div key={p.name} className="grid gap-1.5 items-stretch" style={{ gridTemplateColumns: '168px repeat(7, minmax(0,1fr))' }}>
                        <div className="flex items-center gap-2.5 pr-2 min-w-0">
                          <span className="h-8 w-8 shrink-0 rounded-full bg-app ring-1 ring-line grid place-items-center text-[11px] font-bold text-muted">
                            {initials(p.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold text-ink leading-tight truncate">{p.name}</span>
                            <span className="block text-[11px] text-muted truncate">
                              {(p.daysOn || p.daysWorked || 0) + 'd'}
                              {dept === 'maintenance' ? ' · ' + (p.jobs || 0) + ' orders' : ' · ' + (p.cleans || 0) + ' cleans'}
                              {p.unrostered ? ' · off roster' : ''}
                            </span>
                          </span>
                        </div>

                        {shown.map(d => {
                          const jobs = p.byDay[d.date] || []
                          const st = String((p.roster || {})[d.date] || '')
                          const c = cellOf(jobs, st, dept)
                          const clash = String((p.clashes || {})[d.date] || '')
                          const seen: Record<string, boolean> = {}
                          const dots = jobs.reduce((a: PTag[], j) => a.concat(j.tags || []), [])
                            .filter(t => (seen[t.key] ? false : (seen[t.key] = true)))
                          return (
                            <button key={d.date} type="button"
                              onClick={() => setOpenDay(d.date)}
                              title={jobs.length ? jobs.map(j => j.unit + ' — ' + j.task).join('\n') : (st || 'Nothing set')}
                              className={
                                'rounded-xl min-h-[62px] px-1 py-2 text-center transition ' +
                                (c ? c.wrap : 'ring-1 ring-line/60 bg-white hover:bg-app/60') +
                                (clash ? ' ring-2 ring-amber-300' : '') +
                                (d.today && !c ? ' bg-app/40' : '')
                              }>
                              {c ? (
                                <>
                                  <span className={'block font-bold leading-none text-[19px] tabular-nums ' + c.bigCls}>{c.big}</span>
                                  {c.small ? <span className={'block text-[10px] mt-1 ' + c.smallCls}>{c.small}</span> : null}
                                </>
                              ) : (
                                <span className="block text-[13px] text-line">·</span>
                              )}
                              {dots.length ? (
                                <span className="flex justify-center gap-1 mt-1.5">
                                  {dots.slice(0, 4).map(t => (
                                    <span key={t.key} title={t.label} className={'w-1.5 h-1.5 rounded-full ' + (TAG_DOT[t.tone] || 'bg-line')} />
                                  ))}
                                </span>
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>

                  {quiet ? (
                    <p className="text-[11.5px] text-muted mt-3">
                      {quiet} more on this roster with no days marked.
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {/* the day, in full */}
            <div className="border-t border-line bg-app/40">
              {shown.map(d => {
                const rows = b.people
                  .map(p => ({ p, jobs: p.byDay[d.date] || [] }))
                  .filter(r => r.jobs.length)
                const alsoOn = b.people.filter(p =>
                  !(p.byDay[d.date] || []).length && /work|on.?call/i.test(String((p.roster || {})[d.date] || '')))
                const total = rows.reduce((a, r) => a + r.jobs.length, 0)
                const open = openDay === d.date
                if (!rows.length && !alsoOn.length) return null
                return (
                  <div key={d.date} className="border-b border-line last:border-b-0">
                    <button onClick={() => setOpenDay(open ? '' : d.date)}
                      className="w-full px-5 py-3 flex items-center gap-2.5 text-left hover:bg-white/60">
                      <ChevronDown size={15} className={'text-muted transition ' + (open ? '' : '-rotate-90')} />
                      <span className={'text-[13.5px] font-bold ' + (d.today ? 'text-ink' : 'text-ink/80')}>
                        {longDay(d.date)}{d.today ? ' · today' : ''}
                      </span>
                      <span className="text-[12px] text-muted ml-auto">
                        {total ? total + (dept === 'maintenance' ? ' orders' : ' jobs') + ' · ' + rows.length + ' on' : alsoOn.length + ' on, nothing booked'}
                      </span>
                    </button>

                    {open ? (
                      <div className="px-5 pb-4 space-y-3.5">
                        {rows.map(r => (
                          <div key={r.p.name}>
                            <p className="text-[12px] font-bold text-muted uppercase tracking-wider mb-1.5">{r.p.name}</p>
                            <ul className="space-y-1">
                              {r.jobs.map((j, i) => (
                                <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                                  <span title={j.status} className={
                                    'mt-[7px] h-1.5 w-1.5 rounded-full shrink-0 ' +
                                    (j.status === 'done' ? 'bg-emerald-400' : j.status === 'in progress' ? 'bg-amber-400' : 'bg-line')
                                  } />
                                  <span className="min-w-0">
                                    <span className="font-semibold text-ink">{j.unit}</span>
                                    <span className="text-muted"> — {j.task}</span>
                                    {(j.tags || []).map(t => (
                                      <span key={t.key} className={'ml-1.5 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded-md ring-1 ' + (TAG_CHIP[t.tone] || 'bg-app text-muted ring-line')}>{t.label}</span>
                                    ))}
                                    {showLinks && j.url ? (
                                      <a href={j.url} target="_blank" rel="noreferrer"
                                        className="ml-1.5 align-middle text-[11px] font-bold text-brand-700 hover:underline inline-flex items-center gap-0.5">
                                        Breezeway <ExternalLink size={10} />
                                      </a>
                                    ) : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        {alsoOn.length ? (
                          <p className="text-[12px] text-muted">
                            Also on: {alsoOn.map(p => p.name).join(', ')} — nothing booked in yet.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
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

/** The four states, named. Small enough to sit under the grid without competing with it. */
export function PlannerLegend({ dept }: { dept: 'cleaning' | 'maintenance' | 'all' }) {
  const Item = ({ cls, label }: { cls: string; label: string }) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={'h-3.5 w-5 rounded-md ' + cls} />
      <span className="text-[11.5px] text-muted">{label}</span>
    </span>
  )
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <Item cls="bg-brand-50 ring-1 ring-brand-100" label={dept === 'maintenance' ? 'work orders booked' : 'cleans booked'} />
      <Item cls="bg-emerald-50 ring-1 ring-emerald-100" label="working, nothing yet" />
      <Item cls="bg-sky-50 ring-1 ring-sky-100" label="on call" />
      <Item cls="bg-app ring-1 ring-line" label="off" />
    </div>
  )
}
