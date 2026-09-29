// The Garden Hotel — settings. Gated by the person's hotel role on 'settings' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenSettings } from '@/components/GardenSettings'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenSettingsPage() {
  const { canEdit, canFull } = await gardenPage('settings')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenSettings owner={canFull} canEdit={canEdit} />
      </div>
    </Shell>
  )
}
