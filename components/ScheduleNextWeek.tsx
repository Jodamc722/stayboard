'use client'
// NEXT 7 DAYS — the preemptive half of the Scheduler (owner, 2026-11-10: "start building preemptive
// scheduling"). One compact panel above the board: the plan's headline, its one to three moves, and
// on a tap the market × day grid — people Working against people needed on the rail's KPI basis.
// Same numbers Eve's schedule_plan tool and the Sunday readout use (lib/forecast/plan.ts via
// /api/schedule/plan). Read-only: every move is something a person does on this page or in Homebase.
//
// ONE LINE (Jon, 2026-11-20: "clean up … some data is noisy"). This was a full-width banner of two lines above the
// board on every visit — a headline that read "10 short days in the next 7" (market-days, counted against calendar
// days) and then the moves — on a page whose header pill, day strip and team rail each already said who is short.
// It is now one button at the right end of the tab row: "Next 7 days · short on 5 days". The moves and the
// market × day grid open underneath on a click, and the choice is still remembered per device.
// SPEED: the read goes through lib/swr, so a return visit paints the last plan at once and refreshes behind it
// (the route is a 2.9s build when its ten-minute server cache is cold, which at five opens a day is most opens).
import { useEffect, useState } from 'react'
import { useCachedFetch } from '@/lib/swr'
import { ChevronDown, ChevronRight, CalendarClock, RefreshCw } from 'lucide-react'
import type { PlanDay, PlanMove, PlanSummary, PlanSettings } from '@/lib/forecast/plan-core'

type Plan = {
  ok: boolean; error?: string
  from: string; to: string; markets: string[]; settings: PlanSettings
  days: PlanDay[]; summary: PlanSummary; moves: PlanMove[]; basis: string
  rosterPublishedThrough: string | null; pickupLearning: boolean
  track: { n: number; mae: number | null; bias: number | null; withinPct: number | null } | null
  notes: string[]
}

const OPEN_KEY = 'lh:schedule:next7:open'
const fmtH = (h: number) => { const m = Math.round(Math.abs(h) * 60); const hh = Math.floor(m / 60), mm = m % 60; return (h < 0 ? '−' : '') + (hh ? hh + 'h' : '') + (mm ? (hh ? ' ' : '') + mm + 'm' : (hh ? '' : '0h')) }
const CELL: Record<string, string> = {
  short: 'bg-rose-50 text-rose-700 border-rose-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  over: 'bg-amber-50 text-amber-700 border-amber-200',
  unknown: 'bg-neutral-50 text-neutral-500 border-line',
  none: 'bg-white text-muted border-line',
}

function cellTitle(d: PlanDay, s: PlanSettings): string {
  if (d.verdict === 'none') return `${d.label} · ${d.market}: nothing booked or likely`
  return [
    `${d.label} · ${d.market}`,
    `${d.booked} booked${d.projCleans ? ` + ${d.projCleans} likely still to book` : ''}`,
    `${fmtH(d.kpiH + d.projH)} KPI hours + ${s.growthPct}% buffer = ${fmtH(d.targetH)} → ${d.need} cleaner${d.need === 1 ? '' : 's'} at ${s.shiftHours}h`,
    d.rosterKnown ? `${d.working} working = ${fmtH(d.schedH)}${d.onCall ? ` · ${d.onCall} on call (not counted)` : ''}` : 'Homebase has not published this day yet',
    d.rosterKnown ? `Scheduled − KPI: ${fmtH(d.gapH)}` : '',
    d.deferrable ? `${d.deferrable} deep clean${d.deferrable === 1 ? '' : 's'} on this day could move` : '',
  ].filter(Boolean).join('\n')
}

export function ScheduleNextWeek({ market }: { market: string }) {
  const inHouse = market === 'Miami' || market === 'Broward' ? market : market === 'all' ? '' : null
  const [open, setOpen] = useState(false)
  useEffect(() => { try { setOpen(window.localStorage.getItem(OPEN_KEY) === '1') } catch { /* no storage: closed */ } }, [])
  const toggle = () => setOpen(o => { const n = !o; try { window.localStorage.setItem(OPEN_KEY, n ? '1' : '0') } catch { /* fine */ } return n })
  // North and the vendor view are not our roster — nothing to plan, and nothing to fetch.
  const { data, error, loading, refresh } = useCachedFetch<Plan>(
    inHouse === null ? null : '/api/schedule/plan?days=7' + (inHouse ? '&market=' + encodeURIComponent(inHouse) : ''), { ttl: 10 * 60_000 })
  const plan = data && data.ok ? data : null

  if (inHouse === null) return null
  if (!plan) {
    return (
      <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted" title={error || undefined}>
        <CalendarClock size={14} className="text-brand-600 shrink-0" />
        {error && !loading ? 'Next 7 days — the plan could not be built' : 'Next 7 days…'}
      </span>
    )
  }

  const dates = Array.from(new Set(plan.days.map(d => d.date))).sort()
  const s = plan.summary
  // Calendar days with at least one market short — the number a person means by "short days".
  const shortDates = new Set(plan.days.filter(d => d.verdict === 'short').map(d => d.date)).size
  // The labor KPI is a guide, not an alarm (Jon, 2026-11-02): under it is amber, never red.
  const line = shortDates
    ? 'short on ' + shortDates + (shortDates === 1 ? ' day' : ' days')
    : s.unknownDays ? 'roster not out for ' + s.unknownDays + (s.unknownDays === 1 ? ' day' : ' days') : 'staffed to the KPI'
  const tone = shortDates ? 'text-amber-700 font-semibold' : 'text-muted'
  const at = (mk: string, date: string) => plan.days.find(d => d.market === mk && d.date === date) || null

  return (
    <>
      <button onClick={toggle} aria-expanded={open} title={s.headline + (open ? '' : ' — click for the day-by-day grid' + (plan.moves.length ? ' and the suggested moves' : ''))}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] hover:border-neutral-400">
        <CalendarClock size={14} className="text-brand-600 shrink-0" />
        <span className="font-semibold text-ink">Next 7 days</span>
        <span className={tone}>· {line}</span>
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
      </button>
      {open && (
        <div className="basis-full w-full rounded-xl border border-line bg-white px-3 py-2.5 space-y-2">
          {plan.moves.length > 0 && (
            <ol className="text-[12px] text-ink space-y-0.5">
              {plan.moves.map((m, i) => <li key={i} title={m.why}><b className="text-muted font-semibold">{i + 1}.</b> {m.text}</li>)}
            </ol>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate border-spacing-1 text-[11.5px]">
              <thead>
                <tr>
                  <th className="text-left text-[10px] uppercase tracking-wide text-muted font-semibold">Working / needed</th>
                  {dates.map(d => { const x = plan.days.find(y => y.date === d); return <th key={d} className="text-[10px] uppercase tracking-wide text-muted font-semibold text-center">{x ? x.dow + ' ' + Number(d.slice(8, 10)) : d}</th> })}
                </tr>
              </thead>
              <tbody>
                {plan.markets.map(mk => (
                  <tr key={mk}>
                    <td className="text-[11.5px] font-semibold text-ink pr-1">{mk}</td>
                    {dates.map(date => {
                      const d = at(mk, date)
                      if (!d) return <td key={date} />
                      return (
                        <td key={date} title={cellTitle(d, plan.settings)} className={'border rounded-lg px-1.5 py-1 text-center align-top ' + CELL[d.verdict]}>
                          <div className="font-bold">{d.verdict === 'none' ? '—' : d.rosterKnown ? `${d.working}/${d.need}` : `?/${d.need}`}</div>
                          <div className="text-[10px] opacity-80">{d.verdict === 'none' ? 'no cleans' : `${d.likely} clean${d.likely === 1 ? '' : 's'} · ${fmtH(d.targetH)}`}</div>
                          {d.rosterKnown && d.verdict !== 'none' && d.gapH !== 0 && <div className="text-[10px] font-semibold">{d.gapH > 0 ? '+' : ''}{fmtH(d.gapH)}</div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-muted leading-snug">{plan.basis}</p>
          <p className="text-[10.5px] text-muted leading-snug">
            {plan.track
              ? (plan.track.withinPct != null ? `Graded so far: within one person on ${plan.track.withinPct}% of ${plan.track.n} days (30 days).` : `Graded so far: ${plan.track.n} day${plan.track.n === 1 ? '' : 's'} — too few to call.`)
              : 'Not graded yet — each night the plan is recorded and later checked against who actually worked.'}
            {plan.rosterPublishedThrough ? ` Homebase is published through ${plan.rosterPublishedThrough}.` : ''}
            {plan.pickupLearning ? ' The booking pickup is still learning.' : ''}
            {plan.notes.length ? ` Partial: ${plan.notes.slice(0, 2).join('; ')}.` : ''}
            <button onClick={() => refresh()} className="ml-2 inline-flex items-center gap-1 underline decoration-dotted hover:text-ink" aria-label="Refresh the plan"><RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> refresh</button>
          </p>
        </div>
      )}
    </>
  )
}
