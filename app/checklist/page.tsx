// OPEN & CLOSE (Jon, 2026-10-19) — the Checklist tab is the opening and closing roadmap now: the
// gates with their real rows, the Schedule embedded for the cleans, the glitches with their
// Breezeway tasks, carry-over to tomorrow and the day's handover. The standing checklist still
// lives here, folded under Reminders, with its editor.
import { Shell } from '@/components/Shell'
import { OpenClose } from '@/components/OpenClose'

export const dynamic = 'force-dynamic'

export default function OpenClosePage() {
  return (
    <Shell>
      <OpenClose />
    </Shell>
  )
}
