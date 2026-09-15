// THE PAGE A VENDOR OPENS. No login, no Lighthouse account, usually a phone in a stairwell.
import type { Metadata } from 'next'
import { VendorJobsView } from '@/components/VendorJobsView'

export const dynamic = 'force-dynamic'
// A work list is nobody's business but ours and theirs, and search engines have no part in it.
export const metadata: Metadata = { title: 'Your jobs — Stay Hospitality', robots: { index: false, follow: false } }

export default function VendorJobsPage({ params }: { params: { token: string } }) {
  return <VendorJobsView token={params.token} />
}
