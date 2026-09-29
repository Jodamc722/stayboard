// The Garden Hotel — Handbook: the hotel's own SOPs (migration 118).
import { Shell } from '@/components/Shell'
import { GardenHandbook } from '@/components/GardenHandbook'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenHandbookPage() {
  const { canEdit, canFull } = await gardenPage('handbook')
  return (
    <Shell>
      <div className="max-w-[1000px] mx-auto">
        <GardenHandbook canEdit={canEdit} canFull={canFull} />
      </div>
    </Shell>
  )
}
