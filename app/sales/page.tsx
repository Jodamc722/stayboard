// SALES (Jon, 2026-11-11: "it should be where the owner reports work, but let's create a sales tab…
// separate, and those builds should live there"). The sales decks: the Owner Reports engine in its
// sales mode, so each deck is still one owner_reports row with one /r/<code> link — keynote slides
// with Present, PDF and PowerPoint, and the magazine at ?view=magazine — plus the floor plans and
// comps editor for a building package.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReportsDesk } from '@/components/ReportsDesk'

export const dynamic = 'force-dynamic'

export default async function SalesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <ReportsDesk scope="sales" />
    </Shell>
  )
}
