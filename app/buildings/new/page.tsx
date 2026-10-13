// NEW UNIT — the go-live intake, reached from Properties (Jon, 2026-10-13: "create a place in
// properties to add new unit"). Lives under /buildings so it inherits the Properties permission;
// the API re-checks edit on every call rather than trusting the path.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { LeanHead } from '@/components/lean'
import { NewUnit } from '@/components/NewUnit'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function NewUnitPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const access = await getAccess()
  if (!atLeast(access.levels['buildings'], 'edit')) redirect('/buildings')

  return (
    <Shell>
      <LeanHead title="New unit" sub="Answer once, push to Guesty, then connect the channels by hand — the only step there is no API for.">
        <Link href="/buildings" prefetch={false} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
          <ChevronLeft size={14} /> Properties
        </Link>
      </LeanHead>
      <NewUnit />
    </Shell>
  )
}
