import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { NewRequestForm } from './NewRequestForm'

export const dynamic = 'force-dynamic'

export default async function NewRequestPage({ searchParams }: { searchParams: { listing?: string; reservation?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: listings } = await supabase
    .from('guesty_listings')
    .select('id, nickname, title, building, unit')
    .eq('status', 'active')
    .order('building')
    .limit(1000)

  return (
    <Shell>
      <NewRequestForm
        listings={listings ?? []}
        creatorEmail={user.email ?? null}
        prefillListingId={searchParams.listing ?? null}
        prefillReservationId={searchParams.reservation ?? null}
      />
    </Shell>
  )
}
