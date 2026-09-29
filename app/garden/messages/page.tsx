// The Garden Hotel — messages (Cloudbeds hub, migration 118).
import { Shell } from '@/components/Shell'
import { GardenHub } from '@/components/GardenHub'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenMessagesPage() {
  const { canEdit } = await gardenPage('messages')
  return (
    <Shell>
      <div className="max-w-[1200px] mx-auto">
        <GardenHub view="messages" canEdit={canEdit} />
      </div>
    </Shell>
  )
}
