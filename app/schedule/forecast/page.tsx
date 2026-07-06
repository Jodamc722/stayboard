import { Shell } from '@/components/Shell'
import { ForecastBoard } from '@/components/ForecastBoard'
import { CalendarRange } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function ForecastPage() {
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><CalendarRange size={13} /> Operations</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Weekly Schedule</h1>
        <p className="text-sm text-muted mt-1">Build the team&rsquo;s week by market. The top rows show projected &amp; booked cleans and cleaners needed (60-day forecast); add your team below and set each person&rsquo;s day.</p>
      </header>
      <ForecastBoard />
    </Shell>
  )
}
