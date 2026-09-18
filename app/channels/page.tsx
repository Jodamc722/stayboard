import { redirect } from 'next/navigation'
import { Plug } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { getAccess } from '@/lib/access'
import { Shell } from '@/components/Shell'
import { ChannelConnections } from '@/components/ChannelConnections'

export const dynamic = 'force-dynamic'

export default async function ChannelsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  const access = await getAccess()
  const canRun = access.levels.channels === 'full'
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Plug size={13} /> Portfolio
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Channel connections</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Every active listing against every channel we distribute on, straight from Guesty&apos;s own
          integration status. A listing that is failed, disconnected, suspended or simply not connected
          cannot be booked there, and nothing else in the app notices. The check re-runs after each
          listings sync; a listing that drops off Airbnb, Booking.com, Vrbo or Expedia is posted to Slack
          and opens a finding on Audits until it is live again.
        </p>
      </header>
      <ChannelConnections canRun={canRun} />
    </Shell>
  )
}
