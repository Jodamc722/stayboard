import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const [
    { count: totalReservations },
    { count: totalListings },
    { count: checkInsToday },
    { count: checkOutsToday },
    { count: activeNow },
    { data: syncStatus }
  ] = await Promise.all([
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }),
    supabase.from('guesty_listings').select('*', { count: 'exact', head: true }),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in',  todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).lte('check_in', todayStr).gt('check_out', todayStr),
    supabase.from('guesty_sync_status').select('entity, last_sync_at, last_error, items_synced')
  ])

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">STAYBOARD</h1>
          <p className="text-sm text-slate-500">Welcome back, {user.email?.split('@')[0]}</p>
        </div>
        <SyncNowButton />
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Listings"        value={totalListings ?? 0} />
        <Stat label="Reservations"    value={totalReservations ?? 0} />
        <Stat label="Active stays"    value={activeNow ?? 0} />
        <Stat label="Check-ins today" value={checkInsToday ?? 0} highlight />
        <Stat label="Check-outs today" value={checkOutsToday ?? 0} highlight />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-3">Quick links</h2>
          <div className="grid grid-cols-2 gap-3">
            <a href="/reservations" className="block p-4 rounded-lg border border-slate-200 hover:border-brand-500 transition">
              <div className="font-medium text-slate-900">Reservations</div>
              <div className="text-xs text-slate-500 mt-1">All bookings + custom field flags</div>
            </a>
            <a href="/listings" className="block p-4 rounded-lg border border-slate-200 hover:border-brand-500 transition">
              <div className="font-medium text-slate-900">Listings</div>
              <div className="text-xs text-slate-500 mt-1">Grouped by building, filter by tag</div>
            </a>
            <a href="/messages" className="block p-4 rounded-lg border border-slate-200 hover:border-brand-500 transition">
              <div className="font-medium text-slate-900">Messages</div>
              <div className="text-xs text-slate-500 mt-1">Guest conversations across channels</div>
            </a>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-3">Guesty sync</h2>
          {(syncStatus ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No sync yet — click "Sync now" above to pull from Guesty.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(syncStatus ?? []).map((s: any) => (
                <li key={s.entity} className="flex items-center justify-between">
                  <span className="text-slate-700 capitalize">{s.entity.replace('_', ' ')}</span>
                  <span className="text-xs text-slate-500">
                    {s.items_synced ?? 0} · {s.last_sync_at ? timeAgo(new Date(s.last_sync_at)) : 'never'}
                    {s.last_error && <span className="ml-2 text-rose-600">error</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-5 rounded-2xl border ${highlight ? 'bg-brand-500 text-white border-brand-500' : 'bg-white border-slate-200'}`}>
      <div className={`text-xs uppercase tracking-wider ${highlight ? 'text-white/80' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-3xl font-bold mt-1 ${highlight ? 'text-white' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}
function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
