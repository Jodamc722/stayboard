import { redirect } from 'next/navigation'
import { ClipboardList, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReviewActionBoard } from '@/components/ReviewActionBoard'

export const dynamic = 'force-dynamic'

export default async function ReviewActionsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  return (
    <Shell>
      <header className="mb-6">
        <a href="/reviews" className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-muted font-semibold hover:text-ink">
          <ArrowLeft size={12} /> Reviews
        </a>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight flex items-center gap-2">
          <ClipboardList size={26} className="text-brand-600" /> Actions from feedback
        </h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          What guests raised in the last 10 days, turned into jobs and grouped by unit — so one visit
          closes everything outstanding on that door. Tick them off as they are done. Anything marked
          done that a guest raises again comes back flagged, because a fix that did not hold is the
          argument for replacing something rather than repairing it again.
        </p>
      </header>

      <ReviewActionBoard />
    </Shell>
  )
}
