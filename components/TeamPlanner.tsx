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
import { useCallback, useEffect, useState } from 'react'
import { Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { LeanHead, Pill, IconBtn } from './lean'
import { PlannerView, PlannerLegend, type PDay, type PBlock, type PGroup } from './PlannerView'
import { ScheduleLaborStrip, type ScheduleLaborData } from './ScheduleLaborStrip'
import { DayCleans } from './DayCleans'

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
    <LeanHead title="Weekly Planner">
      {data && !data.counts.rosterWeeks ? <Pill tone="rose" title="No roster saved for these weeks — set who is on and off on the Turnover Schedule">No roster</Pill> : null}
      {data && data.counts.rosterWeeks && data.counts.clashes ? <Pill tone="amber" title="Days where the roster and the work disagree — ringed in amber below">{data.counts.clashes} clash{data.counts.clashes === 1 ? '' : 'es'}</Pill> : null}
      {data && data.counts.unassignedDropped ? <Pill tone="amber" title="Jobs with nobody assigned in Breezeway yet">{data.counts.unassignedDropped} unassigned</Pill> : null}
      {data ? <Pill title={'Long stay = ' + data.rules.longStayNights + '+ nights, big arrival = $' + data.rules.bigBookingUsd.toLocaleString() + '+ (Users → Task automation). On/off comes from the Turnover Schedule roster; the work is what is assigned in Breezeway.'}>{data.rules.longStayNights}+n · ${data.rules.bigBookingUsd.toLocaleString()}+</Pill> : null}
    </LeanHead>
  )

  if (!data && busy) return (
    <>{head}<div className="rounded-2xl bg-white ring-1 ring-line p-12 text-center text-sm text-muted">
      <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Building the planner…
    </div></>
  )
  if (err && !data) return <>{head}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div></>
  if (!data) return null

  const chip = (on: boolean) =>
    'text-[12px] font-semibold px-2.5 h-8 rounded-lg border transition ' +
    (on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink hover:border-ink/25')

  return (
    <div className="space-y-3">
      {head}
      {/* which trade — the biggest decision on the screen, so it leads the control line */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white">
          <button onClick={() => setDept('cleaning')} className={'text-[12.5px] font-bold px-3 h-8 ' + (dept === 'cleaning' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Cleaning</button>
          <button onClick={() => setDept('maintenance')} className={'text-[12.5px] font-bold px-3 h-8 border-l border-line ' + (dept === 'maintenance' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Maintenance</button>
        </div>
        {dept === 'cleaning' ? (
          <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white">
            <button onClick={() => setCrew('inhouse')} className={'text-[12.5px] font-bold px-3 h-8 ' + (crew === 'inhouse' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>In-house</button>
            <button onClick={() => setCrew('vendor')} className={'text-[12.5px] font-bold px-3 h-8 border-l border-line ' + (crew === 'vendor' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Vendor</button>
          </div>
        ) : null}

        <div className="flex-1" />

        <div className="inline-flex items-center gap-1.5 flex-wrap">
          {/* WHATEVER DATES YOU SELECT (Jon). The arrows still shift a week at a time because that
              is how the week is usually read; the two date fields are there for anything else. */}
          <input type="date" value={from} max={to} onChange={e => { const v = e.target.value; if (v) { setFrom(v); if (v > to) setTo(addDays(v, 6)) } }}
            aria-label="From" className="h-8 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-ink" />
          <span className="text-[12px] text-muted">to</span>
          <input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)}
            aria-label="To" className="h-8 rounded-lg border border-line bg-white px-2.5 text-[12.5px] text-ink" />
          <IconBtn title="Back a week" onClick={() => { setFrom(addDays(from, -7)); setTo(addDays(to, -7)) }}><ChevronLeft size={15} /></IconBtn>
          {from !== todayET()
            ? <button onClick={() => { setFrom(todayET()); setTo(addDays(todayET(), 13)) }} className="text-[12px] font-semibold px-2.5 h-8 rounded-lg border border-line bg-white text-ink">Today</button>
            : null}
          <IconBtn title="Forward a week" onClick={() => { setFrom(addDays(from, 7)); setTo(addDays(to, 7)) }}><ChevronRight size={15} /></IconBtn>
          <IconBtn title="Reload the planner" onClick={load} disabled={busy}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></IconBtn>
        </div>
      </div>

      {/* which view, then which market — and, on the calendar, how it is grouped */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white mr-1">
          <button onClick={() => setView('cleans')} className={'text-[12px] font-semibold px-2.5 h-8 ' + (view === 'cleans' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Cleans</button>
          <button onClick={() => setView('calendar')} className={'text-[12px] font-semibold px-2.5 h-8 border-l border-line ' + (view === 'calendar' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Calendar</button>
        </div>
        {view === 'calendar' ? (
          <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white mr-1">
            {GROUPS.map(g => (
              <button key={g.key} onClick={() => setGroup(g.key)}
                className={'text-[12px] font-semibold px-2.5 h-8 border-l border-line first:border-l-0 ' + (group === g.key ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{g.label}</button>
            ))}
          </div>
        ) : null}
        <button onClick={() => setMarket('all')} className={chip(market === 'all')}>All markets</button>
        {data.markets.map(m => (
          <button key={m.market} onClick={() => setMarket(m.market.toLowerCase())} className={chip(market === m.market.toLowerCase())}>{m.market}</button>
        ))}
        {crew === 'vendor' ? <span className="ml-1"><Pill tone="violet" title="Vendor-serviced buildings. Their crews rarely carry a Breezeway assignee, so a clean with nobody on it is filed under the vendor's name; Botanica has no Breezeway tasks and its checkouts come from Guesty. No labor here — not our payroll.">Vendor crews</Pill></span> : null}
      </div>

      {data.labor && dept === 'cleaning' ? <ScheduleLaborStrip data={data.labor} /> : null}

      {/* THE DAY (Jon, 2026-09-09): the actual cleans and who has them. */}
      {view === 'cleans'
        ? <DayCleans days={data.days} blocks={data.markets} dept={dept} marketFilter={market} labor={data.labor} canManage onChanged={load} />
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
