// The Garden Hotel — schedule. Gated by the person's hotel role on 'schedule' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenScheduleGrid } from '@/components/GardenScheduleGrid'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenSchedulePage() {
  const { canEdit } = await gardenPage('schedule')
  return (
    <Shell>
      <div className="max-w-[1500px] mx-auto">
        <GardenScheduleGrid canEdit={canEdit} />
      </div>
    </Shell>
  )
}
