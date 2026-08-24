import { Shell } from '@/components/Shell'
import { GuestOrdersBoard } from '@/components/GuestOrdersBoard'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { ShoppingBag } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function GuestOrdersPage() {
  const access = await getAccess()
  const canEdit = atLeast(access.levels['guest-orders'], 'edit')
  const canMoney = atLeast(access.levels['guest-orders'], 'full')
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><ShoppingBag size={13} /> Guests</p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Guest Orders</h1>
        <p className="text-sm text-muted mt-1">Pre-arrival extras guests pick from their reservation link. Approve → charged on the card in Guesty → pushed to Breezeway and the crew on the delivery day.</p>
      </header>
      <GuestOrdersBoard canEdit={canEdit} canMoney={canMoney} />
    </Shell>
  )
}
