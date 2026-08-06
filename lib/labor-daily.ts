// lib/labor-daily.ts
// Yesterday-in-review flags + labor-vs-revenue banding.
// Thresholds come from labor_settings (see lib/labor-settings.ts) — no env vars.

import { nameMatches, type Shift } from '@/lib/homebase'
import type { Timecard } from '@/lib/homebase-labor'
import type { LaborSettings } from '@/lib/labor-settings'

const round1 = (n: number) => Math.round(n * 10) / 10
const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 6e4

export type YesterdayLabor = {
  date: string
  totalHoursWorked: number
  totalScheduledHours: number
  headcount: number
  lateClockIns: { name: string; shiftStart: string; clockIn: string; minutesLate: number }[]
  overSchedule: { name: string; scheduledHours: number; actualHours: number; overByHours: number }[]
  noShows: { name: string; shiftStart: string }[]
  missedClockOuts: string[]
}

export function computeYesterdayLabor(
  date: string,
  shifts: Shift[],
  timecards: Timecard[],
  settings: LaborSettings,
  tz = 'America/New_York',
): YesterdayLabor {
  const fmt = (t: string) =>
    new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })

  const lateClockIns: YesterdayLabor['lateClockIns'] = []
  const noShows: YesterdayLabor['noShows'] = []
  const overSchedule: YesterdayLabor['overSchedule'] = []

  for (const s of shifts.filter(x => !x.open && x.startAt)) {
    const myCards = timecards.filter(t => nameMatches(t.name, s.name))
    if (!myCards.length) {
      noShows.push({ name: s.name, shiftStart: fmt(s.startAt as string) })
      continue
    }
    const firstIn = myCards.map(t => t.clockIn).filter(Boolean).sort()[0] as string | undefined
    if (firstIn) {
      const late = mins(s.startAt as string, firstIn)
      if (late > settings.grace_min)
        lateClockIns.push({
          name: s.name, shiftStart: fmt(s.startAt as string),
          clockIn: fmt(firstIn), minutesLate: Math.round(late),
        })
    }
    const scheduled = s.endAt && s.startAt
      ? (new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 36e5 : 0
    const actual = myCards.reduce((a, t) => a + (t.hours ?? 0), 0)
    if (scheduled > 0 && (actual - scheduled) * 60 > settings.over_sched_min)
      overSchedule.push({
        name: s.name,
        scheduledHours: round1(scheduled),
        actualHours: round1(actual),
        overByHours: round1(actual - scheduled),
      })
  }

  return {
    date,
    totalHoursWorked: round1(timecards.reduce((a, t) => a + (t.hours ?? 0), 0)),
    totalScheduledHours: round1(
      shifts.filter(s => !s.open && s.startAt && s.endAt)
        .reduce((a, s) => a + (new Date(s.endAt!).getTime() - new Date(s.startAt!).getTime()) / 36e5, 0)),
    headcount: new Set(timecards.map(t => t.name)).size,
    lateClockIns: lateClockIns.sort((a, b) => b.minutesLate - a.minutesLate),
    overSchedule: overSchedule.sort((a, b) => b.overByHours - a.overByHours),
    noShows,
    missedClockOuts: [...new Set(timecards.filter(t => t.open).map(t => t.name))],
  }
}

export type LaborRevStatus = {
  pct: number | null
  band: 'on_target' | 'watch' | 'over' | 'no_data'
  label: string   // safe for team-facing briefs — carries no dollar amounts
}

export function laborRevenueStatus(
  laborCost: number | null,
  revenue: number | null,
  settings: LaborSettings,
): LaborRevStatus {
  if (laborCost == null || !revenue)
    return { pct: null, band: 'no_data', label: 'Labor vs revenue: no data yet' }
  const pct = Math.round((laborCost / revenue) * 1000) / 10
  const band = pct <= settings.pct_good ? 'on_target' : pct <= settings.pct_bad ? 'watch' : 'over'
  const word = band === 'on_target' ? 'on target' : band === 'watch' ? 'watch' : 'over target'
  return { pct, band, label: `Labor at ${pct}% of revenue — ${word} (goal ≤ ${settings.pct_good}%)` }
}
