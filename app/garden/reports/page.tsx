// The Garden Hotel — reports. Gated by the person's hotel role on 'reports' (lib/garden/access).
import { Shell } from '@/components/Shell'
import { GardenReportsTabs } from '@/components/GardenReportsTabs'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenReportsPage() {
  const { canEdit, canFull } = await gardenPage('reports')
  return (
    <Shell>
      <div className="max-w-[1100px] mx-auto">
        <GardenReportsTabs canEdit={canEdit} owner={canFull} />
      </div>
    </Shell>
  )
}
