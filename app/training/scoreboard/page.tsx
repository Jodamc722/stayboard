// THE TEAM SCOREBOARD (Jon, 2026-11-06: "Let's build a scoreboard for our team, a way to organize the
// feedback, read the inspection and be able to share the inspection reports with the girls").
// Gated by the training key (view to look, edit to send and mark feedback).
import { Shell } from '@/components/Shell'
import { ScoreboardDesk } from '@/components/ScoreboardDesk'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Team scoreboard' }

export default function ScoreboardPage() {
  return (
    <Shell>
      <ScoreboardDesk />
    </Shell>
  )
}
