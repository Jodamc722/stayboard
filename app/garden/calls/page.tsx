// The Garden Hotel — calls. Gated by the person's hotel role on 'calls' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenDesk } from '@/components/GardenDesk'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenCallsPage() {
  const { canEdit, canFull } = await gardenPage('calls')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenDesk view="calls" canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
