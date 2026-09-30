// LINENS (Jon, 2026-09-29; tiers, quotes and ordering 2026-09-30) — the linen standard Jon edits, the
// calculator that sizes it for a set of units at a tier, and the quote for a unit with no listing.
// Sits under /onboarding, so the `onboarding` feature level decides who sees it: view reads, edit
// sets a unit's bed sizes and its chosen tier, full changes the standard (enforced by
// /api/onboard/linens, which also tells the page which of those this person has).
//
// ?unit=onboard:<code> or ?unit=<listingId> opens the Quote view filled in from that unit — the
// onboarding desk links every unit's linen line here.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { LinenDesk } from '@/components/LinenDesk'

export const dynamic = 'force-dynamic'

export default async function LinensPage({ searchParams }: { searchParams?: { unit?: string | string[] } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const raw = Array.isArray(searchParams?.unit) ? searchParams?.unit[0] : searchParams?.unit
  const unit = typeof raw === 'string' && /^(onboard:)?[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : undefined
  return (
    <Shell>
      <LinenDesk initialUnit={unit} />
    </Shell>
  )
}
