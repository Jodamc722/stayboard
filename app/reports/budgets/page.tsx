// Owner budgets settings — monthly budget (occupancy / ADR / RevPAR / gross revenue)
// per building + year. Feeds the "Performance vs Plan" section of Owner Reports;
// buildings with no budget rows simply don't get that section.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { BudgetEditor } from '@/components/BudgetEditor'
import { Target } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function BudgetsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Target size={13} /> Owner Reports</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Budgets</h1>
        <p className="text-sm text-muted mt-1">Monthly plan per building. Reports only show &ldquo;Performance vs Plan&rdquo; when a budget exists here.</p>
      </header>
      <BudgetEditor />
    </Shell>
  )
}
