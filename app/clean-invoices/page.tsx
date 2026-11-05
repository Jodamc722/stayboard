// Financials → Cleaning invoices (lib/clean-invoices): upload a vendor invoice, every line checked
// against the cleans on record, anything that does not match flagged before it is paid.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { CleanInvoices } from '@/components/CleanInvoices'

export const dynamic = 'force-dynamic'

export default async function CleanInvoicesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <div className="p-4 sm:p-6 max-w-[1300px] mx-auto"><CleanInvoices /></div>
    </Shell>
  )
}
