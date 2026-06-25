import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'
import {
  ArrowUpRight, LogIn, LogOut, Users, Building2, Wrench, MessageSquare,
  CalendarDays, Activity, ClipboardList, Gauge, AlertTriangle, Clock,
  TrendingUp, MessageCircle,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

// Roll unit-level building names up to their parent property.
// e.g. "Botanica 6108" â "Botanica", "Oasis Mahogany" â "Oasis", "Arya 1704" â "Arya".
const PARENTS = ['Botanica', 'Oasis', 'Arya']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
function rollupBuilding(raw?: string | null): string {
  const b = (raw || '').trim()
  if (!b) return 'Unassigned'
  const lower = b.toLowerCase()
  for (const p of PARENTS) {
    if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  }
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

function isCancelled(status?: string | null) {
  return /cancel|declin/i.test(String(status || ''))
}

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(today)
  const nowIso = today.toISOString()
  const in7 = new Date(today.getTime() + 7 * 86_400_000)
  const in7Str = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(in7)

  const [
    { count: checkInsToday },
    { count: checkOutsToday },
    { data: listings },
    { data: inHouse },
    { data: arrivals },
    { data: departures },
    { data: revRows },
    { data: openWork },
    { data: convos },
    { data: syncStatus },
  ] = await Promise.all([
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).in('status', ['confirmed', 'checked_in', 'checked_out']).eq('check_in', todayStr),
    supabase.from('guesty_reservations').select('*', { count: 'exact', head: true }).in('status', ['confirmed', 'checked_in', 'checked_out']).eq('check_out', todayStr),
    // All listings â compute active using the "dead set" rule in app code.
    supabase.from('guesty_listings').select('id, status').limit(2000),
    // In-house now: check_in <= today < check_out.
    supabase.from('guesty_reservations')
      .select('id, status')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', todayStr).gt('check_out', todayStr)
      .limit(2000),
    supabase.from('guesty_reservations')
      .select('id, guest_name, listing_name, nights, status, money_total, money_currency')
      .in('status', ['confirmed', 'checked_in', 'checked_out']).eq('check_in', todayStr).order('listing_name').limit(50),
    supabase.from('guesty_reservations')
      .select('id, guest_name, listing_name, nights, status, money_total, money_currency')
      .in('status', ['confirmed', 'checked_in', 'checked_out']).eq('check_out', todayStr).order('listing_name').limit(50),
    // Revenue: reservations arriving in the next 7 days.
    supabase.from('guesty_reservations')
      .select('money_total, status, check_in')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', todayStr).lte('check_in', in7Str)
      .limit(2000),
    // Open work (open + in_progress).
    supabase.from('field_requests')
      .select('id, type, title, building, unit, priority, due_at, status, assignee_email')
      .in('status', ['open', 'in_progress'])
      .limit(1000),
    supabase.from('guesty_conversations')
      .select('id, guest_name, channel, last_message_at, last_message_preview, unread_count')
      .order('last_message_at', { ascending: false })
      .limit(50),
    supabase.from('guesty_sync_status').select('entity, last_sync_at, last_error, items_synced').order('entity'),
  ])

  // --- Derived KPIs ---
  const activeUnits = (listings ?? []).filter(
    (l: any) => !DEAD.includes(String(l.status || '').toLowerCase())
  ).length
  const inHouseNow = (inHouse ?? []).filter((r: any) => !isCancelled(r.status)).length
  const arrivalsList = (arrivals ?? []).filter((r: any) => !isCancelled(r.status))
  const departuresList = (departures ?? []).filter((r: any) => !isCancelled(r.status))
  const openWorkRows = (openWork ?? [])
  const openWorkCount = openWorkRows.length
  const unreadTotal = (convos ?? []).reduce((s: number, c: any) => s + (Number(c.unread_count) || 0), 0)

  // Revenue next 7 days (non-cancelled).
  const rev7 = (revRows ?? [])
    .filter((r: any) => !isCancelled(r.status))
    .reduce((s: number, r: any) => s + (Number(r.money_total) || 0), 0)

  // --- Needs attention ---
  const isHighPriority = (p: any) =>
    String(p).toLowerCase() === 'high' || Number(p) === 1
  const highPriority = openWorkRows.filter((w: any) => isHighPriority(w.priority))
  const overdue = openWorkRows.filter(
    (w: any) => w.due_at && String(w.due_at) < nowIso
  )
  // Open-work rollup by parent building.
  const workByBuilding: Record<string, number> = {}
  openWorkRows.forEach((w: any) => {
    const b = rollupBuilding(w.building)
    workByBuilding[b] = (workByBuilding[b] || 0) + 1
  })
  const buildingRollup = Object.entries(workByBuilding)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  // Attention list: high-priority + overdue, de-duped, capped.
  const attentionMap = new Map<string, any>()
  ;[...overdue, ...highPriority].forEach((w: any) => {
    if (!attentionMap.has(w.id)) {
      attentionMap.set(w.id, {
        ...w,
        _overdue: !!(w.due_at && String(w.due_at) < nowIso),
        _high: isHighPriority(w.priority),
      })
    } else {
      const existing = attentionMap.get(w.id)
      existing._high = existing._high || isHighPriority(w.priority)
    }
  })
  const attention = Array.from(attentionMap.values()).slice(0, 8)

  // Messages: latest 5.
  const recentConvos = (convos ?? []).slice(0, 5)

  // Sync label.
  const syncList = syncStatus ?? []
  const lastSync = syncList
    .map((s: any) => s.last_sync_at)
    .filter(Boolean)
    .sort()
    .pop()
  const lastSyncLabel = lastSync ? timeAgo(new Date(lastSync)) : 'never'

  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <Shell>
      {/* Header */}
      <header className="mb-7 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Stay Hospitality</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Command home</h1>
          <p className="text-sm text-muted mt-1 flex items-center gap-1.5 flex-wrap">
            <span>{dateLabel}</span>
            <span className="text-line">Â·</span>
            <span className="inline-flex items-center gap-1">
              <Activity size={12} className="text-muted/70" /> Last sync {lastSyncLabel}
            </span>
          </p>
        </div>
        <SyncNowButton />
      </header>

      {/* Hero KPI band â 6 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-7">
        <Kpi label="Active units"     value={activeUnits}  Icon={Building2} />
        <Kpi label="In-house now"     value={inHouseNow}    Icon={Users} accent />
        <Kpi label="Check-ins today"  value={checkInsToday  ?? 0} Icon={LogIn} />
        <Kpi label="Check-outs today" value={checkOutsToday ?? 0} Icon={LogOut} />
        <Kpi label="Open work"        value={openWorkCount} Icon={Wrench} alert={openWorkCount > 0} />
        <Kpi label="Unread messages"  value={unreadTotal}   Icon={MessageSquare} alert={unreadTotal > 0} />
      </div>

      {/* Today + Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Arrivals */}
        <Section title="Arrivals today" count={arrivalsList.length} accent Icon={LogIn}>
          {arrivalsList.length === 0 ? (
            <Empty>No check-ins today.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {arrivalsList.map((r: any) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                    <Avatar name={r.guest_name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate text-sm">{r.guest_name || 'Guest'}</div>
                      <div className="text-xs text-muted truncate">{r.listing_name} Â· {r.nights ?? 'â'} nights</div>
                    </div>
                    {r.money_total != null && (
                      <span className="text-sm font-semibold text-ink whitespace-nowrap tabular-nums">{money(r.money_total, r.money_currency)}</span>
                    )}
                    <ArrowUpRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Departures */}
        <Section title="Departures today" count={departuresList.length} Icon={LogOut}>
          {departuresList.length === 0 ? (
            <Empty>No check-outs today.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {departuresList.map((r: any) => (
                <li key={r.id}>
                  <Link href={`/reservations/${r.id}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                    <Avatar name={r.guest_name} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate text-sm">{r.guest_name || 'Guest'}</div>
                      <div className="text-xs text-muted truncate">{r.listing_name} Â· {r.nights ?? 'â'} nights</div>
                    </div>
                    {r.money_total != null && (
                      <span className="text-sm font-semibold text-ink whitespace-nowrap tabular-nums">{money(r.money_total, r.money_currency)}</span>
                    )}
                    <ArrowUpRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Snapshot column: Revenue + flow */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-gradient-to-br from-brand-500 to-brand-700 text-white p-5 shadow-soft overflow-hidden relative">
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-white/80">
                <TrendingUp size={13} /> Revenue Â· next 7 days
              </div>
              <div className="text-4xl font-bold mt-2 leading-none tracking-tight tabular-nums">{compactMoney(rev7)}</div>
              <div className="text-[11px] mt-2 text-white/75">Arriving {todayStr} â {in7Str}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-3">Today&apos;s flow</div>
            <div className="grid grid-cols-3 divide-x divide-line text-center">
              <Mini label="Arrivals" value={arrivalsList.length} Icon={LogIn} />
              <Mini label="In-house" value={inHouseNow} Icon={Users} />
              <Mini label="Departures" value={departuresList.length} Icon={LogOut} />
            </div>
          </div>
        </div>
      </div>

      {/* Needs attention + Messages */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Section title="Needs attention" count={attention.length} className="lg:col-span-2" Icon={AlertTriangle} alert={attention.length > 0}>
          {attention.length === 0 ? (
            <Empty>Nothing overdue or high-priority. All clear.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {attention.map((w: any) => (
                <li key={w.id}>
                  <Link href={`/requests`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w._overdue ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate text-sm">{w.title || w.type || 'Request'}</div>
                      <div className="text-xs text-muted truncate flex items-center gap-1.5">
                        <span>{rollupBuilding(w.building)}{w.unit ? ` Â· ${w.unit}` : ''}</span>
                        {w.due_at && (
                          <span className="inline-flex items-center gap-0.5">
                            <Clock size={10} /> {dueLabel(w.due_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {w._overdue && <Tag tone="rose">Overdue</Tag>}
                      {w._high && <Tag tone="amber">High</Tag>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {buildingRollup.length > 0 && (
            <div className="px-4 py-3 border-t border-line flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted font-semibold mr-1">Open by building</span>
              {buildingRollup.map(([b, n]) => (
                <span key={b} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-app text-ink tabular-nums">
                  {b} <span className="text-muted">{n}</span>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Recent messages */}
        <Section title="Recent guest messages" count={recentConvos.length} Icon={MessageCircle}>
          {recentConvos.length === 0 ? (
            <Empty>No conversations yet.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {recentConvos.map((c: any) => {
                const unread = Number(c.unread_count) || 0
                return (
                  <li key={c.id}>
                    <Link href={`/messages`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-app transition-colors">
                      <Avatar name={c.guest_name} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate text-sm ${unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{c.guest_name || 'Guest'}</span>
                          {c.channel && <span className="text-[10px] uppercase tracking-wider text-muted shrink-0">{c.channel}</span>}
                        </div>
                        <div className={`text-xs truncate ${unread ? 'text-ink' : 'text-muted'}`}>{c.last_message_preview || 'â'}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {c.last_message_at && <span className="text-[10px] text-muted whitespace-nowrap">{timeAgo(new Date(c.last_message_at))}</span>}
                        {unread > 0 && (
                          <span className="text-[10px] font-bold text-white bg-brand-600 rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center tabular-nums">{unread}</span>
                        )}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <QuickLink href="/reservations" label="Reservations" Icon={CalendarDays} />
        <QuickLink href="/buildings"     label="Buildings"    Icon={Building2} />
        <QuickLink href="/health"        label="Health"       Icon={Activity} />
        <QuickLink href="/messages"      label="Messages"     Icon={MessageSquare} />
        <QuickLink href="/requests"      label="Requests"     Icon={ClipboardList} />
        <QuickLink href="/command"       label="Command"      Icon={Gauge} />
      </div>
    </Shell>
  )
}

/* ---------- Components ---------- */

function Kpi({ label, value, Icon, accent, alert }:
  { label: string; value: number; Icon?: any; accent?: boolean; alert?: boolean }) {
  if (accent) {
    return (
      <div className="relative rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white px-3 py-3 shadow-soft overflow-hidden">
        <div className="absolute -top-5 -right-5 w-20 h-20 rounded-full bg-white/10 blur-xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-wider uppercase text-white/80 font-semibold">{label}</span>
            {Icon && <Icon size={13} className="text-white/70" />}
          </div>
          <div className="text-2xl font-bold mt-1 leading-none tabular-nums">{value}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-wider uppercase text-muted font-semibold">{label}</span>
        {Icon && <Icon size={13} className={alert ? 'text-amber-500' : 'text-muted/60'} />}
      </div>
      <div className={`text-2xl font-bold mt-1 leading-none tabular-nums ${alert ? 'text-amber-600' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function Section({ title, count, accent, alert, className, Icon, children }:
  { title: string; count?: number; accent?: boolean; alert?: boolean; className?: string; Icon?: any; children: React.ReactNode }) {
  return (
    <section className={`bg-white rounded-2xl border border-line overflow-hidden flex flex-col ${className || ''}`}>
      <header className="px-4 py-3 border-b border-line flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          {accent && <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
          {Icon && <Icon size={15} className={alert ? 'text-amber-500' : 'text-muted'} />}
          <h2 className="font-semibold text-ink text-[15px] tracking-tight">{title}</h2>
        </div>
        {count != null && <span className="text-xs text-muted tabular-nums">{count}</span>}
      </header>
      {children}
    </section>
  )
}

function QuickLink({ href, label, Icon }: { href: string; label: string; Icon: any }) {
  return (
    <Link href={href}
      className="group rounded-2xl border border-line bg-white px-4 py-4 flex items-center gap-3 hover:border-brand-200 hover:bg-app transition-colors">
      <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
        <Icon size={17} />
      </div>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <ArrowUpRight size={14} className="text-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  )
}

function Mini({ label, value, Icon }: { label: string; value: number; Icon?: any }) {
  return (
    <div className="py-1">
      <div className="text-xl font-bold text-ink tabular-nums inline-flex items-center gap-1 justify-center">
        {Icon && <Icon size={13} className="text-muted" />} {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-0.5">{label}</div>
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'rose' | 'amber' }) {
  const tones: Record<string, string> = {
    rose: 'text-rose-700 bg-rose-50',
    amber: 'text-amber-700 bg-amber-50',
  }
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tones[tone]}`}>{children}</span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-sm text-muted text-center">{children}</p>
}

function Avatar({ name }: { name: string | null }) {
  const init = (name || 'G').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
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

/* ---------- Helpers ---------- */

function money(v: any, currency?: string | null) {
  const n = Number(v); if (isNaN(n)) return 'â'
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n) }
  catch { return `$${n.toLocaleString()}` }
}

// Compact money: $1.2k / $34.5k / $1.2M.
function compactMoney(v: number) {
  const n = Number(v) || 0
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${Math.round(n).toLocaleString()}`
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function dueLabel(due: string) {
  const d = new Date(due)
  if (isNaN(d.getTime())) return ''
  const diffMs = d.getTime() - Date.now()
  const days = Math.round(diffMs / 86_400_000)
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  return `due in ${days}d`
}
