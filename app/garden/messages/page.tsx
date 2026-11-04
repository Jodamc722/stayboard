// The Garden Hotel — the unified inbox (components/GardenInbox, lib/garden/inbox): guest threads,
// calls, voicemails, reviews and desk calls in one stream, sortable by source and booking channel.
import { Suspense } from 'react'
import { Shell } from '@/components/Shell'
import { GardenInbox } from '@/components/GardenInbox'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenMessagesPage() {
  const { canEdit } = await gardenPage('messages')
  return (
    <Shell>
      <div className="max-w-[1600px] mx-auto">
        {/* useSearchParams in GardenInbox needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <GardenInbox canEdit={canEdit} />
        </Suspense>
      </div>
    </Shell>
  )
}
