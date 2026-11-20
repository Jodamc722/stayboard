import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Sofa } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { FfeCatalogList } from '@/components/FfeCatalogList'
import { LeanHead } from '@/components/lean'

export const dynamic = 'force-dynamic'

// CATALOGS (Jon, 2026-10-27): the default onboarding catalog and one per property, each reviewed
// into an approved replacement list with its own share link.
export default async function FfeCatalogsPage() {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  return (
    <Shell>
      {/* CLEAN-UP (Jon, 2026-11-20): the one-line header every other page has. */}
      <LeanHead title="Catalog" icon={<Sofa size={18} className="text-muted" />} sub="The default onboarding catalog and one per property: what each may buy, with the links to buy from.">
        <Link href="/ffe" title="Where replacements get flagged, room by room" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:bg-app">FF&amp;E audit</Link>
      </LeanHead>
      <FfeCatalogList />
    </Shell>
  )
}
