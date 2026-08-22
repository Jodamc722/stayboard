import { redirect } from 'next/navigation'
import { Star, ClipboardList, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReviewsPanel } from '@/app/command/ReviewsPanel'
import { ReviewKpis } from '@/components/ReviewKpis'
import { ReviewBreakdown } from '@/components/ReviewBreakdown'

export const dynamic = 'force-dynamic'

export default async function ReviewsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Star size={13} /> Guest reputation
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Reviews</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          The live Guesty review feed, surfacing low-rated stays and any guest reviews still
          awaiting a host response. Replies are AI-assisted but drafted manually — use the
          buttons on each review to draft and approve before anything goes out.
        </p>
      </header>

      <ReviewKpis />

      {/* WHERE the score comes from: property → unit, worst first. Sits under the headline strip
          because "how are we doing" is read first and "which building is dragging" second. */}
      <ReviewBreakdown />

      {/* The action board lives on its own page: it is a work queue, not a metric, and reading the
          reputation numbers is a different job from working the list. */}
      {/* Phone: the label, the one-line explanation and the chevron all on one row squeezed the
          explanation into a vertical ladder of words. Below sm the explanation drops to its own
          full-width line under the label + chevron; from sm up the row is unchanged. */}
      <a href="/reviews/actions"
        className="flex items-center gap-2 flex-wrap gap-y-1 rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 mb-5 hover:bg-brand-50 group">
        <ClipboardList size={16} className="text-brand-600 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink">Actions from feedback</span>
        <span className="order-last basis-full sm:order-none sm:basis-auto text-[12px] text-muted">Turn the last 10 days of guest complaints into jobs, grouped by unit</span>
        <ChevronRight size={15} className="ml-auto text-muted group-hover:text-brand-700 flex-shrink-0" />
      </a>

      <div className="grid grid-cols-1">
        <ReviewsPanel />
      </div>
    </Shell>
  )
}
