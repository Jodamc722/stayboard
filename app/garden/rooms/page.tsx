// The Garden Hotel — rooms. Gated by the person's hotel role on 'rooms' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenDesk } from '@/components/GardenDesk'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenRoomsPage() {
  const { canEdit, canFull } = await gardenPage('rooms')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenDesk view="rooms" canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
