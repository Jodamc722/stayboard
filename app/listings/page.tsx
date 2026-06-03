import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ListingsView } from './ListingsView'

export const dynamic = 'force-dynamic'

export default async function ListingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: rows }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_listings')
      .select('id, title, nickname, building, unit, room_type, tags, address_city, address_state, bedrooms, bathrooms, max_occupancy, status, amenities')
      .limit(1000),
    supabase.from('guesty_sync_status').select('last_sync_at').eq('entity', 'listings').maybeSingle()
  ])

  return (
    <Shell>
      <ListingsView listings={rows ?? []} lastSync={sync?.last_sync_at ?? null} />
    </Shell>
  )
}
