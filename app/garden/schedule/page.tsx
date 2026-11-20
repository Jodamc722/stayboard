// The Garden Hotel — schedule. Gated by the person's hotel role on 'schedule' (lib/garden/access).
// Two views: the housekeeping day (assigning needs edit on Rooms & cleans) and the staff week.
import { Shell } from '@/components/Shell'
import { GardenScheduleTabs } from '@/components/GardenScheduleTabs'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenSchedulePage() {
  const { canEdit, access } = await gardenPage('schedule')
  const canAssign = ['edit', 'full'].includes(String(access.garden?.levels?.rooms))
  return (
    <Shell>
      <div className="max-w-[1500px] mx-auto">
        <GardenScheduleTabs canEdit={canEdit} canAssign={canAssign} />
      </div>
    </Shell>
  )
}
