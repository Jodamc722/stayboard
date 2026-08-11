import { redirect } from 'next/navigation'

// Nav diet 2026-08-11 (Jon): the Listings index was a near-duplicate of Properties.
// Old links keep working via this redirect; unit detail pages (/listings/[id]) are untouched
// and stay linked from every building page.
export const dynamic = 'force-dynamic'

export default function ListingsPage() {
  redirect('/buildings')
}
