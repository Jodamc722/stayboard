import { Shell } from '@/components/Shell'
import { ClaimsBoard } from '@/components/ClaimsBoard'

export const dynamic = 'force-dynamic'

// The one-line header (title + totals) lives inside ClaimsBoard, because the totals do.
export default function ClaimsPage() {
  return (
    <Shell>
      <ClaimsBoard />
    </Shell>
  )
}
