// Internal home of the direct-booking tracker. Same board the partner link shows, inside the app
// shell and with full guest names.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { MarketingBoard } from '@/components/MarketingBoard'

export const dynamic = 'force-dynamic'

export default async function MarketingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <MarketingBoard />
      </div>
    </Shell>
  )
}
