// /revenue/reconcile — Revenue App ↔ Lighthouse: feed status, month reconcile, and the money-source flag.
// Gated like the Revenue tab (owner/admin). Wrapped in <Shell> — a page without it is invisible.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getAccess } from '@/lib/access'
import { Shell } from '@/components/Shell'
import { RevenueAppReconcile } from '@/components/RevenueAppReconcile'

export const dynamic = 'force-dynamic'

export default async function RevenueReconcilePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const access = await getAccess()
  if (!access.allowed || !access.levels['revenue']) redirect('/revenue')
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <RevenueAppReconcile initialMonth={month} />
      </div>
    </Shell>
  )
}
