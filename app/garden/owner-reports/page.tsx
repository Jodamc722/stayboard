// The Garden Hotel — owner-reports. Gated by the person's hotel role on 'owner-reports' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenOwnerReports } from '@/components/GardenOwnerReports'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenOwnerReportsPage() {
  const { canEdit, canFull } = await gardenPage('owner-reports')
  void canFull
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenOwnerReports canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
