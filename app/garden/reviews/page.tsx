// The Garden Hotel — reviews. Gated by the hand-picked 'garden' key; see lib/garden.
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { GardenReviews } from '@/components/GardenOps'
import { getAccess, isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'

export default async function GardenReviewsPage() {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  const level = String(access.levels?.garden || 'off')
  if (level === 'off') redirect('/command')
  const canEdit = level === 'edit' || level === 'full'
  void isSuperadmin
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenReviews canEdit={canEdit} />
      </div>
    </Shell>
  )
}
