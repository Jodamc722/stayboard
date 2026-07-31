// HOME = the KPI board. Everything it shows comes from /api/kpi, /api/reviews/kpi and
// /api/listing-health, so this file stays a thin authenticated shell and the numbers can be
// re-cut (period, market, building) without a page reload.
//
// The old home — arrival/departure lists, recent messages, needs-attention — lives on in the
// screens built for that work: /plan, /schedule, /messages, /requests. Every big number here
// links straight into one of them.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { KpiHome } from '@/components/KpiHome'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  })

  return (
    <Shell>
      <KpiHome dateLabel={dateLabel} />
    </Shell>
  )
}
