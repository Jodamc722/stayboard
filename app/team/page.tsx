// WEEKLY PLANNER — the schedule and the daily assignments, by market (Jon, 2026-08-21).
// The one-line header (title + pills) is drawn by TeamPlanner, which has the numbers.
// The staffing forecast strip sits above it: the next 14 days, short days first (lib/forecast).
import { Shell } from '@/components/Shell'
import { TeamPlanner } from '@/components/TeamPlanner'
import { ForecastStrip } from '@/components/forecast/ForecastStrip'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Weekly Planner — Lighthouse' }

export default function TeamPage() {
  return (
    <Shell>
      <ForecastStrip />
      <TeamPlanner />
    </Shell>
  )
}
