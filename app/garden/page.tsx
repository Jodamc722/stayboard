// The Garden Hotel — today. Gated by the person's hotel role on 'today' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenDesk } from '@/components/GardenDesk'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenTodayPage() {
  const { canEdit, canFull } = await gardenPage('today')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenDesk view="today" canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
