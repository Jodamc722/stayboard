import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sofa } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeApprovedCatalog } from '@/components/FfeApprovedCatalog'

export const dynamic = 'force-dynamic'

// THE 17 WEST CATALOG (Jon, 2026-10-20) — review the sourcing options, approve what the property
// may buy, and the approved view becomes the replacement list. Lives beside the FF&E audit.
export default async function Ffe17WestPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sofa size={13} /> Operations · <Link href="/ffe" className="hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={11} /> FF&amp;E</Link>
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">17 West furniture catalog</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Every item from the sourcing sheet with its photo and the options found: the HostGPO member price
          through Article, the Amazon listing from the sheet, and either City Home (delivered and set up) or
          Wayfair (chairs and sofas; flat-pack). Tap <b>Approve</b> on each option that&apos;s acceptable for 17 West.
          Approvals save for the whole team; once the review is done, <b>Approved catalog</b> is the replacement list.
        </p>
      </header>
      <FfeApprovedCatalog property="17-west" />
    </Shell>
  )
}
