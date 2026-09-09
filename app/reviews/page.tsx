import { redirect } from 'next/navigation'
import { Star, ClipboardList, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReviewsPage } from '@/components/ReviewsPage'

export const dynamic = 'force-dynamic'

// GUEST REPUTATION. Rebuilt 2026-09-09 (Jon: "get rid of this recovery, create better robust
// dashboard… this is how we manage reputation, this is the core driver of feedback and
// understanding where we are failing as operators… the main page should be KPI and where we can
// review or respond to reviews").
//
// What used to be here: a reputation strip with five folds, a separate breakdown table with its own
// period control, a 57-row Recovery section that printed a full guest quote per unit and ran off the
// right edge, and the review feed at the bottom with no connection to any of it. Four sections, three
// date windows, no owner anywhere, and nothing on the page that turned a bad score into a job.
//
// What is here now: one filter bar (period · market · building · owner · channel), the numbers, the
// units that need someone — each opening onto the review that put it there and a button that books
// the walk — and the feed, obeying the same bar. Recovery survives as a chip on the unit's own row.
export default async function ReviewsRoute() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  return (
    <Shell>
      <header className="mb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Star size={13} /> Guest reputation
        </p>
        <h1 className="text-[20px] font-bold text-ink mt-0.5 tracking-tight">Reviews</h1>
      </header>

      <ReviewsPage />

      {/* The action board is a work queue built from complaint THEMES, which is a different job from
          reading the score — so it keeps its own page rather than becoming a sixth section here. */}
      <a href="/reviews/actions"
        className="flex items-center gap-2 flex-wrap gap-y-1 rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3 mt-5 hover:bg-brand-50 group">
        <ClipboardList size={16} className="text-brand-600 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-ink">Actions from feedback</span>
        <span className="order-last basis-full sm:order-none sm:basis-auto text-[12px] text-muted">Turn the last 10 days of guest complaints into jobs, grouped by unit</span>
        <ChevronRight size={15} className="ml-auto text-muted group-hover:text-brand-700 flex-shrink-0" />
      </a>
    </Shell>
  )
}
