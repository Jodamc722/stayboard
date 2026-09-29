// The Garden Hotel — schedule. Gated by the person's hotel role on 'schedule' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenScheduler } from '@/components/GardenOps'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenSchedulePage() {
  const { canEdit, canFull } = await gardenPage('schedule')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenScheduler canEdit={canEdit} />
      </div>
    </Shell>
  )
}
