// The Garden Hotel — calendar (Cloudbeds hub, migration 118). Two views on one page:
//   Rooms (default)        the multi-calendar: rooms × nights with reservations and blocks as bars
//   Rates & availability   the room-type rate / availability grid (GardenHub view="calendar")
// ?view=rates opens the second; the switch keeps the URL in step without a reload.
import { Shell } from '@/components/Shell'
import { GardenCalendarViews } from '@/components/GardenMultiCalendar'
import { gardenPage } from '@/lib/garden/access'

export const dynamic = 'force-dynamic'

export default async function GardenCalendarPage({ searchParams }: { searchParams?: { view?: string } }) {
  const { canEdit } = await gardenPage('calendar')
  return (
    <Shell>
      <div className="max-w-[1600px] mx-auto">
        <GardenCalendarViews canEdit={canEdit} initial={searchParams?.view === 'rates' ? 'rates' : 'rooms'} />
      </div>
    </Shell>
  )
}
