import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sofa } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeApprovedCatalog } from '@/components/FfeApprovedCatalog'
import { getCatalog } from '@/lib/ffe-approved-catalog'

export const dynamic = 'force-dynamic'

// ONE CATALOG: review the options, approve what the property may buy, see the approved list with
// its links, manage suppliers and items, and share the approved list.
export default async function FfeCatalogPage({ params }: { params: { slug: string } }) {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  const slug = String(params.slug || '')
  const cat = await getCatalog(slug)
  if (!cat) notFound()
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sofa size={13} /> Owners · <Link href="/catalogs" className="hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={11} /> Catalog</Link>
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">{cat.title}</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          {cat.kind === 'default'
            ? 'What every onboarding starts from. Approve here to set the house default; a property catalog can copy these decisions.'
            : 'Tap Approve on each option that’s acceptable here. The Approved list is what the team may buy when something needs replacing, and the share link opens it without a sign-in.'}
        </p>
      </header>
      <FfeApprovedCatalog property={slug} />
    </Shell>
  )
}
