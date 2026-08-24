'use client'
// THE WEEKLY PLANNER (Jon, 2026-08-21). Two views of one payload, because he asked for both:
//   PLANNER — person x day. Who is on this week and how loaded each day is.
//   DAY     — one day, broken down by person. What everybody is actually doing.
// Both are grouped BY MARKET, and both carry the same tags the day sheet uses, so a supervisor can
// plan the day off this screen instead of cross-referencing three others.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ChevronLeft, ChevronRight, CalendarDays, Users, RefreshCw } from 'lucide-react'

type Tag = { key: string; label: string; tone: 'amber' | 'violet' | 'emerald' | 'sky' }
type Job = { id: string; url: string; reportUrl: string | null; date: string; unit: string; market: string; task: string; dept: string; status: string; isClean: boolean; tags: Tag[] }
type Person = {
  name: string; dept: string; byDay: Record<string, Job[]>
  roster: Record<string, string>; clashes: Record<string, string>; unrostered: boolean
  daysWorked: number; daysOn: number; jobs: number; cleans: number
}
type MarketBlock = { market: string; people: Person[]; perDay: Record<string, { jobs: number; cleans: number; people: number }>; jobs: number; cleans: number }
type Day = { date: string; dow: string; weekend: boolean; today: boolean }
type Data = {
  from: string; to: string; days: Day[]; markets: MarketBlock[]
  rules: { longStayNights: number; bigBookingUsd: number }
  counts: { tasksRead: number; vendorDropped: number; unassignedDropped: number; rosterWeeks: number; clashes: number }
}

const TONE: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800',
  violet: 'bg-violet-100 text-violet-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  sky: 'bg-sky-100 text-sky-800',
}
const DOT: Record<string, string> = {
  amber: 'bg-amber-500', violet: 'bg-violet-500', emerald: 'bg-emerald-500', sky: 'bg-sky-500',
}
// The roster statuses come from the Turnover Schedule, so the colours match what people already
// read there: on = green, on call = sky, off = flat grey.
const ROSTER: Record<string, { cell: string; pill: string; short: string }> = {
  'Working':  { cell: 'bg-emerald-50', pill: 'bg-emerald-500 text-white', short: 'W' },
  'On Call':  { cell: 'bg-sky-50',     pill: 'bg-sky-500 text-white',     short: 'OC' },
  'OFF':      { cell: 'bg-neutral-100/70', pill: 'bg-neutral-300 text-white', short: 'OFF' },
  'REQ OFF':  { cell: 'bg-neutral-100/70', pill: 'bg-neutral-300 text-white', short: 'REQ' },
}
const STATUS_SHORT: Record<string, string> = { 'Working': 'working', 'On Call': 'on call', 'OFF': 'off', 'REQ OFF': 'req off' }
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function addDays(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function pretty(iso: string): string { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) }

function TagChip({ t }: { t: Tag }) {
  return <span className={'text-[9.5px] font-bold px-1.5 py-0.5 rounded ' + (TONE[t.tone] || 'bg-app text-muted')}>{t.label}</span>
}

export function TeamPlanner() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [from, setFrom] = useState(todayET())
  const [view, setView] = useState<'planner' | 'day'>('planner')
  const [market, setMarket] = useState('all')
  const [dept, setDept] = useState<'cleaning' | 'maintenance'>('cleaning')
  const [day, setDay] = useState(todayET())

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/team-schedule?days=14&dept=' + dept + '&from=' + from, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || j?.message || 'Could not load the planner.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [from, dept])
  useEffect(() => { load() }, [load])

  const blocks = useMemo(() => {
    if (!data) return []
    return market === 'all' ? data.markets : data.markets.filter(m => m.market.toLowerCase() === market)
  }, [data, market])

  if (!data && busy) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Building the planner…</div>
  if (err && !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div>
  if (!data) return null

  const marketNames = data.markets.map(m => m.market)

  return (
    <div className="space-y-4">
      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden">
          <button onClick={() => setView('planner')} className={'text-[12.5px] font-semibold px-3 py-1.5 inline-flex items-center gap-1.5 ' + (view === 'planner' ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}><Users size={13} /> Planner</button>
          <button onClick={() => setView('day')} className={'text-[12.5px] font-semibold px-3 py-1.5 inline-flex items-center gap-1.5 border-l border-line ' + (view === 'day' ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}><CalendarDays size={13} /> Day</button>
        </div>

        <div className="inline-flex rounded-xl border border-line overflow-hidden">
          <button onClick={() => setDept('cleaning')} className={'text-[12.5px] font-semibold px-3 py-1.5 ' + (dept === 'cleaning' ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>Cleaning</button>
          <button onClick={() => setDept('maintenance')} className={'text-[12.5px] font-semibold px-3 py-1.5 border-l border-line ' + (dept === 'maintenance' ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>Maintenance</button>
        </div>

        <button onClick={() => setMarket('all')} className={'text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (market === 'all' ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>All markets</button>
        {marketNames.map(m => (
          <button key={m} onClick={() => setMarket(m.toLowerCase())} className={'text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg border ' + (market === m.toLowerCase() ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line')}>{m}</button>
        ))}

        <div className="flex-1" />

        {view === 'planner' ? (
          <div className="inline-flex items-center gap-1">
            <button onClick={() => setFrom(addDays(from, -7))} className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ChevronLeft size={14} /></button>
            <span className="text-[12px] font-semibold text-muted tabular-nums px-1">{data.from} → {data.to}</span>
            <button onClick={() => setFrom(addDays(from, 7))} className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ChevronRight size={14} /></button>
            {from !== todayET() ? <button onClick={() => setFrom(todayET())} className="text-[12px] font-semibold px-2 py-1.5 rounded-lg border border-line bg-white text-ink">Today</button> : null}
          </div>
        ) : (
          <div className="inline-flex items-center gap-1">
            <button onClick={() => setDay(addDays(day, -1))} className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ChevronLeft size={14} /></button>
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="text-[12.5px] border border-line rounded-lg px-2 py-1 bg-white" />
            <button onClick={() => setDay(addDays(day, 1))} className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink"><ChevronRight size={14} /></button>
          </div>
        )}
        <button onClick={load} disabled={busy} className="p-1.5 rounded-lg border border-line bg-white text-muted hover:text-ink disabled:opacity-40"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /></button>
      </div>

      {/* ── PLANNER: person x day ─────────────────────────────────────────────────────────── */}
      {view === 'planner' && blocks.map(b => (
        <div key={b.market} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-ink">{b.market}</p>
            <span className="text-[11.5px] text-muted">{b.people.length} on the schedule · {b.cleans} cleans · {b.jobs} jobs</span>
          </div>
          {(() => { const shown = b.people.filter(p => p.jobs > 0 || Object.keys(p.roster).length > 0); const quiet = b.people.length - shown.length; return (
          !shown.length ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted">
              Nothing set for this market in the window.
              {quiet ? ' ' + quiet + ' on the roster with no days marked — set them on the Turnover Schedule.' : ''}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 border-b border-line min-w-[150px]">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-muted">Who</span>
                    </th>
                    {data.days.map(d => (
                      <th key={d.date} className={'px-1.5 py-2 border-b border-line text-center min-w-[52px] ' + (d.weekend ? 'bg-app/60' : '')}>
                        <span className={'block text-[10px] font-bold uppercase ' + (d.today ? 'text-ink' : 'text-muted')}>{d.dow}</span>
                        <span className={'block text-[11px] tabular-nums ' + (d.today ? 'font-bold text-ink' : 'text-faint')}>{d.date.slice(8)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(p => (
                    <tr key={p.name} className="hover:bg-app/40">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-line">
                        <p className="text-[13px] font-semibold text-ink leading-tight">
                          {p.name}
                          {p.unrostered ? <span title="Has work assigned but is not on this market's roster" className="ml-1.5 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-amber-100 text-amber-800">off roster</span> : null}
                        </p>
                        <p className="text-[10.5px] text-muted">{p.dept} · {p.daysOn ? p.daysOn + 'd on' : p.daysWorked + 'd'} · {p.cleans} cleans</p>
                      </td>
                      {data.days.map(d => {
                        const jobs = p.byDay[d.date] || []
                        const cleans = jobs.filter(j => j.isClean).length
                        const seen: Record<string, boolean> = {}
                        const dots = jobs.reduce((a: Tag[], j) => a.concat(j.tags), [])
                          .filter(t => (seen[t.key] ? false : (seen[t.key] = true)))
                        const st = p.roster[d.date] || ''
                        const clash = p.clashes[d.date] || ''
                        const r = ROSTER[st]
                        const tip = [
                          st ? 'Roster: ' + st : 'Not on the roster this day',
                          clash === 'off-but-assigned' ? 'Marked off but has work assigned.' : clash === 'on-but-empty' ? 'Marked working with nothing assigned.' : '',
                          ...jobs.map(j => j.unit + ' — ' + j.task),
                        ].filter(Boolean).join('\n')
                        return (
                          <td key={d.date} className={'px-1 py-1.5 border-b border-line text-center align-top ' + (d.weekend ? 'bg-app/40' : '')}>
                            <div title={tip}
                              className={'rounded-lg py-1.5 px-1 min-h-[38px] ' + (r ? r.cell : '') +
                                (clash ? ' ring-2 ring-amber-400' : '')}>
                              {jobs.length ? (
                                <>
                                  <span className="inline-block min-w-[26px] rounded-md bg-ink text-white text-[12px] font-bold leading-none px-1.5 py-1 tabular-nums">{jobs.length}</span>
                                  <span className="block text-[9px] leading-tight mt-0.5 text-muted">{st ? STATUS_SHORT[st] || st : (cleans ? 'clean' : 'job')}</span>
                                </>
                              ) : (
                                <span className={'inline-block min-w-[26px] rounded-md text-[10px] font-bold leading-none px-1.5 py-1 ' + (r ? r.pill : 'text-faint')}>
                                  {r ? r.short : '·'}
                                </span>
                              )}
                              {dots.length ? (
                                <span className="flex justify-center gap-0.5 mt-1">
                                  {dots.slice(0, 4).map(t => <span key={t.key} title={t.label} className={'w-1.5 h-1.5 rounded-full ' + (DOT[t.tone] || 'bg-line')} />)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="bg-app/60">
                    <td className="sticky left-0 z-10 bg-app/60 px-3 py-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Market total</span>
                    </td>
                    {data.days.map(d => {
                      const pd = b.perDay[d.date] || { jobs: 0, cleans: 0, people: 0 }
                      return (
                        <td key={d.date} className="px-1 py-2 text-center">
                          <span className="block text-[12px] font-bold tabular-nums text-ink">{pd.cleans}</span>
                          <span className="block text-[9px] text-muted">{pd.people} on</span>
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
              {quiet ? (
                <p className="px-4 py-2 text-[11px] text-muted border-t border-line">
                  {quiet} more on this roster with no days marked for the fortnight.
                </p>
              ) : null}
            </div>
          )) })()}
        </div>
      ))}

      {/* ── DAY: the daily assignments ────────────────────────────────────────────────────── */}
      {view === 'day' && (
        <div className="space-y-4">
          <p className="text-[13px] font-bold text-ink">{pretty(day)}</p>
          {blocks.map(b => {
            const working = b.people.filter(p => (p.byDay[day] || []).length > 0)
            // Rostered on, nothing assigned. The single most useful thing this view can tell a
            // supervisor at 8am, and neither the schedule nor Breezeway shows it on its own.
            const idle = b.people.filter(p => (p.byDay[day] || []).length === 0 && /work|on.?call/i.test(p.roster[day] || ''))
            const pd = b.perDay[day] || { jobs: 0, cleans: 0, people: 0 }
            return (
              <div key={b.market} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-ink">{b.market}</p>
                  <span className="text-[11.5px] text-muted">{working.length} on · {pd.cleans} cleans · {pd.jobs} jobs</span>
                </div>
                {idle.length ? (
                  <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
                    <p className="text-[12px] text-amber-900">
                      <span className="font-bold">On the roster with nothing assigned:</span>{' '}
                      {idle.map(p => p.name + (/on.?call/i.test(p.roster[day] || '') ? ' (on call)' : '')).join(', ')}
                    </p>
                  </div>
                ) : null}
                {!working.length ? (
                  <p className="px-4 py-6 text-center text-[12.5px] text-muted">Nobody assigned in {b.market} on this day.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {working.map(p => (
                      <div key={p.name} className="px-4 py-3">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="text-[13.5px] font-bold text-ink">{p.name}</p>
                          <span className="text-[11px] text-muted">{p.dept} · {(p.byDay[day] || []).length} jobs</span>
                          {p.roster[day] ? <span className={'text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded ' + (/^off|req/i.test(p.roster[day]) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>{p.roster[day]}</span> : null}
                          {p.clashes[day] === 'off-but-assigned' ? <span className="text-[10px] font-semibold text-amber-700">marked off but has work</span> : null}
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {(p.byDay[day] || []).map(j => (
                            <div key={j.id} className="flex items-center gap-2 flex-wrap text-[12.5px]">
                              <span className={'text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                                (j.status === 'done' ? 'bg-emerald-100 text-emerald-700' : j.status === 'in progress' ? 'bg-amber-100 text-amber-800' : 'bg-app text-muted')}>{j.status}</span>
                              <span className="font-semibold text-ink">{j.unit}</span>
                              {j.market && j.market.toLowerCase() !== b.market.toLowerCase() ? (
                                <span title="This unit is in another market — a vendor-serviced one this person is covering"
                                  className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">{j.market}</span>
                              ) : null}
                              <span className="text-muted">{j.task}</span>
                              {dept === 'maintenance' && j.url ? (
                                <a href={j.url} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-700 underline">Breezeway ↗</a>
                              ) : null}
                              {j.tags.map(t => <TagChip key={t.key} t={t} />)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="px-1 rounded bg-emerald-500 text-white text-[9px] font-bold">W</span> working</span>
        <span className="inline-flex items-center gap-1"><span className="px-1 rounded bg-sky-500 text-white text-[9px] font-bold">OC</span> on call</span>
        <span className="inline-flex items-center gap-1"><span className="px-1 rounded bg-neutral-300 text-white text-[9px] font-bold">OFF</span> off</span>
        <span className="inline-flex items-center gap-1"><span className="px-1 rounded bg-ink text-white text-[9px] font-bold">3</span> jobs booked</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded ring-2 ring-amber-400" /> Roster and work disagree</span>
        {data.counts.clashes ? <span className="font-semibold text-amber-700">{data.counts.clashes} to look at</span> : null}
        {!data.counts.rosterWeeks ? <span className="font-semibold text-amber-700">No roster saved for these weeks — set it on the Turnover Schedule.</span> : null}
      </div>

      <p className="text-[11.5px] text-muted">
        Days on and off come from the roster you keep on the Turnover Schedule; the numbers are the work
        actually assigned in Breezeway. Vendor-serviced markets do not get their own block — their work
        only shows when one of our rostered people is on it, and it lands on that person's own row.
        Long stay is {data.rules.longStayNights}+ nights and a big arrival is ${data.rules.bigBookingUsd.toLocaleString()}+ —
        both read from your own settings at Users → Task automation, so this screen, Slack and the ops brief
        always agree. Vendor-building work only appears when one of our people is assigned to it.
        {data.counts.unassignedDropped ? ' ' + data.counts.unassignedDropped + ' job' + (data.counts.unassignedDropped === 1 ? ' has' : 's have') + ' nobody assigned yet — pick them up on the Turnover Schedule.' : ''}
      </p>
    </div>
  )
}
