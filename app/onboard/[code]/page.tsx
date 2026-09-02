import { OnboardForm } from '@/components/OnboardForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Onboarding inventory', robots: { index: false, follow: false } }

// Public, like /walk and /audit share links — the code IS the key and resolves to one onboarding
// unit. No Guesty listing is needed; the unit is assigned to one later from /onboarding.
export default function OnboardPage({ params }: { params: { code: string } }) {
  return <OnboardForm code={params.code} />
}
