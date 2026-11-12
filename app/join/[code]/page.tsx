// THE OWNER'S ONBOARDING LINK (lib/owner-onboard). Public: the code is the key, checked by /api/join on every call.
import { OwnerJoin } from '@/components/OwnerJoin'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your onboarding · Stay Hospitality', robots: { index: false, follow: false } }
export default function JoinPage({ params }: { params: { code: string } }) {
  return <OwnerJoin code={String(params.code || '')} />
}
