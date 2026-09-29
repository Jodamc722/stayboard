// The Garden Hotel — reviews. Gated by the person's hotel role on 'reviews' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenReviews } from '@/components/GardenOps'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenReviewsPage() {
  const { canEdit, canFull } = await gardenPage('reviews')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenReviews canEdit={canEdit} />
      </div>
    </Shell>
  )
}
