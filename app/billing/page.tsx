// Money → Billable Hours. Breezeway tasks organized for owner billing: costs, rates (editable,
// write back to Breezeway), our adjustment overlay, per-owner export, and the labor
// billable-vs-actual view. Owner/admin-only by role default (same rule as Revenue/Owner Audit).
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BillingBoard } from '@/components/BillingBoard'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <BillingBoard />
      </div>
    </Shell>
  )
}
