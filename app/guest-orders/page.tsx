import { Shell } from '@/components/Shell'
import { GuestOrdersBoard } from '@/components/GuestOrdersBoard'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function GuestOrdersPage() {
  const access = await getAccess()
  const canEdit = atLeast(access.levels['guest-orders'], 'edit')
  const canMoney = atLeast(access.levels['guest-orders'], 'full')
  // The one-line header (title + lane counts) is drawn by the board, because the counts load there.
  return (
    <Shell>
      <GuestOrdersBoard canEdit={canEdit} canMoney={canMoney} />
    </Shell>
  )
}
