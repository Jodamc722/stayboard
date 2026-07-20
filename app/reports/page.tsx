// Owner Reports desk — generate + manage owner-facing performance reports.
// Each report is a shareable page at /r/[code] (guidebook trust model) that the
// team can edit in place; owners just get the link.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReportsDesk } from '@/components/ReportsDesk'
import { FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><FileText size={13} /> Performance</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Owner Reports</h1>
        <p className="text-sm text-muted mt-1">Generate a polished owner review from live data, edit it in place, share the link.</p>
      </header>
      <ReportsDesk />
    </Shell>
  )
}
