// SCORECARDS (Jon, 2026-11-20: "Everything should have a scorecard for things completed and Leaderboard based on KPI").
// One page: a team, a period, what was completed and the people ranked on that team's KPI. Until today
// /scoreboard only redirected to the inspection scoreboard, which is still at /training/scoreboard and
// linked from the Housekeeping card. Gated by the `scorecards` key (lib/features), view to read.
import { Shell } from '@/components/Shell'
import { ScorecardsDesk } from '@/components/ScorecardsDesk'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Scorecards' }

export default function ScorecardsPage() {
  return (
    <Shell>
      <ScorecardsDesk />
    </Shell>
  )
}
