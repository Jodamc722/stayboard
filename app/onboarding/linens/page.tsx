// LINENS (Jon, 2026-09-29) — the linen standard Jon edits, and the calculator that sizes it for a set
// of units at the vendor's prices. Sits under /onboarding, so the `onboarding` feature level decides
// who sees it: view reads, edit sets a unit's bed sizes, full changes the standard (enforced by
// /api/onboard/linens, which also tells the page which of those this person has).
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { LinenDesk } from '@/components/LinenDesk'

export const dynamic = 'force-dynamic'

export default async function LinensPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <Shell>
      <LinenDesk />
    </Shell>
  )
}
