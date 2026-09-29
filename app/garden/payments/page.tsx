// The Garden Hotel — payments (Cloudbeds hub, migration 118).
import { Shell } from '@/components/Shell'
import { GardenHub } from '@/components/GardenHub'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenPaymentsPage() {
  const { canEdit } = await gardenPage('payments')
  return (
    <Shell>
      <div className="max-w-[1200px] mx-auto">
        <GardenHub view="payments" canEdit={canEdit} />
      </div>
    </Shell>
  )
}
