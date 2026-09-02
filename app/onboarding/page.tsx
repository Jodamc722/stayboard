// ONBOARDING — the desk side of the inventory links (Jon, 2026-09-02).
// Mint a link for a new unit (Guesty not required), watch progress, and assign it to the live
// listing once the unit exists in Guesty. The phone side is /onboard/<code> (public).
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { OnboardingDesk } from '@/components/OnboardingDesk'
import { ClipboardList } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <header className="mb-4 hidden sm:block">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ClipboardList size={13} /> Operations</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted mt-1">One link per new unit: details → rooms → inventory and photos. Works before the unit is in Guesty; assign it to the listing when it goes live.</p>
      </header>
      <OnboardingDesk />
    </Shell>
  )
}
