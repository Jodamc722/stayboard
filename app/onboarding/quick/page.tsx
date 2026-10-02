// QUICK ONBOARDING — many units, one simple card each (Jon, 2026-10-02). Gated by the `onboarding`
// feature through its path prefix; the API checks the level on every call.
import { Shell } from '@/components/Shell'
import { QuickOnboarding } from '@/components/QuickOnboarding'
export const dynamic = 'force-dynamic'
export default function QuickOnboardingPage() {
  return (
    <Shell>
      <QuickOnboarding />
    </Shell>
  )
}
