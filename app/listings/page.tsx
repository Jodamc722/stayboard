import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ListingsView } from './ListingsView'

export const dynamic = 'force-dynamic'

export default async function ListingsPage({ searchParams }: { searchParams: { tag?: string; q?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: rows }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_listings')
      .select('id, title, nickname, building, unit, room_type, tags, address_city, address_state, bedrooms, bathrooms, max_occupancy, status, amenities')
      .order('building', { ascending: true, nullsFirst: false })
      .order('nickname', { ascending: true })
      .limit(500),
    supabase.from('guesty_sync_status').select('last_sync_at').eq('entity', 'listings').maybeSingle()
  ])

  return (
    <Shell>
      <ListingsView
        listings={rows ?? []}
        lastSync={sync?.last_sync_at ?? null}
        selectedTag={searchParams.tag ?? null}
        query={searchParams.q ?? ''}
      />
    </Shell>
  )
}
