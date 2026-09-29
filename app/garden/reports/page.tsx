// The Garden Hotel — reports. Gated by the person's hotel role on 'reports' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenDesk } from '@/components/GardenDesk'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenReportsPage() {
  const { canEdit, canFull } = await gardenPage('reports')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenDesk view="reports" canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
