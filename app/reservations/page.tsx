import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { pageRows } from '@/lib/db-page'
import { Shell } from '@/components/Shell'
import { DateFilter } from '@/components/DateFilter'
import { customFieldNameMap, filledCustomFields } from '@/lib/custom-fields'
import { ExternalLink } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanEmpty, IconBtn } from '@/components/lean'
import { UnpaidStrip, loadUnpaidAll } from '@/components/UnpaidStrip'
import type { UnpaidRow as UnpaidRowT } from '@/lib/unpaid'

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
  // UPCOMING, READ WHOLE WHERE IT IS COUNTED (2026-09-29). This was one `.limit(3000)` read of every
  // stay not yet checked out; PostgREST stops at 1,000, so past 1,000 stays on the books the "active"
  // count stuck at 1,000 and a heavy week could drop arrivals off the 7-day pills. Now: every stay
  // arriving before date+7 (all the pills and today's tabs count), paged in check-in order; the next
  // 60 arrivals after that (the Upcoming tab shows 60); and an exact count of the whole set.
  const in7d = new Date(todayStr + 'T12:00:00Z'); in7d.setUTCDate(in7d.getUTCDate() + 7)
  const in7Str = in7d.toISOString().slice(0, 10)
  const [near, { data: later }, { count: upCount }, { data: past }, { count: pastCount }, { data: sync }] = await Promise.all([
    pageRows<any>((a, b) => supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_out', todayStr)
      .lt('check_in', in7Str)
      .order('check_in', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b), 5),
    supabase
      .from('guesty_reservations')
      .select('id, listing_name, guest_name, guest_email, check_in, check_out, nights, status, source, money_total, money_paid, money_currency, custom_fields')
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_out', todayStr)
      .gte('check_in', in7Str)
      .order('check_in', { ascending: true })
      .order('id', { ascending: true })
      .limit(60),
    supabase
      .from('guesty_reservations')
      .select('id', { count: 'exact', head: true })
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_out', todayStr),
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

  if (near.truncated) console.error('[reservations] read of stays arriving before ' + in7Str + ' stopped early — the pills and tabs may be short')
  const cfMap = await customFieldNameMap()
  // UNPAID (Jon, 2026-10-01): direct / VRBO / Google stays still owing — the tab shows ALL of them, the 7-day ones first as 'take care now' (Jon: '7 days have to be taken care but we should see all').
  const unpaidRep = await loadUnpaidAll()
  const unpaidAll = (unpaidRep?.rows || []).filter(r => r.tracking.status !== 'waived')
  const unpaid7 = unpaidAll.filter(r => r.bucket !== 'later')
  // A short near read must not let next week's arrivals stand in for this week's: without them the
  // page shows what it could read, and says so (the pill below), instead of a plausible wrong week.
  const up = near.truncated ? near.rows : near.rows.concat(later ?? [])
  const pastRows = past ?? []
  const pastTotal = pastCount ?? pastRows.length
  const upTotal = upCount ?? up.length

  // ── KPIs derived only from queried columns ────────────────────────────────
  const isCanceled = (s?: string | null) => /cancel|declin/i.test(s || '')

  const checkInsToday = up.filter(r => r.check_in === todayStr && !isCanceled(r.status)).length
  const checkOutsToday = up.filter(r => r.check_out === todayStr && !isCanceled(r.status)).length
  const inHouse = up.filter(r => r.check_in && r.check_out && r.check_in <= todayStr && r.check_out > todayStr && !isCanceled(r.status)).length
  const arrivals7 = up.filter(r => r.check_in && r.check_in >= todayStr && r.check_in < in7Str && !isCanceled(r.status))
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
  const TABS: { key: string; label: string; rows: any[]; n: number; hot?: boolean }[] = [
    // Unpaid sits first so it is seen (Jon, 2026-10-01: "a tab on top, so we can see it"); the default tab is still the day's arrivals.
    { key: 'unpaid', label: unpaid7.length ? `Unpaid · ${unpaid7.length} now` : 'Unpaid', rows: unpaidAll, n: unpaidAll.length, hot: unpaid7.length > 0 },
    { key: 'arr', label: `Arriving ${dl}`, rows: arrivingToday, n: arrivingToday.length },
    { key: 'dep', label: `Departing ${dl}`, rows: departingToday, n: departingToday.length },
    { key: 'stay', label: 'In-house', rows: staying, n: staying.length },
    { key: 'soon', label: 'Upcoming', rows: futureArrivals, n: futureArrivals.length },
    { key: 'past', label: 'Past', rows: pastShown, n: pastTotal },
  ]
  const tabParam = (searchParams?.tab || '').trim()
  const active = TABS.find(t => t.key === tabParam) || TABS.find(t => t.key !== 'unpaid' && t.rows.length > 0) || TABS[1]
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
        {near.truncated && <Pill tone="amber" title="Could not read every stay for this week — counts and tabs may be short. Refresh to try again.">Partial read</Pill>}
      </LeanHead>

      {up.length === 0 && pastRows.length === 0 ? (
        <LeanEmpty>No reservations synced yet.</LeanEmpty>
      ) : (
        <>
          {/* UNPAID — the money still owed on direct / VRBO / Google stays, by how soon it bites (Jon, 2026-10-01). */}
          {unpaidRep && <UnpaidStrip rep={unpaidRep} tabHref={tabHref('unpaid')} />}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px] max-w-full overflow-x-auto">
              {TABS.map(t => (
                <Link key={t.key} href={tabHref(t.key)} scroll={false}
                  className={`px-2.5 sm:px-3 py-1.5 font-semibold border-l border-line first:border-l-0 whitespace-nowrap ${active.key === t.key ? (t.hot ? 'bg-rose-600 text-white' : 'bg-brand-600 text-white') : t.hot ? 'bg-rose-50 text-rose-700 hover:text-rose-900' : 'bg-white text-muted hover:text-ink'}`}>
                  {t.label}{t.n ? <span className="ml-1 opacity-70 tabular-nums">{t.n}</span> : null}
                </Link>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <DateFilter selected={todayStr} isToday={viewingToday} />
              <span className="text-[11px] text-muted" title={`${upTotal} active · ${pastTotal} past${totalSynced ? ` · ${totalSynced.toLocaleString()} synced in total` : ''}`}>Synced {fmtSync(lastSync)}</span>
            </div>
          </div>

          {active.rows.length === 0
            ? <LeanEmpty>{active.key === 'past' ? 'No past stays.' : active.key === 'unpaid' ? 'Nothing owed — every direct, VRBO and Google stay on the books is paid.' : 'Nothing here.'}</LeanEmpty>
            : active.key === 'unpaid' ? <UnpaidRows rows={active.rows as UnpaidRowT[]} />
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
            name={<Link href={'/reservations/' + r.id} className={'hover:underline ' + (canceled ? 'line-through text-muted' : '')}>{r.guest_name || 'Guest'}</Link>}
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

// ── THE UNPAID TAB — the next 7 days, by how soon it bites ────────────────────────────────────
// (Jon, 2026-10-01: "Unpaid should have a section and populate 7 days of unpaid reservations").
const STATUS_ROW: Record<string, { label: string; tone: 'slate' | 'sky' | 'amber' | 'rose' | 'violet' }> = {
  open: { label: 'not contacted', tone: 'slate' }, contacted: { label: 'contacted', tone: 'sky' }, promised: { label: 'promised to pay', tone: 'amber' }, disputed: { label: 'disputed', tone: 'rose' }, waived: { label: 'waived', tone: 'violet' },
}
const CHAN: Record<string, string> = { vrbo: 'VRBO', homeaway: 'VRBO', manual: 'Direct', direct: 'Direct', 'be-api': 'Website', website: 'Website', google: 'Google' }
const GROUPS: { key: string; title: string; hint: string; tone?: 'rose' }[] = [
  { key: 'in_house', title: 'In the unit, still owing', hint: 'Collect before checkout', tone: 'rose' },
  { key: 'today', title: 'Arriving today', hint: 'Collect before the door code goes out', tone: 'rose' },
  { key: 'week', title: 'Next 7 days', hint: 'Chase now so the week is clean' },
  { key: 'later', title: 'Later', hint: 'On the radar — everything else on the books' },
]
function UnpaidRows({ rows }: { rows: UnpaidRowT[] }) {
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
  const total = rows.reduce((a, r) => a + r.balance, 0)
  const now = rows.filter(r => r.bucket !== 'later')
  return (
    <div className="space-y-4">
      <p className="px-1 text-[12px] text-muted"><b className="text-ink tabular-nums">{money(total)}</b> owed on {rows.length} {rows.length === 1 ? 'stay' : 'stays'} on the books{now.length ? <> · <b className="text-rose-700">{now.length} to take care of this week ({money(now.reduce((a, r) => a + r.balance, 0))})</b></> : null} · direct, VRBO and Google only · <Link href="/reservations/unpaid" className="font-semibold text-brand-700 hover:underline">statuses and notes on the board →</Link></p>
      {GROUPS.map(g => {
        const xs = rows.filter(r => r.bucket === g.key)
        if (!xs.length) return null
        return (
          <section key={g.key}>
            <h3 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-2">
              {g.key !== 'later' && <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-rose-600 text-white">take care now</span>}
              <span className={g.tone === 'rose' ? 'text-rose-700' : 'text-ink'}>{g.title}</span>
              <span className="tabular-nums text-muted">{xs.length}</span>
              <span className="normal-case tracking-normal font-medium text-muted">— {g.hint}</span>
              <span className="ml-auto normal-case tracking-normal font-semibold tabular-nums text-rose-700">{money(xs.reduce((a, r) => a + r.balance, 0))}</span>
            </h3>
            <LeanList>
              {xs.map(r => {
                const st = STATUS_ROW[r.tracking.status] || STATUS_ROW.open
                const last = r.tracking.notes[r.tracking.notes.length - 1]
                return (
                  <LeanRow key={r.id}
                    name={<Link href={'/reservations/' + r.id} className="hover:underline">{r.guest}</Link>}
                    meta={`${r.unit} · ${fmtWeekday(r.checkIn)} ${fmtDay(r.checkIn)} – ${fmtWeekday(r.checkOut)} ${fmtDay(r.checkOut)}${r.nights ? ` · ${r.nights} night${r.nights === 1 ? '' : 's'}` : ''}`}
                    tags={<>
                      <span title="Booking channel — we collect" className={`${TAG_CLS} ${sourceStyle(r.source)}`}>{CHAN[String(r.source || '').toLowerCase()] || r.source}</span>
                      <Tag tone="rose" title={`Paid ${money(r.paid)} of ${money(r.total)}`}>{money(r.balance)} owed</Tag>
                      {r.paid > 0 ? <Tag title="What has been paid so far">{money(r.paid)} paid</Tag> : <Tag tone="amber" title="No payment has landed on this folio">nothing paid</Tag>}
                      <Tag tone={st.tone} title={'Follow-up status' + (r.tracking.updatedBy ? ' · ' + r.tracking.updatedBy : '')}>{st.label}</Tag>
                    </>}
                    actions={<IconBtn title="Open in Guesty" href={r.guestyUrl}><ExternalLink size={14} /></IconBtn>}
                  >
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-muted">
                      <span className="tabular-nums">{money(r.total)} total · {money(r.paid)} paid · <b className="text-rose-700">{money(r.balance)} owed</b></span>
                      {r.phone && <a href={'tel:' + r.phone} className="hover:underline">{r.phone}</a>}
                      {r.email && <span className="truncate max-w-[16rem]">{r.email}</span>}
                      {last && <span className="truncate max-w-[24rem]" title={last.by + ' · ' + last.at}>“{last.text}” — {last.by}</span>}
                    </div>
                  </LeanRow>
                )
              })}
            </LeanList>
          </section>
        )
      })}
    </div>
  )
}
