// OWNER ONBOARDING (lib/owner-onboard): every owner link, and a new one. Gated by the `owner-onboarding` feature.
import { Shell } from '@/components/Shell'
import { OwnerOnboardingDesk } from '@/components/OwnerOnboardingDesk'
export const dynamic = 'force-dynamic'
export default function OwnerOnboardingPage() { return <Shell><OwnerOnboardingDesk /></Shell> }
