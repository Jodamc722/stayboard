import { redirect } from 'next/navigation'
import { Star } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReviewsPanel } from '@/app/command/ReviewsPanel'

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

      <div className="grid grid-cols-1">
        <ReviewsPanel />
      </div>
    </Shell>
  )
}
