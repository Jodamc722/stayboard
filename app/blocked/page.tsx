import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BlockedUnits } from '@/components/BlockedUnits'

export const dynamic = 'force-dynamic'

// Every unit that cannot be sold, from Guesty's multi-calendar, down longest first. (Header in BlockedUnits.)
export default async function BlockedPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <BlockedUnits />
    </Shell>
  )
}
