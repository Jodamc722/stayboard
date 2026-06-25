// Revenue & performance dashboard. Booked revenue, ADR, occupancy, RevPAR, cleaning revenue,
// channel distribution and unit utilization for a selected date range. Confirmed reservations
// only. All figures derived from guesty_reservations (money_total + raw money fields) and
// guesty_listings. Supabase caps a query at 1000 rows, so reservations are paginated.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { RangeFilter } from '@/components/RangeFilter'
import { DollarSign, TrendingUp, BedDouble, Percent, Sparkles, Building2, CalendarRange, Ban, Wallet } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function fmtMoney(n: number, cur = 'USD'): string {
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1000) return `${sym}${(n / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`
  return `${sym}${Math.round(n).toLocaleString()}`
}
function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z'), db = Date.parse(b + 'T00:00:00Z')
  return Math.round((db - da) / 86_400_000)
}
function overlapNights(checkIn: string, checkOut: string, from: string, toExcl: string): number {
  if (!checkIn || !checkOut) return 0
  const s = checkIn > from ? checkIn : from
  const e = checkOut < toExcl ? checkOut : toExcl
  const n = daysBetween(s, e)
  return n > 0 ? n : 0
}

export default async function RevenuePage({ searchParams }: { searchParams?: { from?: string; to?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const validDate = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const to = validDate(searchParams?.to) || todayStr
  const def30 = new Date(Date.parse(to + 'T00:00:00Z') - 29 * 86_400_000).toISOString().slice(0, 10)
  let from = validDate(searchParams?.from) || def30
  if (from > to) from = to
  const toExcl = new Date(Date.parse(to + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  const daysInRange = daysBetween(from, to) + 1

  const sb = supabaseAdmin()

  // Active units (the "dead set" rule), and inactive count for context.
  const { data: listingRows } = await sb.from('guesty_listings').select('id, status').limit(5000)
  const listings = listingRows ?? []
  const activeUnits = listings.filter((l: any) => !DEAD.includes(String(l.status || '').toLowerCase())).length
  const inactiveUnits = listings.length - activeUnits

  // Paginated pull of confirmed reservations OVERLAPPING the range (check_out > from AND check_in <= to).
  const fetchAll = async () => {
    let all: any[] = []
    for (let i = 0; i < 30; i++) {
      const { data } = await sb
        .from('guesty_reservations')
        .select('listing_id, check_in, check_out, nights, money_total, money_currency, source, status, cleaning:raw->money->>fareCleaning, fare:raw->money->>fareAccommodation')
        .in('status', CONFIRMED)
        .gt('check_out', from)
        .lte('check_in', to)
        .range(i * 1000, i * 1000 + 999)
      if (!data || data.length === 0) break
      all = all.concat(data)
      if (data.length < 1000) break
    }
    return all
  }
  const resv = await fetchAll()

  // ---- Occupancy: overlap nights across the whole set ----
  let occupiedNights = 0
  for (const r of resv) occupiedNights += overlapNights(r.check_in, r.check_out, from, toExcl)
  const availableNights = activeUnits * daysInRange
  const occupancy = availableNights > 0 ? occupiedNights / availableNights : 0

  // ---- Revenue metrics: arrivals (check_in) within the range ----
  const arrivals = resv.filter((r: any) => r.check_in >= from && r.check_in <= to)
  const currency = (arrivals.find((r: any) => r.money_currency)?.money_currency) || 'USD'
  let bookedRevenue = 0, nightsSold = 0, cleaningRevenue = 0, accomRevenue = 0
  const byChannel: Record<string, { count: number; revenue: number }> = {}
  const bookedUnits = new Set<string>()
  for (const r of arrivals) {
    const rev = num(r.money_total)
    bookedRevenue += rev
    nightsSold += num(r.nights)
    cleaningRevenue += num(r.cleaning)
    accomRevenue += num(r.fare)
    if (r.listing_id) bookedUnits.add(r.listing_id)
    const ch = (r.source || 'other').toString()
    if (!byChannel[ch]) byChannel[ch] = { count: 0, revenue: 0 }
    byChannel[ch].count += 1
    byChannel[ch].revenue += rev
  }
  const bookings = arrivals.length
  const adr = nightsSold > 0 ? bookedRevenue / nightsSold : 0
  const revpar = availableNights > 0 ? bookedRevenue / availableNights : 0
  const avgBooking = bookings > 0 ? bookedRevenue / bookings : 0
  const idleUnits = Math.max(0, activeUnits - bookedUnits.size)

  const channels = Object.entries(byChannel)
    .map(([k, v]) => ({ name: prettyChannel(k), revenue: v.revenue, count: v.count }))
    .sort((a, b) => b.revenue - a.revenue)
  const channelMax = channels.reduce((m, c) => Math.max(m, c.revenue), 0) || 1

  return (
    <Shell>
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5"><TrendingUp size={13} /> Performance</p>
          <h1 className="text-3xl font-bold text-ink mt-1 tracking-tight">Revenue dashboard</h1>
          <p className="text-sm text-muted mt-1">{from} to {to} · {daysInRange} days · {bookings.toLocaleString()} confirmed arrivals</p>
        </div>
        <RangeFilter from={from} to={to} />
      </header>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Booked revenue" value={fmtMoney(bookedRevenue, currency)} Icon={DollarSign} accent />
        <Kpi label="ADR" value={fmtMoney(adr, currency)} Icon={TrendingUp} sub="per night sold" />
        <Kpi label="Occupancy" value={`${Math.round(occupancy * 100)}%`} Icon={Percent} sub={`${occupiedNights.toLocaleString()} / ${availableNights.toLocaleString()} nights`} />
        <Kpi label="RevPAR" value={fmtMoney(revpar, currency)} Icon={BedDouble} sub="rev / available night" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Nights sold" value={nightsSold.toLocaleString()} Icon={BedDouble} />
        <Kpi label="Avg booking" value={fmtMoney(avgBooking, currency)} Icon={Wallet} />
        <Kpi label="Cleaning revenue" value={fmtMoney(cleaningRevenue, currency)} Icon={Sparkles} sub="fees collected" />
        <Kpi label="Accommodation" value={fmtMoney(accomRevenue, currency)} Icon={DollarSign} sub="room fare only" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* Channel distribution */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink mb-1">Channel distribution</h2>
          <p className="text-[12px] text-muted mb-4">Booked revenue and reservation count by source (arrivals in range).</p>
          {channels.length === 0 ? (
            <div className="text-sm text-muted italic py-6 text-center">No confirmed arrivals in this range.</div>
          ) : (
            <div className="space-y-3">
              {channels.map((c, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-[13px] mb-1">
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="text-muted tabular-nums">{fmtMoney(c.revenue, currency)} · {c.count} bk · {Math.round((c.revenue / bookedRevenue) * 100) || 0}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-app overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600" style={{ width: `${Math.max(2, (c.revenue / channelMax) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Units & utilization */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink mb-1">Units &amp; utilization</h2>
          <p className="text-[12px] text-muted mb-4">How the portfolio was used in this range.</p>
          <dl className="space-y-3 text-sm">
            <Row Icon={Building2} label="Active units" value={`${activeUnits}`} />
            <Row Icon={BedDouble} label="Units booked" value={`${bookedUnits.size}`} tone="good" />
            <Row Icon={Ban} label="Idle units (no arrivals)" value={`${idleUnits}`} tone={idleUnits > 0 ? 'warn' : 'good'} />
            <Row Icon={Building2} label="Inactive in Guesty" value={`${inactiveUnits}`} tone="muted" />
            <Row Icon={Wallet} label="Revenue per active unit" value={fmtMoney(activeUnits ? bookedRevenue / activeUnits : 0, currency)} />
          </dl>
          <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-[12px] text-brand-700">
            Owner / maintenance calendar blocks aren&apos;t synced yet, so &quot;idle&quot; counts units with no confirmed arrival in the range. True block tracking comes with the Breezeway + calendar feed.
          </div>
        </section>
      </div>
    </Shell>
  )
}

function prettyChannel(s: string): string {
  const c = s.toLowerCase()
  if (/airbnb/.test(c)) return 'Airbnb'
  if (/booking/.test(c)) return 'Booking.com'
  if (/vrbo|homeaway/.test(c)) return 'Vrbo'
  if (/expedia/.test(c)) return 'Expedia'
  if (/direct|website|manual|owner/.test(c)) return 'Direct / Owner'
  if (/be-api|api/.test(c)) return 'Booking Engine'
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other'
}

function Kpi({ label, value, Icon, sub, accent }: { label: string; value: any; Icon?: any; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${accent ? 'bg-brand-50 border-brand-200' : 'border-line bg-white'}`}>
      <div className={`text-2xl font-bold tabular-nums flex items-center gap-1.5 ${accent ? 'text-brand-700' : 'text-ink'}`}>
        {Icon && <Icon size={16} className={accent ? 'text-brand-600' : 'text-muted'} />}{value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mt-1">{label}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function Row({ Icon, label, value, tone }: { Icon: any; label: string; value: string; tone?: 'good' | 'warn' | 'muted' }) {
  const c = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink'
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted inline-flex items-center gap-1.5"><Icon size={13} /> {label}</dt>
      <dd className={`font-semibold tabular-nums ${c}`}>{value}</dd>
    </div>
  )
}
