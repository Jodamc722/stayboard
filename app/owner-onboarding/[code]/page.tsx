// One owner's onboarding: the team's report, timeline, call, paperwork and handoff (lib/owner-onboard).
import { Shell } from '@/components/Shell'
import { OwnerOnboardingReport } from '@/components/OwnerOnboardingDesk'
export const dynamic = 'force-dynamic'
export default function OwnerOnboardingOne({ params }: { params: { code: string } }) { return <Shell><OwnerOnboardingReport code={String(params.code || '')} /></Shell> }
