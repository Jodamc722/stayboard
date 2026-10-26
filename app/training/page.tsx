// TRAINING (Jon, 2026-10-26): how-to videos and FAQs for the team — a library in English and
// Spanish, assigned to people, with who finished what. Field staff with no login get /learn/<code>.
import { Shell } from '@/components/Shell'
import { TrainingDesk } from '@/components/TrainingDesk'

export const dynamic = 'force-dynamic'

export default function TrainingPage() {
  return (
    <Shell>
      <TrainingDesk />
    </Shell>
  )
}
