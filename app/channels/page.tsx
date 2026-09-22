import { redirect } from 'next/navigation'
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
      <ChannelConnections canRun={canRun} />
    </Shell>
  )
}
