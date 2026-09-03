import { Shell } from '@/components/Shell'
import { ScheduleLinksDesk } from '@/components/ScheduleLinksDesk'
import { Link2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function ScheduleLinksPage() {
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Link2 size={13} /> Scheduler</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Team schedule links</h1>
        <p className="text-sm text-muted mt-1">One link per market. The team assigns cleaners for the week from their phone and presses Submit; you get the email, review on the Scheduler, and send notes back here.</p>
      </header>
      <ScheduleLinksDesk />
    </Shell>
  )
}
