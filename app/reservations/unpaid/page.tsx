import { Shell } from '@/components/Shell'
import { UnpaidBoard } from '@/components/UnpaidBoard'

export const dynamic = 'force-dynamic'

export default function UnpaidPage() {
  return (
    <Shell>
      <UnpaidBoard />
    </Shell>
  )
}
