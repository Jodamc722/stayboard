import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReservationsView } from './ReservationsView'

export const dynamic = 'force-dynamic'

export default async function ReservationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const todayStr = new Date().toISOString().slice(0, 10)

  // Upcoming first (>= today, ascending), then past (descending). Pull two sets to support tabbed UI.
  const [{ data: upcoming }, { data: past }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields')
      .gte('check_out', todayStr)
      .order('check_in', { ascending: true })
      .limit(500),
    supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields')
      .lt('check_out', todayStr)
      .order('check_in', { ascending: false })
      .limit(500),
    supabase.from('guesty_sync_status').select('last_sync_at, last_error, items_synced').eq('entity', 'reservations').maybeSingle()
  ])

  return (
    <Shell>
      <ReservationsView
        upcoming={upcoming ?? []}
        past={past ?? []}
        lastSync={sync?.last_sync_at ?? null}
        totalSynced={sync?.items_synced ?? 0}
      />
    </Shell>
  )
}
