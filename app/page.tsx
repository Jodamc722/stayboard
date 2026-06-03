import { redirect } from 'next/navigation'
import Link from 'next/link'
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
    { count: activeListings },
    { count: checkInsToday },
    { count: checkOutsToday },
    { count: activeNow },
    { data: arrivals },
    { data: departures },
    { data: syncStatus }
  ] = await Promise.all([
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }),
    supabase.from('guesty_listings').select('*', { count: 'exact', head: true }),
    supabase.from('guesty_listings').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in',  todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).lte('check_in', todayStr).gt('check_out', todayStr),
    supabase.from('guesty_reservations').select('id, guest_name, listing_name, nights, money_total, money_currency').eq('check_in', todayStr).limit(10),
    supabase.from('guesty_reservations').select('id, guest_name, listing_name, nights').eq('check_out', todayStr).limit(10),
    supabase.from('guesty_sync_status').select('entity, last_sync_at, last_error, items_synced').order('entity')
  ])

  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const greeting = greet(today.getHours())

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting}, {user.email?.split('@')[0]?.split('.')[0]}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{dateLabel}</p>
        </div>
        <SyncNowButton />
      </header>

      {/* Today */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="Check-ins today"  value={checkInsToday  ?? 0} accent />
        <Stat label="Check-outs today" value={checkOutsToday ?? 0} accent />
        <Stat label="Active stays"     value={activeNow      ?? 0} />
        <Stat label="Reservations"     value={totalReservations ?? 0} sub="all time" />
        <Stat label="Properties"       value={activeListings ?? 0}    sub={`${totalListings ?? 0} total`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Arrivals today */}
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Today · Arrivals</h2>
            <span className="text-xs text-slate-500">{arrivals?.length ?? 0}</span>
          </header>
          {(arrivals ?? []).length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">No check-ins today.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(arrivals ?? []).map((r: any) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">{r.guest_name || 'Guest'}</div>
                      <div className="text-xs text-slate-500 truncate">{r.listing_name} · {r.nights ?? '—'} nights</div>
                    </div>
                    {r.money_total != null && (
                      <span className="text-sm font-medium text-slate-700 whitespace-nowrap">
                        {money(r.money_total, r.money_currency)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Departures today */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Today · Departures</h2>
            <span className="text-xs text-slate-500">{departures?.length ?? 0}</span>
          </header>
          {(departures ?? []).length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">No check-outs today.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(departures ?? []).map((r: any) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">{r.guest_name || 'Guest'}</div>
                      <div className="text-xs text-slate-500 truncate">{r.listing_name}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Sync status */}
        <section className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <header className="flex items-baseline justify-between mb-2">
            <h2 className="font-semibold text-slate-900">Guesty sync</h2>
            <span className="text-xs text-slate-500">Auto every 15 min</span>
          </header>
          {(syncStatus ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No sync yet — click <strong>Sync now</strong> above.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(syncStatus ?? []).map((s: any) => (
                <div key={s.entity} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{(s.entity || '').replace('_', ' ')}</div>
                  <div className="text-xl font-bold text-slate-900 mt-0.5">{s.items_synced ?? 0}</div>
                  <div className={`text-[10px] mt-1 ${s.last_error ? 'text-rose-600' : 'text-slate-500'}`}>
                    {s.last_error ? 'last attempt errored' : (s.last_sync_at ? timeAgo(new Date(s.last_sync_at)) : 'never')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}

function greet(h: number) {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function Stat({ label, value, accent, sub }: { label: string; value: number; accent?: boolean; sub?: string }) {
  return (
    <div className={`rounded-2xl p-4 border ${accent ? 'bg-gradient-to-br from-brand-500 to-indigo-600 text-white border-brand-600' : 'bg-white border-slate-200'} shadow-sm`}>
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${accent ? 'text-white/80' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-3xl font-bold mt-1 leading-tight ${accent ? 'text-white' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className={`text-[10px] mt-0.5 ${accent ? 'text-white/70' : 'text-slate-400'}`}>{sub}</div>}
    </div>
  )
}

function money(v: any, currency?: string | null) {
  const n = Number(v); if (isNaN(n)) return '—'
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n) }
  catch { return `$${n.toLocaleString()}` }
}
function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
