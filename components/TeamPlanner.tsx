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
import { Loader2, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react'
import { PlannerView, PlannerLegend, type PDay, type PBlock } from './PlannerView'

type Data = {
  from: string; to: string; days: PDay[]; markets: PBlock[]
  rules: { longStayNights: number; bigBookingUsd: number }
  counts: { tasksRead: number; vendorDropped: number; unassignedDropped: number; rosterWeeks: number; clashes: number }
}

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function addDays(iso: string, n: number): string { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export function TeamPlanner() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  const [from, setFrom] = useState(todayET())
  const [market, setMarket] = useState('all')
  const [dept, setDept] = useState<'cleaning' | 'maintenance'>('cleaning')

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

  if (!data && busy) return (
    <div className="rounded-2xl bg-white ring-1 ring-line p-12 text-center text-sm text-muted">
      <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Building the planner…
    </div>
  )
  if (err && !data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{err}</div>
  if (!data) return null

  const chip = (on: boolean) =>
    'text-[12.5px] font-semibold px-3 h-9 rounded-xl border transition ' +
    (on ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink hover:border-ink/25')

  return (
    <div className="space-y-5">
      {/* which trade — the biggest decision on the screen, so it sits alone above everything */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-line overflow-hidden bg-white">
          <button onClick={() => setDept('cleaning')} className={'text-[13px] font-bold px-4 h-9 ' + (dept === 'cleaning' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Cleaning</button>
          <button onClick={() => setDept('maintenance')} className={'text-[13px] font-bold px-4 h-9 border-l border-line ' + (dept === 'maintenance' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>Maintenance</button>
        </div>

        <div className="flex-1" />

        <div className="inline-flex items-center gap-1.5">
          <button onClick={() => setFrom(addDays(from, -7))} aria-label="Earlier"
            className="h-9 w-9 grid place-items-center rounded-xl border border-line bg-white text-muted hover:text-ink"><ChevronLeft size={15} /></button>
          {from !== todayET()
            ? <button onClick={() => setFrom(todayET())} className="text-[12.5px] font-semibold px-3 h-9 rounded-xl border border-line bg-white text-ink">Back to today</button>
            : null}
          <button onClick={() => setFrom(addDays(from, 7))} aria-label="Later"
            className="h-9 w-9 grid place-items-center rounded-xl border border-line bg-white text-muted hover:text-ink"><ChevronRight size={15} /></button>
          <button onClick={load} disabled={busy} aria-label="Refresh"
            className="h-9 w-9 grid place-items-center rounded-xl border border-line bg-white text-muted hover:text-ink disabled:opacity-40"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {/* which market */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setMarket('all')} className={chip(market === 'all')}>All markets</button>
        {data.markets.map(m => (
          <button key={m.market} onClick={() => setMarket(m.market.toLowerCase())} className={chip(market === m.market.toLowerCase())}>{m.market}</button>
        ))}
      </div>

      {/* anything that actually needs a human — one line, or nothing at all */}
      {data.counts.clashes || !data.counts.rosterWeeks ? (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-amber-900">
            {!data.counts.rosterWeeks
              ? 'No roster saved for these weeks — set who is on and off on the Turnover Schedule.'
              : data.counts.clashes + ' day' + (data.counts.clashes === 1 ? '' : 's') + ' where the roster and the work disagree — ringed in amber below.'}
          </p>
        </div>
      ) : null}

      <PlannerView days={data.days} blocks={data.markets} dept={dept} marketFilter={market} showLinks />

      <PlannerLegend dept={dept} />

      <p className="text-[11.5px] text-muted leading-relaxed max-w-3xl">
        Who is on and off comes from the roster on the Turnover Schedule; the numbers are the work actually
        assigned in Breezeway. Long stay is {data.rules.longStayNights}+ nights and a big arrival is
        ${data.rules.bigBookingUsd.toLocaleString()}+, both read from Users → Task automation so this screen,
        Slack and the ops brief always agree. Vendor-serviced markets get no block of their own — their work
        only appears when one of our rostered people is on it, on that person's row.
        {data.counts.unassignedDropped ? ' ' + data.counts.unassignedDropped + ' job' + (data.counts.unassignedDropped === 1 ? ' has' : 's have') + ' nobody assigned yet.' : ''}
      </p>
    </div>
  )
}
