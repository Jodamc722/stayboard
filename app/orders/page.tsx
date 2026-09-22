import { Shell } from '@/components/Shell'
import { OrderDesk } from '@/components/OrderDesk'

export const dynamic = 'force-dynamic'

// The one-line header (title + counts) lives inside OrderDesk, because the counts do.
export default function OrdersPage() {
  return (
    <Shell>
      <OrderDesk />
    </Shell>
  )
}
