// Turnover Schedule — cleaning plan by day and by week (Sun-Saturday), split by market
// (Miami / Broward / North), built from confirmed Guesty checkouts. Assign a cleaner to each
// departure clean and push the assignments to Breezeway. force-dynamic; client board fetches live.
// LEAN PASS (2026-09-22): one-line header; the eyebrow and the explainer paragraph are gone.
import { Shell } from '@/components/Shell'
import { ScheduleBoard } from '@/components/ScheduleBoard'
import { LaborStrip } from '@/components/LaborStrip'
import { CapacityPanel } from '@/components/OpsV2'
import { LeanHead } from '@/components/lean'
import { CalendarRange } from 'lucide-react'
import { ScheduleSuggesterButton } from '@/components/ScheduleSuggester'

export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <Shell>
      <LeanHead title="Turnover Schedule" icon={<CalendarRange size={18} className="text-brand-600" />}>
        {/* The sandbox (Jon, 2026-09-23): a proposed day in a popup, moved around, then approved. */}
        <ScheduleSuggesterButton />
      </LeanHead>

      <LaborStrip />
      {/* IS THE DAY DOABLE — the measured capacity model (lib/capacity), pointed at whichever day
          is being planned. The board below decides WHO takes each clean; this line says whether
          the day fits at all, before anyone starts assigning. */}
      <CapacityPanel pager />
      <ScheduleBoard />
    </Shell>
  )
}
