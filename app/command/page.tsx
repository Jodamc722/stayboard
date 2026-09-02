// COMMAND CENTER v3 (Jon, 2026-09-02): the day's cockpit — pulse, seven tiles that open in place,
// and ONE ranked "Do next" list from the predictive engine (lib/command-day). The page itself is
// now a thin server shell: auth, the header, the client cockpit and the right rail. Every number
// on it comes from /api/command/day, which reads the same lib/ops-day picture the board reads —
// so the cockpit and Today in Ops can no longer disagree about the same morning.
//
// What left this page and why:
//   • the 5 count tiles + MissionFeed's nine stacked lists → the seven tiles (fixed shape, drawers)
//   • NeedsHumanPanel → the Do-next list (same rows, shared dismissals instead of per-device ticks)
//   • Big arrivals / Maintenance-today cards → the Arrivals and Tasks tiles
//   • AvailabilityAlert → stays, as a quiet line under the rail (it is a listing-settings check)
//   • Quick actions card (Generate ops plan / Ops Plans / Reviews) → gone; the plan engine's
//     output IS the Do-next list now, and Reviews lives in the Guest desk tile.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BrainConsole } from '@/components/BrainConsole'
import { SlackQueueCard } from '@/components/SlackQueueCard'
import { AvailabilityAlert } from '@/components/AvailabilityAlert'
import { CommandCockpit } from '@/components/CommandCockpit'
import { Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const firstName = user.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, c => c.toUpperCase()) || 'there'

  return (
    <Shell>
      <header className="mb-4 hidden sm:block">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sparkles size={13} /> Command Center
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Command Center</h1>
        <p className="text-sm text-muted mt-1">The day in one screen — cleans, arrivals, tasks, glitches, claims — and what to do next. Eve is on the right.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 min-w-0">
          <CommandCockpit firstName={firstName} />
        </div>
        <div className="lg:col-span-1 space-y-4 lg:sticky lg:top-4">
          <SlackQueueCard />
          <BrainConsole />
          <AvailabilityAlert />
        </div>
      </div>
    </Shell>
  )
}
