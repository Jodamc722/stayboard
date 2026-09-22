import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { DateFilter } from '@/components/DateFilter'
import { customFieldNameMap, filledCustomFields } from '@/lib/custom-fields'
import { ExternalLink } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanEmpty, IconBtn } from '@/components/lean'

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
const TAG_CLS = 'shrink-0 whitespace-nowrap text-[10.5px] font-semibold leading-none px-1.5 py-[3px] rounded-md'

export default async function ReservationsPage({ searchParams }: { searchParams?: { date?: string; tab?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // "Today" in the property's local timezone (Miami / America/New_York), NOT UTC — otherwise
  // every check-in/checkout count is off by a day during evening hours.
  const realToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  // Selected day drives the whole page (defaults to today). Lets Jon filter to any date.
  const dateParam = (searchParams?.date || '').trim()
  const todayStr = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateParam) ? dateParam : realToday
  const viewingToday = todayStr === realToday
  const dl = viewingToday ? 'today' : new Date(todayStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // Upcoming first (>= today, ascending), then past (descending). Pull two sets to support tabbed UI.
  const [{ data: upcoming }, { data: past }, { count: pastCount }, { data: sync }] = await Promise.all([
    supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_out', todayStr)
      .order('check_in', { ascending: true })
      .limit(3000),
    supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lt('check_out', todayStr)
      .order('check_in', { ascending: false })
      .limit(50),
    supabase
      .from('guesty_reservations')
      .select('id', { count: 'exact', head: true })
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lt('check_out', todayStr),
    supabase.from('guesty_sync_status').select('last_sync_at, last_error, items_synced').eq('entity', 'reservations').maybeSingle()
  ])

  const cfMap = await customFieldNameMap()
  const up = upcoming ?? []
  const pastRows = past ?? []
  const pastTotal = pastCount ?? pastRows.length

  // ── KPIs derived only from queried columns ────────────────────────────────
  const in7d = new Date(todayStr + 'T12:00:00Z'); in7d.setUTCDate(in7d.getUTCDate() + 7)
  const in7Str = in7d.toISOString().slice(0, 10)
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
  const todayIds = new Set(arrivingToday.concat(departingToday).map(r => r.id))
  const futureArrivals = live
    .filter(r => r.check_in && r.check_in > todayStr && !todayIds.has(r.id))
    .slice(0, 60)
  const staying = live.filter(r => r.check_in && r.check_out && r.check_in < todayStr && r.check_out > todayStr && !todayIds.has(r.id))
  const pastShown = pastRows.slice(0, 40)

  // LEAN PASS (2026-09-22): the five stacked sections are tabs, driven by ?tab= so this stays a
  // server page. Default is the first tab with anything in it, arrivals first.
  const TABS: { key: string; label: string; rows: any[]; n: number }[] = [
    { key: 'arr', label: `Arriving ${dl}`, rows: arrivingToday, n: arrivingToday.length },
    { key: 'dep', label: `Departing ${dl}`, rows: departingToday, n: departingToday.length },
    { key: 'stay', label: 'In-house', rows: staying, n: staying.length },
    { key: 'soon', label: 'Upcoming', rows: futureArrivals, n: futureArrivals.length },
    { key: 'past', label: 'Past', rows: pastShown, n: pastTotal },
  ]
  const tabParam = (searchParams?.tab || '').trim()
  const active = TABS.find(t => t.key === tabParam) || TABS.find(t => t.rows.length > 0) || TABS[0]
  const tabHref = (k: string) => `/reservations?tab=${k}${viewingToday ? '' : `&date=${todayStr}`}`

  const totalSynced = sync?.items_synced ?? 0
  const lastSync = sync?.last_sync_at ?? null

  return (
    <Shell>
      <LeanHead title="Reservations">
        <Pill tone="emerald" title={`Check-ins ${dl}`}>{checkInsToday} in</Pill>
        <Pill tone="rose" title={`Check-outs ${dl}`}>{checkOutsToday} out</Pill>
        <Pill tone="brand" title={`In-house ${viewingToday ? 'now' : 'on ' + dl}`}>{inHouse} in-house</Pill>
        <Pill title="Arrivals in the next 7 days">{arrivals7Count} next 7d</Pill>
        <Pill title="Booked revenue on arrivals in the next 7 days">{fmtMoney(revenue7, currency)} 7d</Pill>
        {sync?.last_error && <Pill tone="amber" title="The last Guesty sync reported an issue — figures may be stale">Sync issue</Pill>}
      </LeanHead>

      {up.length === 0 && pastRows.length === 0 ? (
        <LeanEmpty>No reservations synced yet.</LeanEmpty>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px] max-w-full overflow-x-auto">
              {TABS.map(t => (
                <Link key={t.key} href={tabHref(t.key)} scroll={false}
                  className={`px-2.5 sm:px-3 py-1.5 font-semibold border-l border-line first:border-l-0 whitespace-nowrap ${active.key === t.key ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
                  {t.label}{t.n ? <span className="ml-1 opacity-70 tabular-nums">{t.n}</span> : null}
                </Link>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <DateFilter selected={todayStr} isToday={viewingToday} />
              <span className="text-[11px] text-muted" title={`${up.length} active · ${pastTotal} past${totalSynced ? ` · ${totalSynced.toLocaleString()} synced in total` : ''}`}>Synced {fmtSync(lastSync)}</span>
            </div>
          </div>

          {active.rows.length === 0
            ? <LeanEmpty>{active.key === 'past' ? 'No past stays.' : 'Nothing here.'}</LeanEmpty>
            : <ResRows rows={active.rows} cfMap={cfMap} />}
          {active.key === 'past' && pastTotal > pastShown.length && (
            <p className="text-[11px] text-muted mt-2 px-1">Latest {pastShown.length} of {pastTotal} past stays.</p>
          )}
        </>
      )}
    </Shell>
  )
}

// ── One line per reservation ─────────────────────────────────────────────────
// Guest, unit + dates, then tags (channel, status when it isn't plain "confirmed", total, balance
// due, custom-field count). Building, nights, paid and the Guesty custom fields sit behind the row.
function ResRows({ rows, cfMap }: { rows: any[]; cfMap: Record<string, string> }) {
  return (
    <LeanList>
      {rows.map(r => {
        const total = Number(r.money_total) || 0
        const paid = Number(r.money_paid) || 0
        const owed = total - paid
        const cur = r.money_currency || 'USD'
        const building = rollupBuilding(r.listing_name)
        const canceled = /cancel|declin/i.test(r.status || '')
        const cf = filledCustomFields(r.custom_fields, cfMap)
        const status = String(r.status || '').replace(/_/g, ' ')
        const nights = Number(r.nights) || 0
        return (
          <LeanRow key={r.id}
            name={<span className={canceled ? 'line-through text-muted' : ''}>{r.guest_name || 'Guest'}</span>}
            meta={`${r.listing_name || 'Unassigned'} · ${fmtWeekday(r.check_in)} ${fmtDay(r.check_in)} – ${fmtWeekday(r.check_out)} ${fmtDay(r.check_out)}`}
            tags={<>
              {r.source && <span title="Booking channel" className={`${TAG_CLS} ${sourceStyle(r.source)}`}>{r.source}</span>}
              {status && !/^confirmed$/i.test(status) && <span title="Guesty status" className={`${TAG_CLS} ${statusStyle(r.status)}`}>{status}</span>}
              <Tag title={`Total${nights ? ` for ${nights} night${nights === 1 ? '' : 's'}` : ''}`}>{fmtMoney(total, cur)}</Tag>
              {owed > 0.5 && !canceled && <Tag tone="amber" title="Balance not yet paid">{fmtMoney(owed, cur)} due</Tag>}
              {cf.length > 0 && <Tag title={cf.map(f => `${f.name}: ${f.value}`).join('\n')}>{cf.length} field{cf.length === 1 ? '' : 's'}</Tag>}
            </>}
            actions={<IconBtn title="Open in Guesty" href={`https://app.guesty.com/reservations/${r.id}/summary`}><ExternalLink size={14} /></IconBtn>}
          >
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-muted">
              {building && building !== (r.listing_name || '').trim() && <span>{building}</span>}
              <span>{nights || '—'} night{nights === 1 ? '' : 's'}</span>
              <span className="tabular-nums">{fmtMoney(total, cur)} total · {fmtMoney(paid, cur)} paid</span>
              {status && <span className={`px-1.5 py-0.5 rounded ${statusStyle(r.status)}`}>{status}</span>}
              {r.guest_email && <span className="truncate max-w-[16rem]">{r.guest_email}</span>}
            </div>
            {cf.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {cf.map((f, i) => (
                  <span key={i} className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 break-words max-w-full">
                    <span className="text-slate-400">{f.name}:</span> {f.value}
                  </span>
                ))}
              </div>
            )}
          </LeanRow>
        )
      })}
    </LeanList>
  )
}
