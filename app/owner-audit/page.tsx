// Internal home of the owner-statement audit. Same board the reviewer share link shows,
// inside the app shell. Owner/admin-level page: the feature key is in no ops/cs/data bundle.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { OwnerAuditBoard } from '@/components/OwnerAuditBoard'

export const dynamic = 'force-dynamic'

export default async function OwnerAuditPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <OwnerAuditBoard />
      </div>
    </Shell>
  )
}
