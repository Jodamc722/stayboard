import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'
import { ArrowUpRight, LogIn, LogOut, Users, Building2, Calendar } from 'lucide-react'

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
    supabase.from('guesty_reservations').select('id, guest_name, listing_name, nights, money_total, money_currency').eq('check_in', todayStr).order('listing_name').limit(12),
    supabase.from('guesty_reservations').select('id, guest_name, listing_name, nights').eq('check_out', todayStr).order('listing_name').limit(12),
    supabase.from('guesty_sync_status').select('entity, last_sync_at, last_error, items_synced').order('entity')
  ])

  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const greeting = greet(today.getHours())
  const firstName = user.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, c => c.toUpperCase()) || 'there'

  return (
    <Shell>
      {/* Hero */}
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">{dateLabel}</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">{greeting}, {firstName}</h1>
        </div>
        <SyncNowButton />
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
        <Stat label="Check-ins today"  value={checkInsToday  ?? 0} accent="indigo" Icon={LogIn} />
        <Stat label="Check-outs today" value={checkOutsToday ?? 0} accent="indigo" Icon={LogOut} />
        <Stat label="Active stays"     value={activeNow      ?? 0} Icon={Users} />
        <Stat label="Reservations"     value={totalReservations ?? 0} sub="all time" Icon={Calendar} />
        <Stat label="Active properties" value={activeListings ?? 0} sub={`${totalListings ?? 0} total`} Icon={Building2} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Arrivals */}
        <Section title="Today · Arrivals" count={arrivals?.length ?? 0} accent className="lg:col-span-2">
          {(arrivals ?? []).length === 0 ? (
            <Empty>No check-ins today.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {(arrivals ?? []).map((r: any) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                    <Avatar name={r.guest_name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate text-sm">{r.guest_name || 'Guest'}</div>
                      <div className="text-xs text-muted truncate">{r.listing_name} · {r.nights ?? '—'} nights</div>
                    </div>
                    {r.money_total != null && (
                      <span className="text-sm font-semibold text-ink whitespace-nowrap">{money(r.money_total, r.money_currency)}</span>
                    )}
                    <ArrowUpRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Departures */}
        <Section title="Today · Departures" count={departures?.length ?? 0}>
          {(departures ?? []).length === 0 ? (
            <Empty>No check-outs today.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {(departures ?? []).map((r: any) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                    <Avatar name={r.guest_name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate text-sm">{r.guest_name || 'Guest'}</div>
                      <div className="text-xs text-muted truncate">{r.listing_name}</div>
                    </div>
                    <ArrowUpRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Sync */}
        <Section title="Guesty sync" subtitle="Auto every 15 min" className="lg:col-span-3">
          {(syncStatus ?? []).length === 0 ? (
            <Empty>No sync yet — click <strong>Sync now</strong> above.</Empty>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4">
              {(syncStatus ?? []).map((s: any) => (
                <div key={s.entity} className="rounded-xl border border-line p-3 hover:border-brand-200 transition-colors">
                  <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{(s.entity || '').replace('_', ' ')}</div>
                  <div className="text-2xl font-bold text-ink mt-0.5 tracking-tight">{s.items_synced ?? 0}</div>
                  <div className={`text-[10px] mt-1 flex items-center gap-1 ${s.last_error ? 'text-rose-600' : 'text-muted'}`}>
                    {s.last_error ? <span className="w-1.5 h-1.5 rounded-full bg-rose-500"/> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>}
                    {s.last_error ? 'errored' : (s.last_sync_at ? timeAgo(new Date(s.last_sync_at)) : 'never')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Shell>
  )
}

function greet(h: number) {
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function Stat({ label, value, accent, sub, Icon }: { label: string; value: number; accent?: 'indigo'; sub?: string; Icon?: any }) {
  if (accent === 'indigo') {
    return (
      <div className="relative rounded-2xl p-4 bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lifted overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10 blur-xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-white/80">{label}</div>
            {Icon && <Icon size={14} className="text-white/70" />}
          </div>
          <div className="text-3xl font-bold mt-1 leading-none tracking-tight">{value}</div>
          {sub && <div className="text-[10px] mt-1.5 text-white/70">{sub}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl p-4 bg-white border border-line shadow-soft">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted">{label}</div>
        {Icon && <Icon size={14} className="text-muted/60" />}
      </div>
      <div className="text-3xl font-bold mt-1 leading-none tracking-tight text-ink">{value}</div>
      {sub && <div className="text-[10px] mt-1.5 text-muted">{sub}</div>}
    </div>
  )
}

function Section({ title, subtitle, count, accent, className, children }:
  { title: string; subtitle?: string; count?: number; accent?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={`bg-white rounded-2xl border border-line shadow-soft overflow-hidden ${className || ''}`}>
      <header className="px-4 py-3 border-b border-line flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          {accent && <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
          <h2 className="font-semibold text-ink text-[15px] tracking-tight">{title}</h2>
          {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
        </div>
        {count != null && <span className="text-xs text-muted">{count}</span>}
      </header>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-sm text-muted text-center">{children}</p>
}

function Avatar({ name }: { name: string | null }) {
  const init = (name || 'G').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  // Deterministic color from name
  let h = 0
  for (const c of (name || 'G')) h = (h * 31 + c.charCodeAt(0)) % 360
  const bg = `hsl(${h}, 55%, 92%)`
  const fg = `hsl(${h}, 45%, 35%)`
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0" style={{ background: bg, color: fg }}>
      {init}
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
