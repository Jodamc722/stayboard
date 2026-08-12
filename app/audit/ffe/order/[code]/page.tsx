// The owner's link to one furniture order. Public by capability code — no login, one order wide.
// Covered by OPEN_PREFIXES '/audit/' in lib/features.ts.
import { FfeOwnerOrder } from '@/components/FfeOwnerOrder'

export const dynamic = 'force-dynamic'

export default function FfeOwnerOrderPage({ params }: { params: { code: string } }) {
  return <FfeOwnerOrder code={params.code} />
}
