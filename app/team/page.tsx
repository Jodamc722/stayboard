// WEEKLY PLANNER — the schedule and the daily assignments, by market (Jon, 2026-08-21).
// The one-line header (title + pills) is drawn by TeamPlanner, which has the numbers.
import { Shell } from '@/components/Shell'
import { TeamPlanner } from '@/components/TeamPlanner'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Weekly Planner — Lighthouse' }

export default function TeamPage() {
  return (
    <Shell>
      <TeamPlanner />
    </Shell>
  )
}
