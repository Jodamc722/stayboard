import { Shell } from '@/components/Shell'
import { ClaimDesk } from '@/components/ClaimDesk'

export const dynamic = 'force-dynamic'

export default function ClaimPage({ params }: { params: { id: string } }) {
  return (
    <Shell>
      <ClaimDesk id={params.id} />
    </Shell>
  )
}
