import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sofa } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeCatalogList } from '@/components/FfeCatalogList'

export const dynamic = 'force-dynamic'

// CATALOGS (Jon, 2026-10-27): the default onboarding catalog and one per property, each reviewed
// into an approved replacement list with its own share link.
export default async function FfeCatalogsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
          <Sofa size={13} /> Owners
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Catalog</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">The default onboarding catalog and one per property. Review the options, approve what each property may buy, and the approved list — with its links — is what the team orders from. The <Link href="/ffe" className="underline decoration-line hover:text-ink">FF&amp;E audit</Link> is where replacements get flagged.</p>
      </header>
      <FfeCatalogList />
    </Shell>
  )
}
