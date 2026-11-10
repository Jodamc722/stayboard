// schedule_plan — "are we staffed next week?" in one call (owner, 2026-11-10: preemptive scheduling).
// Core, not behind a domain: it is the question the owner wants answered fastest, and it is one small
// schema. The plan itself is lib/forecast/plan.ts — the same one the Scheduler's "Next 7 days" panel
// and the Sunday shadow readout show. Read-only.
import 'server-only'
import type { EveTool } from './types'
import { obj, S } from './types'

export const SCHEDULE_PLAN_TOOLS: EveTool[] = [
  {
    name: 'schedule_plan',
    description: 'THE NEXT-WEEK STAFFING PLAN. For "are we staffed next week?", "do we need more cleaners Saturday?", "what should we change on the schedule?": per in-house market (Miami, Broward) per day — cleans booked and likely (bookings + learned pickup + the weekday\'s history), KPI hours (each clean\'s expected labor cost ÷ pay, the Scheduler rail\'s basis), people needed at one shift, people Working in Homebase so far, the gap — and one to three concrete moves (call in on-call, move deep cleans to a day with room, add a cleaner, publish Homebase). Params: days (default 7, max 14), market ("Miami" or "Broward"; empty = both), from (YYYY-MM-DD, default tomorrow). Answer with the headline, then the moves with who does them (the scheduler for moves, whoever publishes Homebase for rosters), then one line on the KPI basis (expected hours vs scheduled hours). Point people to Schedule → Next 7 days for the grid. North and vendor buildings are not in it.',
    input_schema: obj({ days: S.num, market: S.str, from: S.str }),
    run: async (input) => {
      const { buildNextWeekPlan } = await import('@/lib/forecast/plan')
      const p = await buildNextWeekPlan({ days: Number(input?.days) || 7, market: input?.market ? String(input.market) : null, from: input?.from ? String(input.from) : undefined })
      return {
        headline: p.summary.headline,
        moves: p.moves.map(m => ({ do: m.text, why: m.why, market: m.market, date: m.date })),
        days: p.days.map(d => ({
          date: d.date, day: d.dow, market: d.market, booked: d.booked, likely: d.likely,
          kpi_hours: Math.round(d.targetH * 10) / 10, needed: d.need,
          working: d.rosterKnown ? d.working : null, on_call: d.onCall,
          scheduled_hours: d.rosterKnown ? d.schedH : null, gap_hours: d.rosterKnown ? Math.round(d.gapH * 10) / 10 : null,
          verdict: d.verdict, deep_cleans_movable: d.deferrable || 0,
        })),
        kpi: { expected_hours: p.summary.kpiH, scheduled_hours: p.summary.schedH, note: 'Summed over the days Homebase has published.' },
        basis: p.basis,
        track_record: p.track ? (p.track.withinPct != null ? `within one person on ${p.track.withinPct}% of ${p.track.n} graded days` : `${p.track.n} graded days — too few to call`) : 'not graded yet',
        roster_published_through: p.rosterPublishedThrough,
        partial: p.notes.length ? p.notes : undefined,
        window: `${p.from} → ${p.to}`, as_of: p.generatedAt,
        where: 'Schedule page → Next 7 days (the grid); Week plan for who works which day.',
      }
    },
  },
]
