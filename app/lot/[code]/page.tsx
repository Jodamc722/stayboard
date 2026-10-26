// THE STAFF SIDE OF A LOT (Jon, 2026-10-26): no login — the code in the link is the key. Check or
// scan a plate, walk the spots, flag what should not be there, send the notice, draft the tow.
import { LotSweep } from '@/components/LotSweep'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Parking — lot check' }

export default function LotPage({ params }: { params: { code: string } }) {
  return <LotSweep code={params.code} />
}
