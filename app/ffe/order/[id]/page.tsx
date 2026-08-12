// One order, inside the app. Sits under the '/ffe' feature in lib/features.ts, so whoever can see
// FF&E can see an order and whoever has edit can move it along.
import { redirect } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeOrderDetail } from '@/components/FfeOrderDetail'

export const dynamic = 'force-dynamic'

export default async function FfeOrderPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <ShoppingCart size={13} /> FF&amp;E order
        </p>
      </header>
      <FfeOrderDetail id={params.id} />
    </Shell>
  )
}
