// THE UNIT WALKTHROUGH COUNT SHEET. Public: the key in the emailed link is the pass, checked by /api/join/<code>/walk.
import { OwnerWalk } from '@/components/OwnerWalk'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Walkthrough · Stay Hospitality', robots: { index: false, follow: false } }
export default function WalkPage({ params, searchParams }: { params: { code: string }; searchParams: { k?: string } }) {
  return <OwnerWalk code={String(params.code || '')} k={String(searchParams?.k || '')} />
}
