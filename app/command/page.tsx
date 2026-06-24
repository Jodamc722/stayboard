import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { PendingRow } from './ApprovalActions'
import { ReviewsPanel } from './ReviewsPanel'
import {
  ArrowUpRight, CheckCircle2, Clock, AlertTriangle, LogIn, LogOut,
  ClipboardCheck, ListTodo, Bell, Lightbulb, TrendingUp, CalendarClock, Search
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['canceled', 'cancelled', 'declined', 'expired', 'denied']

function miamiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}
function addDays(iso: string, n: number) {
  const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10)
}
function buildingOf(name?: string) {
  if (!name) return '—'
  const head = name.split(' - ')[0].trim()
  return head.split(/\s|\//)[0] || head
}

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const todayStr = miamiToday()
  const in7 = addDays(todayStr, 7)
  const notDead = (q: any) => q.not('status', 'in', `(${DEAD.join(',')})`)

  const [
    { data: pending },
    { data: openWork },
    { count: pendingCount },
    { count: openCount },
    { count: checkInsToday },
    { count: checkOutsToday },
    { count: arrivals7 },
    { data: arrivals },
    { data: departures },
    { data: upcoming7 },
    { data: sync },
  ] = await Promise.all([
    supabase.from('field_requests').select('id,title,type,priority,building,unit,vendor,amount_usd,due_at,created_at,status')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
    supabase.from('field_requests').select('id,title,type,priority,building,unit,assignee_email,due_at,status')
      .in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(20),
    supabase.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    notDead(supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', todayStr)),
    notDead(supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', todayStr)),
    notDead(supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).gt('check_in', todayStr).lte('check_in', in7)),
    notDead(supabase.from('guesty_reservations').select('id,guest_name,listing_name,nights').eq('check_in', todayStr).order('listing_name').limit(10)),
    notDead(supabase.from('guesty_reservations').select('id,guest_name,listing_name').eq('check_out', todayStr).order('listing_name').limit(10)),
    notDead(supabase.from('guesty_reservations').select('listing_name,money_total').gt('check_in', todayStr).lte('check_in', in7)),
    supabase.from('guesty_sync_status').select('entity,last_sync_at,last_error'),
  ])

  const overdue = (openWork ?? []).filter((r: any) => r.due_at && r.due_at < todayStr)

  const rev7 = (upcoming7 ?? []).reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)
  const revLabel = rev7 >= 10000 ? `$${Math.round(rev7 / 1000)}k` : `$${Math.round(rev7).toLocaleString()}`

  const counts: Record<string, number> = {}
  for (const r of (upcoming7 ?? [])) { const b = buildingOf(r.listing_name); counts[b] = (counts[b] || 0) + 1 }
  const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]

  const resSync = (sync ?? []).find((s: any) => s.entity === 'reservations')
  const guestyFresh = resSync?.last_sync_at && (Date.now() - new Date(resSync.last_sync_at).getTime()) < 6 * 3600 * 1000

  const dateLabel = new Date(todayStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const firstName = user.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, c => c.toUpperCase()) || 'there'
  const needYou = (pendingCount ?? 0) + overdue.length

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Mission Control</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">{dateLabel}</h1>
          <p className="text-sm text-muted mt-1">Everything that needs you, {firstName} — review, approve, direct.</p>
        </div>
        <div className="flex items-center gap-2">
          {needYou > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl">
              <Bell size={14} /> {needYou} need you
            </span>
          )}
          <Link href="/reservations" className="inline-flex items-center gap-1.5 text-sm text-muted border border-line px-3 py-1.5 rounded-xl hover:bg-app transition-colors">
            <Search size={14} /> Reservations
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <Stat label="Awaiting approval" value={pendingCount ?? 0} accent={pendingCount ? 'indigo' : undefined} Icon={ClipboardCheck} />
        <Stat label="Overdue" value={overdue.length} accent={overdue.length ? 'red' : undefined} Icon={AlertTriangle} />
        <Stat label="Open work" value={openCount ?? 0} Icon={ListTodo} />
        <Stat label="Check-ins today" value={checkInsToday ?? 0} Icon={LogIn} />
        <Stat label="Check-outs today" value={checkOutsToday ?? 0} Icon={LogOut} />
        <Stat label="Arrivals · 7d" value={arrivals7 ?? 0} Icon={CalendarClock} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="Needs your approval" subtitle="One queue — reviews, maintenance, pricing, tasks" count={pending?.length ?? 0} accent className="lg:col-span-2">
          {(pending ?? []).length === 0 ? (
            <Empty>Nothing waiting on you. <CheckCircle2 size={14} className="inline -mt-0.5 text-emerald-500" /></Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {(pending ?? []).map((r: any) => <PendingRow key={r.id} r={r} />)}
            </ul>
          )}
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Today · Arrivals" count={arrivals?.length ?? 0}>
            {(arrivals ?? []).length === 0 ? <Empty>No check-ins today.</Empty> : (
              <ul className="divide-y divide-line/70">
                {(arrivals ?? []).map((r: any) => (
                  <li key={r.id}>
                    <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                      <Avatar name={r.guest_name} kind="in" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-ink truncate text-sm">{r.guest_name || 'Guest'}</div>
                        <div className="text-xs text-muted truncate">{r.listing_name} · {r.nights ?? '—'} nts</div>
                      </div>
                      <ArrowUpRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Today · Departures" count={departures?.length ?? 0}>
            {(departures ?? []).length === 0 ? <Empty>No check-outs today.</Empty> : (
              <ul className="divide-y divide-line/70">
                {(departures ?? []).map((r: any) => (
                  <li key={r.id}>
                    <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                      <Avatar name={r.guest_name} kind="out" />
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
        </div>

        <Section title="Insights" subtitle="The model is watching the data" className="lg:col-span-2"
          icon={<Lightbulb size={15} className="text-amber-500" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            <Insight label="Booked revenue · next 7 days" value={revLabel}
              note={`${arrivals7 ?? 0} arrivals confirmed`} Icon={TrendingUp} />
            <Insight label="Busiest building this week" value={busiest ? busiest[0] : '—'}
              note={busiest ? `${busiest[1]} arrivals in 7 days` : 'No upcoming arrivals'} Icon={CalendarClock} />
            <Insight label="Overdue work" value={String(overdue.length)}
              note={overdue.length ? 'Items past due — clear these first' : 'Nothing past due'} Icon={AlertTriangle} accent={overdue.length ? 'red' : undefined} />
            <Insight label="Guesty sync" value={guestyFresh ? 'Live' : 'Stale'}
              note={resSync?.last_sync_at ? `Last ${new Date(resSync.last_sync_at).toLocaleString()}` : 'Awaiting first sync'} Icon={CheckCircle2} accent={guestyFresh ? undefined : 'red'} />
          </div>
        </Section>

        <Section title="Open work" subtitle="Soonest due first" count={openWork?.length ?? 0}>
          {(openWork ?? []).length === 0 ? <Empty>No open work items.</Empty> : (
            <ul className="divide-y divide-line/70 max-h-[320px] overflow-y-auto">
              {(openWork ?? []).map((r: any) => {
                const od = r.due_at && r.due_at < todayStr
                return (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${od ? 'bg-red-500' : 'bg-brand-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-ink truncate text-sm">{r.title || 'Untitled'}</div>
                        <div className="text-xs text-muted truncate mt-0.5">{[r.building, r.unit].filter(Boolean).join(' ')}</div>
                      </div>
                      {r.due_at && (
                        <span className={`text-xs whitespace-nowrap ${od ? 'text-red-600 font-semibold' : 'text-muted'}`}>{od ? 'Overdue' : r.due_at}</span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <div className="lg:col-span-3">
          <ReviewsPanel />
        </div>
      </div>

      <div className="mt-6 flex items-center gap-x-5 gap-y-2 flex-wrap text-xs text-muted border-t border-line pt-4">
        <span className="text-muted/70 font-semibold uppercase tracking-wider">Feeds</span>
        <Feed name="Guesty" on={!!guestyFresh} />
        <Feed name="Slack" soon />
        <Feed name="Asana" soon />
        <Feed name="Breezeway" soon />
        <Feed name="PriceLabs" soon />
        <Feed name="Homebase" soon />
        <Feed name="Gmail" soon />
      </div>
    </Shell>
  )
}

function Stat({ label, value, accent, Icon }: { label: string; value: number; accent?: string; Icon: any }) {
  const ring = accent === 'red' ? 'border-red-200' : accent === 'indigo' ? 'border-brand-200' : 'border-line'
  const ic = accent === 'red' ? 'text-red-500' : accent === 'indigo' ? 'text-brand-600' : 'text-muted'
  return (
    <div className={`rounded-xl border ${ring} bg-white p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</span>
        <Icon size={14} className={ic} />
      </div>
      <div className="text-2xl font-bold text-ink mt-2 tabular-nums">{value}</div>
    </div>
  )
}

function Insight({ label, value, note, Icon, accent }: { label: string; value: string; note: string; Icon: any; accent?: string }) {
  const ic = accent === 'red' ? 'text-red-500' : 'text-muted'
  return (
    <div className="rounded-xl bg-app border border-line p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</span>
        <Icon size={14} className={ic} />
      </div>
      <div className="text-xl font-bold text-ink mt-1.5 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted mt-0.5">{note}</div>
    </div>
  )
}

function Section({ title, subtitle, count, accent, className, icon, children }:
  { title: string; subtitle?: string; count?: number; accent?: boolean; className?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border ${accent ? 'border-brand-200' : 'border-line'} bg-white overflow-hidden ${className || ''}`}>
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h2 className="font-semibold text-ink text-sm">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {count != null && <span className="text-xs font-semibold text-muted bg-app px-2 py-0.5 rounded-full">{count}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-muted">{children}</div>
}

function Avatar({ name, kind }: { name?: string; kind?: 'in' | 'out' }) {
  const initials = (name || 'G').split(' ').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'G'
  const ring = kind === 'out' ? 'from-rose-400 to-rose-600' : 'from-brand-400 to-brand-600'
  return <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${ring} text-white text-xs font-semibold flex items-center justify-center flex-shrink-0`}>{initials}</div>
}

function Feed({ name, on, soon }: { name: string; on?: boolean; soon?: boolean }) {
  const color = soon ? 'bg-slate-300' : on ? 'bg-emerald-500' : 'bg-amber-500'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {name}{soon && <span className="text-muted/60">· soon</span>}
    </span>
  )
}
