// The Garden Hotel — calendar (Cloudbeds hub, migration 118).
import { Shell } from '@/components/Shell'
import { GardenHub } from '@/components/GardenHub'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenCalendarPage() {
  const { canEdit } = await gardenPage('calendar')
  return (
    <Shell>
      <div className="max-w-[1200px] mx-auto">
        <GardenHub view="calendar" canEdit={canEdit} />
      </div>
    </Shell>
  )
}
