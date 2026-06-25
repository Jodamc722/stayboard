import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { PendingRow } from './ApprovalActions'
import { ReviewsPanel } from './ReviewsPanel'
import { GeneratePlanButton } from '@/components/OpsPlanUI'
import {
  ArrowUpRight, CheckCircle2, Clock, AlertTriangle, LogIn, LogOut,
  ClipboardCheck, ListTodo, Gauge, CalendarClock, DollarSign, BedDouble
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const PRIORITY: Record<string, { c: string; l: string }> = {
  urgent: { c: 'bg-red-100 text-red-700', l: 'Urgent' },
  high:   { c: 'bg-orange-100 text-orange-700', l: 'High' },
  medium: { c: 'bg-amber-100 text-amber-700', l: 'Medium' },
  low:    { c: 'bg-slate-100 text-slate-600', l: 'Low' },
}

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
function money(n: number) { return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}` }

export default async function CommandCenterPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const in7 = addDays(today, 7)

  const [
    { data: pending },
    { data: openWork },
    { count: pendingCount },
    { count: openCount },
    { count: checkInsToday },
    { count: checkOutsToday },
    { count: activeNow },
    { count: arrivals7 },
    { data: arrivals },
    { data: departures },
    { data: revenueRows },
    { count: listingsCount },
  ] = await Promise.all([
    supabase.from('field_requests').select('id,title,type,priority,building,unit,vendor,amount_usd,due_at,created_at,status')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
    supabase.from('field_requests').select('id,title,type,priority,building,unit,assignee_email,due_at,status')
      .in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(20),
    supabase.from('field_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('field_requests').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_in', todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).eq('check_out', todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).lte('check_in', todayStr).gt('check_out', todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).gt('check_in', todayStr).lte('check_in', in7),
    supabase.from('guesty_reservations').select('id,guest_name,listing_name,nights,money_total,money_currency').eq('check_in', todayStr).order('listing_name').limit(12),
    supabase.from('guesty_reservations').select('id,guest_name,listing_name').eq('check_out', todayStr).order('listing_name').limit(12),
    supabase.from('guesty_reservations').select('money_total').gt('check_in', todayStr).lte('check_in', in7).limit(500),
    supabase.from('guesty_listings').select('*', { count: 'exact', head: true }),
  ])

  const overdue = (openWork ?? []).filter((r: any) => r.due_at && r.due_at < todayStr)
  const bookedRevenue = (revenueRows ?? []).reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)
  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const firstName = user.email?.split('@')[0]?.split('.')[0]?.replace(/^\w/, c => c.toUpperCase()) || 'there'

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
            <Gauge size={13} /> Mission Control
          </p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Good day, {firstName}.</h1>
          <p className="text-sm text-muted mt-1">{dateLabel} — here's everything that needs you, at a glance.</p>
        </div>
        <GeneratePlanButton />
      </header>

      {/* KPI band — the snapshot for GM / owners */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-7">
        <Stat label="Occupied now" value={String(activeNow ?? 0)} Icon={BedDouble} accent="indigo" sub={`of ${listingsCount ?? 0} units`} />
        <Stat label="Check-ins today" value={String(checkInsToday ?? 0)} Icon={LogIn} />
        <Stat label="Check-outs today" value={String(checkOutsToday ?? 0)} Icon={LogOut} />
        <Stat label="Arrivals · 7d" value={String(arrivals7 ?? 0)} Icon={CalendarClock} accent="indigo" />
        <Stat label="Booked · 7d" value={money(bookedRevenue)} Icon={DollarSign} accent="emerald" />
        <Stat label="Awaiting approval" value={String(pendingCount ?? 0)} Icon={ClipboardCheck} accent={pendingCount ? 'indigo' : undefined} />
        <Stat label="Overdue" value={String(overdue.length)} Icon={AlertTriangle} accent={overdue.length ? 'red' : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="Needs your approval" persona="Mini GM" count={pending?.length ?? 0} accent className="lg:col-span-2">
          {(pending ?? []).length === 0 ? (
            <Empty>Nothing waiting on you. <CheckCircle2 size={14} className="inline -mt-0.5 text-emerald-500" /></Empty>
          ) : (
            <ul className="divide-y divide-line/70">{(pending ?? []).map((r: any) => <PendingRow key={r.id} r={r} />)}</ul>
          )}
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Today · Arrivals" persona="Front desk & ops" count={arrivals?.length ?? 0}>
            {(arrivals ?? []).length === 0 ? <Empty>No check-ins today.</Empty> : (
              <ul className="divide-y divide-line/70">
                {(arrivals ?? []).map((r: any) => (
                  <li key={r.id}>
                    <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                      <Avatar name={r.guest_name} />
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

          <Section title="Today · Departures" persona="Housekeeping turns" count={departures?.length ?? 0}>
            {(departures ?? []).length === 0 ? <Empty>No check-outs today.</Empty> : (
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
        </div>

        <Section title="Open work" persona="Maintenance & ops" subtitle="Soonest due first" count={openWork?.length ?? 0} className="lg:col-span-3">
          {(openWork ?? []).length === 0 ? <Empty>No open work items.</Empty> : (
            <ul className="divide-y divide-line/70">
              {(openWork ?? []).map((r: any) => {
                const od = r.due_at && r.due_at < todayStr
                return (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${od ? 'bg-red-500' : 'bg-brand-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-ink truncate text-sm">{r.title || 'Untitled'}</div>
                        <div className="text-xs text-muted truncate mt-0.5">
                          {[r.building, r.unit].filter(Boolean).join(' ')}{r.assignee_email ? ` · ${r.assignee_email.split('@')[0]}` : ''}
                        </div>
                      </div>
                      {r.due_at && (
                        <span className={`text-xs whitespace-nowrap inline-flex items-center gap-1 ${od ? 'text-red-600 font-semibold' : 'text-muted'}`}>
                          <Clock size={11} /> {od ? 'Overdue ' : ''}{r.due_at}
                        </span>
                      )}
                      <Pill p={r.priority} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <ReviewsPanel />
      </div>

      <p className="text-xs text-muted mt-6 text-center">
        Mission Control · ask the Brain (bottom-right) anything · generate a team ops plan up top.
      </p>
    </Shell>
  )
}

function Pill({ p }: { p?: string }) {
  const cfg = PRIORITY[(p || 'low').toLowerCase()] || PRIORITY.low
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.c}`}>{cfg.l}</span>
}

function Stat({ label, value, sub, accent, Icon }: { label: string; value: string; sub?: string; accent?: string; Icon: any }) {
  const ring = accent === 'red' ? 'border-red-200 bg-red-50/40' : accent === 'emerald' ? 'border-emerald-200 bg-emerald-50/40' : accent === 'indigo' ? 'border-brand-200 bg-brand-50/40' : 'border-line'
  const ic = accent === 'red' ? 'text-red-500' : accent === 'emerald' ? 'text-emerald-600' : accent === 'indigo' ? 'text-brand-600' : 'text-muted'
  return (
    <div className={`rounded-2xl border ${ring} bg-white p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</span>
        <Icon size={15} className={ic} />
      </div>
      <div className="text-2xl font-bold text-ink mt-2 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function Section({ title, persona, subtitle, count, accent, className, children }:
  { title: string; persona?: string; subtitle?: string; count?: number; accent?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border ${accent ? 'border-brand-200' : 'border-line'} bg-white overflow-hidden ${className || ''}`}>
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-ink text-sm">{title}</h2>
            {persona && <span className="text-[9px] uppercase tracking-wider font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">{persona}</span>}
          </div>
          {subtitle && <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>}
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

function Avatar({ name }: { name?: string }) {
  const initials = (name || 'G').split(' ').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'G'
  return <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">{initials}</div>
}
