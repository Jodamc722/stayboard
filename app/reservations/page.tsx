import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { ReservationsView } from './ReservationsView'

export const dynamic = 'force-dynamic'

// Statuses that are NOT real, active bookings — hidden from the board and money totals.
const DEAD_STATUSES = ['canceled', 'cancelled', 'declined', 'expired', 'denied']

// "Today" in Miami (America/New_York), not UTC — so arrivals/departures line up with the local day.
function miamiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

export default async function ReservationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const todayStr = miamiToday()
  const cols = 'id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields'

  // Upcoming first (>= today, ascending), then past (descending). Cancelled/declined/expired excluded from both.
  const [{ data: upcoming }, { data: past }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_reservations')
      .select(cols)
      .gte('check_out', todayStr)
      .not('status', 'in', `(${DEAD_STATUSES.join(',')})`)
      .order('check_in', { ascending: true })
      .limit(500),
    supabase
      .from('guesty_reservations')
      .select(cols)
      .lt('check_out', todayStr)
      .not('status', 'in', `(${DEAD_STATUSES.join(',')})`)
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
