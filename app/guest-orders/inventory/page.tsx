// Inventory moved INTO the Guest Orders tabs (Jon, 2026-09-10: "the count and costs should be done
// in the guest order tab in the app"). This path stays so old bookmarks and links land where the
// thing went, rather than on a page that quietly no longer exists.
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function GuestOrdersInventoryPage() {
  redirect('/guest-orders?tab=stock')
}
