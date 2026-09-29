// The Garden Hotel — setup. Gated by the person's hotel role on 'setup' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenDesk } from '@/components/GardenDesk'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenSetupPage() {
  const { canEdit, canFull } = await gardenPage('setup')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenDesk view="setup" canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
