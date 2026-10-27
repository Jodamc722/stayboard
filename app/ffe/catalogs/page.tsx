import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sofa } from 'lucide-react'
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
          <Sofa size={13} /> Operations · <Link href="/ffe" className="hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={11} /> FF&amp;E</Link>
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Furniture catalogs</h1>
      </header>
      <FfeCatalogList />
    </Shell>
  )
}
