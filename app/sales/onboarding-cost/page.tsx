// ONBOARDING COST (Jon, 2026-11-20: "build it in app") — the sales estimator: what it costs to get a
// fully furnished new unit guest-ready. Linen at par from the saved linen standard, the onboarding
// clean, and inventory from the Default onboarding catalog. Under /sales, so the Sales key gates it.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { OnboardCostEstimator } from '@/components/OnboardCostEstimator'

export const dynamic = 'force-dynamic'

export default async function OnboardingCostPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <OnboardCostEstimator />
    </Shell>
  )
}
