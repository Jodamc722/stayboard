import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { CalendarDays, LogIn, LogOut, Users, DollarSign, Clock, RefreshCw, AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Building rollup ──────────────────────────────────────────────────────────
// Roll unit-level names up to their parent property for grouping.
const PARENTS = ['Botanica', 'Oasis', 'Arya']
const OASIS_UNITS = ['mahogany', 'royal palm', 'bougainvillea', 'bamboo', 'sapodilla', 'jasmine']
function rollupBuilding(raw?: string | null): string {
  const b = (raw || '').trim()
  if (!b) return ''
  const lower = b.toLowerCase()
  for (const p of PARENTS) {
    if (lower === p.toLowerCase() || lower.startsWith(p.toLowerCase() + ' ')) return p
  }
  if (OASIS_UNITS.some(u => lower === u || lower.startsWith(u + ' '))) return 'Oasis'
  return b
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function fmtMoney(n: number, currency = 'USD'): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
  const abs = Math.abs(n)
  if (abs >= 1000) return `${sym}${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return `${sym}${Math.round(n)}`
}

function fmtDay(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtWeekday(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

function fmtSync(iso?: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (isNaN(then)) return 'never'
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

const SOURCE_STYLE: Record<string, string> = {
  airbnb: 'bg-rose-50 text-rose-700',
  airbnb2: 'bg-rose-50 text-rose-700',
  bookingcom: 'bg-blue-50 text-blue-700',
  vrbo: 'bg-sky-50 text-sky-700',
  homeaway: 'bg-sky-50 text-sky-700',
  manual: 'bg-app text-muted',
  direct: 'bg-emerald-50 text-emerald-700',
}
function sourceStyle(s?: string | null): string {
  const k = (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return SOURCE_STYLE[k] || 'bg-brand-50 text-brand-700'
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-emerald-50 text-emerald-700',
  reserved: 'bg-emerald-50 text-emerald-700',
  inquiry: 'bg-amber-50 text-amber-700',
  awaiting_payment: 'bg-amber-50 text-amber-700',
  canceled: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-rose-50 text-rose-700',
  declined: 'bg-rose-50 text-rose-700',
}
function statusStyle(s?: string | null): string {
  const k = (s || '').toLowerCase().replace(/[^a-z_]/g, '')
  return STATUS_STYLE[k] || 'bg-app text-muted'
}

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

  const up = upcoming ?? []
  const pastRows = past ?? []

  // ── KPIs derived only from queried columns ────────────────────────────────
  const in7 = new Date(); in7.setDate(in7.getDate() + 7)
  const in7Str = in7.toISOString().slice(0, 10)
  const isCanceled = (s?: string | null) => /cancel|declin/i.test(s || '')

  const checkInsToday = up.filter(r => r.check_in === todayStr && !isCanceled(r.status)).length
  const checkOutsToday = up.filter(r => r.check_out === todayStr && !isCanceled(r.status)).length
  const inHouse = up.filter(r => r.check_in && r.check_out && r.check_in <= todayStr && r.check_out > todayStr && !isCanceled(r.status)).length
  const arrivals7 = up.filter(r => r.check_in && r.check_in >= todayStr && r.check_in <= in7Str && !isCanceled(r.status))
  const arrivals7Count = arrivals7.length
  const revenue7 = arrivals7.reduce((sum, r) => sum + (Number(r.money_total) || 0), 0)
  const currency = (up.find(r => r.money_currency)?.money_currency) || 'USD'

  // ── Section the upcoming list ─────────────────────────────────────────────
  const live = up.filter(r => !isCanceled(r.status))
  const arrivingToday = live.filter(r => r.check_in === todayStr)
  const departingToday = live.filter(r => r.check_out === todayStr && r.check_in !== todayStr)
  const todayIds = new Set([...arrivingToday, ...departingToday].map(r => r.id))
  const futureArrivals = live
    .filter(r => r.check_in && r.check_in > todayStr && !todayIds.has(r.id))
    .slice(0, 60)
  const staying = live.filter(r => r.check_in && r.check_out && r.check_in < todayStr && r.check_out > todayStr && !todayIds.has(r.id))

  const sections: { key: string; title: string; Icon: any; accent: string; rows: any[] }[] = [
    { key: 'arr', title: 'Arriving today', Icon: LogIn, accent: 'text-emerald-600', rows: arrivingToday },
    { key: 'dep', title: 'Departing today', Icon: LogOut, accent: 'text-rose-600', rows: departingToday },
    { key: 'stay', title: 'In-house now', Icon: Users, accent: 'text-brand-600', rows: staying },
    { key: 'soon', title: 'Upcoming arrivals', Icon: CalendarDays, accent: 'text-brand-600', rows: futureArrivals },
  ].filter(s => s.rows.length > 0)

  const totalSynced = sync?.items_synced ?? 0
  const lastSync = sync?.last_sync_at ?? null

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><CalendarDays size={13} /> Bookings</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Reservations</h1>
          <p className="text-sm text-muted mt-1">{up.length} active · {pastRows.length} past · upcoming arrivals first.</p>
        </div>
        <div className="text-[11px] text-muted flex items-center gap-1.5">
          <RefreshCw size={12} /> Synced {fmtSync(lastSync)}{totalSynced ? ` · ${totalSynced.toLocaleString()} total` : ''}
        </div>
      </header>

      {sync?.last_error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} /> Last sync reported an issue — figures may be stale.
        </div>
      )}

      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Kpi label="Check-ins today" value={checkInsToday} Icon={LogIn} accent />
        <Kpi label="Check-outs today" value={checkOutsToday} Icon={LogOut} />
        <Kpi label="In-house now" value={inHouse} Icon={Users} />
        <Kpi label="Arrivals next 7d" value={arrivals7Count} Icon={CalendarDays} />
        <Kpi label="Booked rev · 7d" value={fmtMoney(revenue7, currency)} Icon={DollarSign} />
      </div>

      {up.length === 0 && pastRows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-16 text-center text-sm text-muted">No reservations synced yet.</div>
      ) : (
        <>
          {sections.length === 0 ? (
            <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted mb-6">No active reservations on the books.</div>
          ) : (
            <div className="space-y-5 mb-8">
              {sections.map(sec => (
                <section key={sec.key} className="rounded-2xl border border-line bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5">
                      <sec.Icon size={15} className={`${sec.accent} shrink-0`} /> {sec.title}
                    </h2>
                    <span className="text-[10px] uppercase tracking-wider text-muted font-semibold tabular-nums">{sec.rows.length}</span>
                  </div>
                  <ResRows rows={sec.rows} todayStr={todayStr} />
                </section>
              ))}
            </div>
          )}

          {/* Recent past stays */}
          {pastRows.length > 0 && (
            <section className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
                <h2 className="font-semibold text-ink text-sm inline-flex items-center gap-1.5">
                  <Clock size={15} className="text-muted shrink-0" /> Recent past stays
                </h2>
                <span className="text-[10px] uppercase tracking-wider text-muted font-semibold tabular-nums">{Math.min(pastRows.length, 40)}</span>
              </div>
              <ResRows rows={pastRows.slice(0, 40)} todayStr={todayStr} muted />
            </section>
          )}
        </>
      )}
    </Shell>
  )
}

// ── Row list ─────────────────────────────────────────────────────────────────
function ResRows({ rows, todayStr, muted }: { rows: any[]; todayStr: string; muted?: boolean }) {
  return (
    <>
      {/* Column header — desktop */}
      <div className="hidden md:grid grid-cols-[1.6fr_1.3fr_120px_56px_92px] gap-3 px-4 py-2 border-b border-line text-[10px] uppercase tracking-wider font-semibold text-muted">
        <span>Guest</span><span>Listing</span><span>Dates</span><span className="text-center">Nights</span><span className="text-right">Total</span>
      </div>
      <div className="divide-y divide-line">
        {rows.map(r => {
          const total = Number(r.money_total) || 0
          const paid = Number(r.money_paid) || 0
          const owed = total - paid
          const cur = r.money_currency || 'USD'
          const building = rollupBuilding(r.listing_name)
          const canceled = /cancel|declin/i.test(r.status || '')
          return (
            <div key={r.id} className={`grid grid-cols-2 md:grid-cols-[1.6fr_1.3fr_120px_56px_92px] gap-x-3 gap-y-1 px-4 py-3 items-center ${muted ? 'opacity-80' : ''} hover:bg-app transition-colors`}>
              {/* Guest */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`font-medium text-sm truncate ${canceled ? 'text-muted line-through' : 'text-ink'}`}>{r.guest_name || 'Guest'}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {r.source && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sourceStyle(r.source)}`}>{r.source}</span>}
                  {r.status && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusStyle(r.status)}`}>{String(r.status).replace(/_/g, ' ')}</span>}
                </div>
              </div>

              {/* Listing */}
              <div className="min-w-0 text-right md:text-left">
                <div className="text-sm text-ink truncate">{r.listing_name || 'Unassigned'}</div>
                {building && building !== (r.listing_name || '').trim() && (
                  <div className="text-[11px] text-muted truncate">{building}</div>
                )}
              </div>

              {/* Dates */}
              <div className="text-[12px] tabular-nums col-span-2 md:col-span-1 flex items-center gap-1.5 md:block">
                <span className="text-ink">
                  <span className="text-muted text-[10px] mr-1">{fmtWeekday(r.check_in)}</span>{fmtDay(r.check_in)}
                </span>
                <span className="text-muted mx-1 md:mx-0 md:hidden">→</span>
                <span className="text-ink md:block">
                  <span className="text-muted text-[10px] mr-1 md:inline">{fmtWeekday(r.check_out)}</span>{fmtDay(r.check_out)}
                </span>
              </div>

              {/* Nights */}
              <div className="hidden md:block text-center text-sm text-muted tabular-nums">{Number(r.nights) || '—'}</div>

              {/* Total */}
              <div className="text-right">
                <div className="text-sm font-semibold text-ink tabular-nums">{fmtMoney(total, cur)}</div>
                {owed > 0.5 && !canceled && (
                  <div className="text-[10px] text-amber-700 tabular-nums">{fmtMoney(owed, cur)} due</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function Kpi({ label, value, Icon, accent }: { label: string; value: any; Icon?: any; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'border-line bg-white'}`}>
      <div className={`text-2xl font-bold tabular-nums flex items-center gap-1.5 ${accent ? 'text-brand-700' : 'text-ink'}`}>
        {Icon && <Icon size={16} className={accent ? 'text-brand-600' : 'text-muted'} />}{value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
    </div>
  )
}
