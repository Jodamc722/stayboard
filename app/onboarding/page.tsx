// ONBOARDING — the desk side of the inventory links (Jon, 2026-09-02).
// Mint a link for a new unit (Guesty not required), watch progress, and assign it to the live
// listing once the unit exists in Guesty. The phone side is /onboard/<code> (public).
// The one-line header (title + counts) is rendered by OnboardingDesk, which owns the counts.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { OnboardingDesk } from '@/components/OnboardingDesk'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <OnboardingDesk />
    </Shell>
  )
}
