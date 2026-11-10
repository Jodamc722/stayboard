// The Garden Hotel — guest profiles (components/GardenGuests, lib/garden/guests).
import { Suspense } from 'react'
import { Shell } from '@/components/Shell'
import { GardenGuests } from '@/components/GardenGuests'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenGuestsPage() {
  await gardenPage('guests')
  return (
    <Shell>
      <div className="max-w-[1400px] mx-auto">
        <Suspense fallback={null}><GardenGuests /></Suspense>
      </div>
    </Shell>
  )
}
