import { redirect } from 'next/navigation'
import { Timer } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { LaborDashboard } from '@/components/LaborDashboard'

export const dynamic = 'force-dynamic'

export default async function LaborDashboardPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Timer size={13} /> Team
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Labor Dashboard</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Payroll, the work it bought, and anything that looks off — by day, week or month. The same figures
          the daily labor email is built from, so the screen and the inbox can never disagree. Billables run
          on a wider rolling window because owner billing gets edited after the fact.
        </p>
      </header>
      <LaborDashboard />
    </Shell>
  )
}
