// Money → Billable Hours. Breezeway tasks organized for owner billing: costs, rates (editable,
// write back to Breezeway), our adjustment overlay, per-owner export, and the labor
// billable-vs-actual view. Owner/admin-only by role default (same rule as Revenue/Owner Audit).
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BillingBoard } from '@/components/BillingBoard'
import { BillingReview } from '@/components/BillingReview'

export const dynamic = 'force-dynamic'

// Default view is the review desk (owner-grouped, ops → GM approval). The legacy board with the
// Labor / Rates tabs stays reachable at ?view=labor.
export default async function BillingPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const view = String(searchParams?.view || '')
  const legacy = view === 'labor' || view === 'rates' || view === 'board'
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        {legacy ? <BillingBoard /> : <BillingReview />}
      </div>
    </Shell>
  )
}
