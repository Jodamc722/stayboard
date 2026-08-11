import { redirect } from 'next/navigation'
import Link from 'next/link'
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
        {/* Nav diet 2026-08-11 (Jon): reached from /labor's Board|Dashboard switcher. */}
        <span className="mt-3 inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          <Link href="/labor" prefetch={false} className="text-sm font-medium px-3 py-1.5 bg-white text-muted hover:bg-app">Board</Link>
          <span className="text-sm font-medium px-3 py-1.5 bg-ink text-white">Dashboard</span>
        </span>
      </header>
      <LaborDashboard />
    </Shell>
  )
}
