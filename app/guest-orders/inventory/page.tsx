import { Shell } from '@/components/Shell'
import { InventoryBoard } from '@/components/InventoryBoard'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Package } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function GuestOrdersInventoryPage() {
  const access = await getAccess()
  const canEdit = atLeast(access.levels['guest-orders'], 'edit')
  return (
    <Shell>
      <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><Package size={13} /> Guests · Guest Orders</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Inventory</h1>
          <p className="text-sm text-muted mt-1">One hub at a time — what is on it, what it costs us, and where to buy it again. Anything that reaches zero disappears from the guest form on its own.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/guest-orders/design" className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">Design studio</Link>
          <Link href="/guest-orders" className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300">← Back to the board</Link>
        </div>
      </header>
      <InventoryBoard canEdit={canEdit} />
    </Shell>
  )
}
