import { redirect } from 'next/navigation'
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
// What is here now: a one-line header of pills, one filter bar (period · market · building · owner ·
// channel), and tabs — To reply · Units (each opening onto the review that put it there and a
// button that books the walk) · Buildings · All reviews — all obeying the same bar. Recovery
// survives as a tag on the unit's own row.
export default async function ReviewsRoute() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')

  // Header, tabs and the "Actions from feedback" link all live in <ReviewsPage> now (lean pass).
  return (
    <Shell>
      <ReviewsPage />
    </Shell>
  )
}
