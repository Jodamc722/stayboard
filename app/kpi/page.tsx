// THE KPI BOARD — occupancy, ADR, RevPAR, review scores, listing health.
//
// This was the app's home page until 2026-08-24, when Jon moved the front door to Today in Ops
// ("home page is a bust"). The numbers were never the problem; being the first thing you saw was.
// It keeps the `home` feature key so every per-role permission set against it still applies.
//
// Everything it shows comes from /api/kpi, /api/reviews/kpi and /api/listing-health, so this file
// stays a thin authenticated shell and the numbers can be re-cut (period, market, building)
// without a page reload. Every big number links straight into the screen built for that work.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { KpiHome } from '@/components/KpiHome'

export const dynamic = 'force-dynamic'

export default async function KpiPage() {
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
