import { Shell } from '@/components/Shell'
import { OrderDesk } from '@/components/OrderDesk'
import { ShoppingCart } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function OrdersPage() {
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ShoppingCart size={13} /> Operations</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Orders</h1>
        <p className="text-sm text-muted mt-1">Every Replace / Add need captured on audits, property-wide. Approve first, then track each line Ordered → Arriving → Complete, with product links and AI options.</p>
      </header>
      <OrderDesk />
    </Shell>
  )
}
