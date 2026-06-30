// Turnover Schedule — cleaning plan by day and by week (Sun-Saturday), split by market
// (Miami / Broward / North), built from confirmed Guesty checkouts. Assign a cleaner to each
// departure clean and push the assignments to Breezeway. force-dynamic; client board fetches live.
import { Shell } from '@/components/Shell'
import { ScheduleBoard } from '@/components/ScheduleBoard'
import { CalendarRange } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><CalendarRange size={13} /> Operations</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Turnover Schedule</h1>
        <p className="text-sm text-muted mt-1">Departure cleans from confirmed checkouts &mdash; by day and by week (Sunday&ndash;Saturday), split by market. Assign a cleaner and push to Breezeway.</p>
      </header>
      <ScheduleBoard />
    </Shell>
  )
}
