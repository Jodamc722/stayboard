// PARKING (Jon, 2026-10-26) — the lots we run ourselves. Eden first: 10 spots sold at $30 a night,
// 3 held for staff and never sold; the calendar of who is in which spot, the cars that should not
// be there, and the staff link for the person standing in the lot.
import { Shell } from '@/components/Shell'
import { ParkingDesk } from '@/components/ParkingDesk'

export const dynamic = 'force-dynamic'

export default function ParkingPage() {
  return (
    <Shell>
      <ParkingDesk />
    </Shell>
  )
}
