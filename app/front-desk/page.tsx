// THE FRONT DESK — arrivals as cards that travel Notice → Call → Ready, the team's day, and the
// week's billable hours (Jon, 2026-10-01). Everything it reads is /api/front-desk; everything it
// writes goes through the Calls desk's and the Notices desk's own endpoints.
import { Shell } from '@/components/Shell'
import { FrontDeskBoard } from '@/components/FrontDeskBoard'
export const dynamic = 'force-dynamic'
export default function FrontDeskPage() {
  return (
    <Shell>
      <FrontDeskBoard />
    </Shell>
  )
}
