import { redirect } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { StayWindowPanel } from '@/components/StayWindowPanel'

export const dynamic = 'force-dynamic'

export default async function StayWindowPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <CalendarClock size={13} /> Revenue
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Stay Window</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Open a listing to short stays in the evening and close it again in the morning. The switch
          writes a minimum length of stay onto the booking calendar for a rolling window of dates,
          then writes the long minimum back. Dates beyond the window are never touched, so the
          30-night default stays in force on its own.
        </p>
      </header>
      <StayWindowPanel />
    </Shell>
  )
}
