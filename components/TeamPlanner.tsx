'use client'
// THE WEEKLY PLANNER — the in-app tab. Jon, 2026-08-21: "should look much nicer."
//
// Everything visual now lives in <PlannerView>, which the crew share links use too, so the screen
// Jon plans on and the page the team opens on their phone are the same drawing. This file is only
// the controls around it: which trade, which market, which fortnight, and refresh.
//
// The old Planner|Day toggle is gone on purpose. It existed because the grid could not show the
// work — you saw "3" and had to switch views to learn what the 3 were. In the new view every day
// opens in place, so there is nothing to switch to.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, ChevronLeft, ChevronRight, RefreshCw, Wand2 } from 'lucide-react'
import { LeanHead, Pill, IconBtn } from './lean'
import { WeekSuggester } from '@/components/WeekSuggester'
import { PlannerView, PlannerLegend, type PDay, type PBlock, type PGroup } from './PlannerView'
import { type ScheduleLaborData } from './ScheduleLaborStrip'
import { DayCleans, type DayStaffing } from './DayCleans'
import { Tag } from './lean'

type Data = {
  from: string; to: string; days: PDay[]; markets: PBlock[]
  rules: { longStayNights: number; bigBookingUsd: number }
  counts: { tasksRead: number; vendorDropped: number; unassignedDropped: number; rosterWeeks: number; clashes: number }
  labor?: ScheduleLaborData | null
}

const GROUPS: { key: PGroup; label: string }[] = [
  { key: 'team', label: 'All team' },
  { key: 'market', label: 'By market' },
  { key: 'cleaner', label: 'By cleaner' },
]

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
const niceRange = (a: string, b: string) => { const f = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(d + 'T12:00:00Z')); return f(a) + ' – ' + f(b) }
function addDays(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export function TeamPlanner() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [from, setFrom] = useState(todayET())
  const [to, setTo] = useState(addDays(todayET(), 13))
  const [market, setMarket] = useState('all')
  const [dept, setDept] = useState<'cleaning' | 'maintenance'>('cleaning')
  // ALL TEAM FIRST (Jon, 2026-09-09): the review question is "how does the week look across both
  // markets", and splitting by market was answering a question nobody opened this page to ask.
  const [group, setGroup] = useState<PGroup>('team')
  // In-house is the board. Vendor-serviced buildings are somebody else's crew and get their own tab.
  const [crew, setCrew] = useState<'inhouse' | 'vendor'>('inhouse')
  // The cleans are the page; the calendar is a second view of the same day, not a second half of it.
  const [view, setView] = useState<'cleans' | 'calendar'>('cleans')
  // SUGGEST THE WEEK (Jon, 2026-09-28): Eve's plan per day for this range, approvable a day at a time.
  const [suggest, setSuggest] = useState(false)

  // THE STAFFING FORECAST, read once and folded INTO the day strip (Jon, 2026-10-02: the page had the
  // same fourteen days drawn three times — a pill row, a table and the picker). One drawing now.
  const [fc, setFc] = useState<{ days: any[]; rosterPublishedThrough?: string | null } | null>(null)
  useEffect(() => { let dead = false; fetch('/api/forecast/staffing', { cache: 'no-store' }).then(r => r.json()).then(j => { if (!dead && j && j.ok) setFc(j) }).catch(() => {}); return () => { dead = true } }, [])
  const staffing = useMemo(() => {
    const out: Record<string, DayStaffing> = {}
    if (!fc) return out
    for (const d of fc.days as any[]) {
      if (market !== 'all' && String(d.market || '').toLowerCase() !== market) continue
      const cur = out[d.date] || { verdict: 'none' as DayStaffing['verdict'], short: 0, line: '' }
      const shortBy = d.verdict === 'short' ? Math.max(0, Number(d.needed || 0) - Number(d.rostered || 0)) : 0
      const rank = (v: string) => v === 'short' ? 4 : v === 'ok' ? 3 : v === 'over' ? 2 : v === 'unknown' ? 1 : 0
      out[d.date] = { verdict: rank(d.verdict) > rank(cur.verdict) ? d.verdict : cur.verdict, short: cur.short + shortBy, line: [cur.line, d.line].filter(Boolean).join('\n') }
    }
    return out
  }, [fc, market])
  const shortDays = Object.values(staffing).filter(s => s.verdict === 'short').length

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/team-schedule?dept=' + dept + '&from=' + from + '&to=' + to + '&crew=' + crew + '&money=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || j?.message || 'Could not load the planner.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [from, to, dept, crew])
  useEffect(() => { load() }, [load])

  // LEAN PASS (2026-09-22): the page header lives here so its pills can carry the numbers that
  // used to be an amber banner and a footer paragraph.
  const head = (
    <LeanHead title={<span>Week plan <span className="text-muted font-medium text-[14px]">· {niceRange(from, to)}</span></span>}>
      {shortDays ? <Pill tone="rose" title={Object.entries(staffing).filter(([, s]) => s.verdict === 'short').map(([d, s]) => d + ': ' + s.line).join('\n')}>{shortDays} short day{shortDays === 1 ? '' : 's'}</Pill> : fc ? <Pill tone="emerald" title="No day in view needs more housekeepers than are rostered">staffed</Pill> : null}
      {data && !data.counts.rosterWeeks ? <Pill tone="rose" title="No roster saved for these weeks — set who is on and off on the Scheduler">No roster</Pill> : null}
      {data && data.counts.rosterWeeks && data.counts.clashes ? <Pill tone="amber" title="Days where the roster and the work disagree — ringed in amber below">{data.counts.clashes} clash{data.counts.clashes === 1 ? '' : 'es'}</Pill> : null}
      {data && data.counts.unassignedDropped ? <Pill tone="amber" title="Jobs with nobody assigned in Breezeway yet">{data.counts.unassignedDropped} unassigned</Pill> : null}
      {data ? <Pill title={'Long stay = ' + data.rules.longStayNights + '+ nights, big arrival = $' + data.rules.bigBookingUsd.toLocaleString() + '+ (Users → Task automation). On/off comes from the Scheduler roster; the work is what is assigned in Breezeway.'}>{data.rules.longStayNights}+n · ${data.rules.bigBookingUsd.toLocaleString()}+</Pill> : null}
    </LeanHead>
  )

  // THE STAFFING FORECAST (lib/forecast) sits right under the title in every state. Same wrapper and
  // position in all three returns, so it is not remounted (and refetched) when the planner loads.
  if (!data && busy) return (
    <div className="space-y-3">{head}<div className="rounded-2xl bg-white ring-1 ring-line p-12 text-center text-sm text-muted">
      <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Building the planner…
    </div></div>
  )
  if (err && !data) return <div className="space-y-3">{head}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div></div>
  if (!data) return null

  const chip = (on: boolean) =>
    'text-[12px] font-semibold px-2.5 h-8 rounded-lg border transition ' +
    (on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink hover:border-ink/25')

  return (
    <div className="space-y-3">
      {head}
      {/* ONE CONTROL ROW (Jon, 2026-10-02): trade · market · week stepper · the two actions. The two
          date fields, the in-house/vendor switch and the cleans/calendar switch are folded into small
          chips on the right; the day picker below is the only place the days are drawn. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white">
          <button onClick={() => setDept('cleaning')} className={'text-[12.5px] font-bold px-3 h-8 ' + (dept === 'cleaning' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Cleaning</button>
          <button onClick={() => setDept('maintenance')} className={'text-[12.5px] font-bold px-3 h-8 border-l border-line ' + (dept === 'maintenance' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Maintenance</button>
        </div>
        <button onClick={() => setMarket('all')} className={chip(market === 'all')}>All</button>
        {data.markets.map(m => (
          <button key={m.market} onClick={() => setMarket(m.market.toLowerCase())} className={chip(market === m.market.toLowerCase())}>{m.market}</button>
        ))}
        {dept === 'cleaning' ? <button onClick={() => setCrew(c => (c === 'vendor' ? 'inhouse' : 'vendor'))} aria-pressed={crew === 'vendor'} className={chip(crew === 'vendor')} title="Vendor-serviced buildings (Opal Works / Probol / Botanica) instead of our own crew">Vendor buildings</button> : null}
        <div className="flex-1" />
        <IconBtn title="Back a week" onClick={() => { setFrom(addDays(from, -7)); setTo(addDays(to, -7)) }}><ChevronLeft size={15} /></IconBtn>
        {from !== todayET()
          ? <button onClick={() => { setFrom(todayET()); setTo(addDays(todayET(), 13)) }} className="text-[12px] font-semibold px-2.5 h-8 rounded-lg border border-line bg-white text-ink">Today</button>
          : null}
        <IconBtn title="Forward a week" onClick={() => { setFrom(addDays(from, 7)); setTo(addDays(to, 7)) }}><ChevronRight size={15} /></IconBtn>
        <button onClick={() => setView(v => (v === 'cleans' ? 'calendar' : 'cleans'))} className={chip(view === 'calendar')} title={view === 'calendar' ? 'Back to the day-by-day cleans' : 'The fortnight as a calendar, by person'}>{view === 'calendar' ? 'Days' : 'Calendar'}</button>
        {dept === 'cleaning' && crew === 'inhouse' ? (
          <button onClick={() => setSuggest(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 h-8 rounded-lg bg-ink text-white"><Wand2 size={13} /> Suggest the week</button>
        ) : null}
        <IconBtn title="Reload the planner" onClick={load} disabled={busy}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></IconBtn>
      </div>
      {suggest ? <WeekSuggester from={from} to={to} onClose={() => setSuggest(false)} onPushed={load} /> : null}

      {view === 'calendar' ? (
        <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white">
          {GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)}
              className={'text-[12px] font-semibold px-2.5 h-8 border-l border-line first:border-l-0 ' + (group === g.key ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{g.label}</button>
          ))}
        </div>
      ) : null}

      {/* THE NUMBERS, ONE LINE (was four tiles and a fourteen-row table). */}
      {data.labor && dept === 'cleaning' ? (() => {
        const t = data.labor.totals, hasActual = t.actualDays > 0
        const $ = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
        return (
          <div className="px-1 text-[12px] text-muted flex items-center gap-x-2 gap-y-1 flex-wrap">
            <span><b className="text-ink tabular-nums">{t.cleans}</b> departure cleans{t.other ? ` · ${t.other} other jobs` : ''}</span>
            <span>·</span>
            <span><b className="text-ink tabular-nums">{$(t.revenue)}</b> cleaning revenue{t.revenuePerClean ? ` (${$(t.revenuePerClean)} a clean)` : ''}</span>
            <span>·</span>
            {hasActual
              ? <span><b className="text-ink tabular-nums">{$(t.actualCost)}</b> labor punched over {t.actualDays} day{t.actualDays === 1 ? '' : 's'}{t.perClean ? ` (${$(t.perClean)} a clean)` : ''}{t.scheduledDays ? ` · ${$(t.scheduledCost)} rostered for the ${t.scheduledDays} ahead` : ''}</span>
              : <span><b className="text-amber-700 tabular-nums">{t.scheduledCost ? $(t.scheduledCost) : '—'}</b> labor rostered{t.scheduledHours ? ` (${t.scheduledHours}h)` : ''} — a plan, not a spend</span>}
            {!data.labor.payrollComplete && <Tag tone="amber" title="Homebase came back short for part of this window — the punched labor is a floor, not the figure">payroll partial</Tag>}
          </div>
        )
      })() : null}

      {/* THE DAY (Jon, 2026-09-09): the actual cleans and who has them. */}
      {view === 'cleans'
        ? <DayCleans days={data.days} blocks={data.markets} dept={dept} marketFilter={market} labor={data.labor} canManage onChanged={load} staffing={staffing} />
        : null}

      {view === 'calendar' ? (
        <>
          <PlannerView days={data.days} blocks={data.markets} dept={dept} marketFilter={market} group={group} showLinks />
          <PlannerLegend dept={dept} />
        </>
      ) : null}
    </div>
  )
}
