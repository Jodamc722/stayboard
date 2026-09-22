// Owner Reports desk — generate + manage owner-facing performance reports.
// Each report is a shareable page at /r/[code] (guidebook trust model) that the
// team can edit in place; owners just get the link. The one-line header is drawn by ReportsDesk.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReportsDesk } from '@/components/ReportsDesk'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <ReportsDesk />
    </Shell>
  )
}
