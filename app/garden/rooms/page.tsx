// The Garden Hotel — rooms: the housekeeping board (components/GardenHKBoard). Gated by the person's hotel role on 'rooms' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenHKBoard } from '@/components/GardenHKBoard'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenRoomsPage() {
  const { canEdit } = await gardenPage('rooms')
  return (
    <Shell>
      <div className="max-w-[1400px] mx-auto">
        <GardenHKBoard canEdit={canEdit} />
      </div>
    </Shell>
  )
}
