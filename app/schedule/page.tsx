// Scheduler (the turnover schedule) — cleaning plan by day and by week (Sun-Saturday), split by
// market (Miami / Broward / North), built from confirmed Guesty checkouts. Assign a cleaner to each
// departure clean and push the assignments to Breezeway. force-dynamic; client board fetches live.
// LEAN PASS (2026-09-22): one-line header; the eyebrow and the explainer paragraph are gone.
// 2026-09-28 audit: the board is the first thing on the page. LaborStrip left (cost numbers are a
// report, and it already sits on Today in Ops as the People footer), and the capacity strip folded
// into a header Pill that opens it (ScheduleHead).
import { Shell } from '@/components/Shell'
import { ScheduleBoard } from '@/components/ScheduleBoard'
import { ScheduleHead } from './ScheduleHead'
import { TomorrowCheck } from '@/components/TomorrowCheck'

export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <Shell>
      <ScheduleHead />
      {/* Tomorrow at a glance (Jon, 2026-10-01): the schedule check lives here, not in Slack. */}
      <TomorrowCheck />
      <ScheduleBoard />
    </Shell>
  )
}
