// THE SALES REPORT — what we BOOKED, by the day the booking was made (2026-11-09).
//
// Revenue Center answers "what did the stays in this range earn" (stay-date, prorated per night).
// Nothing answered the sales question: how much did we book today / this week / this month, against
// the same days last year and against the budget; where it came from; which units are behind pace
// and need a price or content action; and what was cancelled. This is that report.
//
// ONE SET OF RULES, the same ones the sibling pages already use:
//   - A BOOKING is a reservation whose status is confirmed / checked_in / checked_out (Revenue
//     Center's set). `closed`, inquiries, declined and expired never were bookings (lib/stay-status:
//     Guesty's `closed` is a request that never confirmed).
//   - "BOOKED" in a period = bookings MADE in it (guesty_reservations.created_at, bucketed by the
//     Eastern day — lib/marketing's rule), INCLUDING the ones cancelled since. Last year's bookings
//     have had a year to cancel and today's have had none, so comparing only what is still live
//     would flatter this year. What was cancelled since is shown beside it.
//   - Owner and friends-&-family stays are out of every sales figure (lib/owner-audit, the one shared
//     test). They still HOLD nights, so they come off the "open nights" a unit has left to sell.
//   - MONEY = accommodation the guest paid before channel fees (fareAccommodationAdjusted, falling
//     back to fareAccommodation) — Revenue Center's "gross accommodation" and /marketing's headline.
//     No cleaning, no taxes. The month-vs-budget block alone is NET — THE ONE NET of lib/basis
//     (accommodation − hostServiceFeeIncTax, else hostServiceFee) — because the budget it is compared
//     with is net accommodation.
//   - SAME-STORE (2026-11-09). The portfolio grew, so "up on last year" is partly just more units.
//     Every vs-last-year figure therefore comes twice: ALL UNITS (everything we sold then against
//     everything we sell now) and SAME-STORE — only the units that are active now AND were already
//     live on this date last year, on both sides. A unit was live then when its Guesty listing was
//     created on or before that day, or when a reservation for it had been made by then.
//   - LAST YEAR = the same weekdays 52 weeks earlier (364 days) for days, weeks and pace windows;
//     the same calendar dates for a month. A period still in progress is compared with last year's
//     UP TO THE SAME TIME OF DAY, so 10am today is never judged against a whole day.
//   - PACE = nights on the books for the next 30 / 60 days against what was on the books for the
//     matching dates a year ago AS OF the same day (booked by then). Directional, same caveat as
//     lib/forecast/pacing: we do not hold the date a booking was cancelled, so last year's side
//     leaves out stays that were on the books then and cancelled later.
//
// PERF: flat columns and `->>` scalars only (never the raw money object), every read paged and
// ordered (lib/db-page), seven reads in parallel, the whole build cached ten minutes.
import 'server-only'
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { isOwnerOrFriendsFamily } from './owner-audit'
import { bucketFor, familyFor, otaGroupFor } from './marketing'
import { rollupBuilding } from './optimize-score'
import { monthBudget } from './money-source'
import { LIVE_STAY_STATUSES, channelFeeOf } from './basis'

export type SalesSide = { bookings: number; nights: number; revenue: number; cancelled: number; cancelledRevenue: number }
export type SalesPeriod = {
  key: 'today' | 'yesterday' | 'week' | 'month'
  label: string
  from: string; to: string; lyFrom: string; lyTo: string
  /** True while the period is still running — last year's side is cut at the same time of day. */
  partial: boolean
  now: SalesSide
  ly: SalesSide
  /** % change vs last year over ALL UNITS; null when last year had nothing to compare with. */
  revenuePct: number | null
  bookingsPct: number | null
  /** The same comparison over the same-store units only (active now and live a year ago). */
  sameStore: { now: SalesSide; ly: SalesSide; revenuePct: number | null; bookingsPct: number | null }
}
export type SalesChannel = {
  name: string
  family: 'direct' | 'manual' | 'ota'
  bookings: number; nights: number; revenue: number; cancelled: number
  /** Share of the month's booked value (0..1) — of bookings when dollars are hidden. */
  share: number
  lyShare: number | null
  /** The same two shares counted in bookings — what the dollars-hidden view shows. */
  bookingShare: number
  lyBookingShare: number | null
  lyRevenue: number; lyBookings: number
}
export type SalesDay = { d: string; revenue: number; bookings: number; lyRevenue: number; lyBookings: number }
export type PaceStatus = 'behind' | 'cold' | 'watch' | 'ahead' | 'ok'
export type PaceUnit = {
  id: string; name: string; building: string
  /** Guest nights on the books for the next 30 / 60 days. */
  nights30: number; nights60: number
  /** Same dates a year ago as of the same day; null when the unit was not listed then. */
  ly30: number | null; ly60: number | null
  /** Owner / friends-&-family nights in the next 30 days — not sold, but not open either. */
  held30: number
  open30: number
  /** Guest nights ÷ nights not held, next 30 days (0..1). */
  occ30: number
  /** The same ratio for the unit's building. */
  bldOcc30: number
  revenue30: number
  /** Bookings made in the last 14 days for this unit (any stay date). */
  pickup14: number
  pickupNights14: number
  status: PaceStatus
  /** Sort key: nights short of where it should be (vs last year when known, else vs the building). */
  need: number
  action: string
  why: string
}
export type SalesMonth = {
  month: string; label: string
  daysLeft: number
  nights: number
  /** Guest nights ÷ (active units × days in the month), 0..1. */
  occ: number
  /** Net accommodation on the books for stays in the month. */
  revenue: number
  lySameTime: number | null
  lyFinal: number | null
  lyNightsSameTime: number | null
  budget: number | null
  pctOfBudget: number | null
  /** On the books vs last year at the same point — all units. */
  pctVsLy: number | null
  /** The same, same-store units only. Revenue is null when dollars are hidden. */
  ssNights: number
  ssLyNightsSameTime: number | null
  ssRevenue: number | null
  ssLySameTime: number | null
  ssPctVsLy: number | null
}
export type SalesCancel = {
  id: string; unit: string; building: string; channel: string
  checkIn: string; checkOut: string; nights: number; revenue: number
  /** The Eastern day the reservation last changed (our best read of when it was cancelled). */
  changed: string
  /** Days from that change to arrival — a short one is a night that is hard to resell. */
  daysToArrival: number | null
}
export type SalesReport = {
  ok: true
  generatedAt: string
  today: string
  asOfLastYear: string
  lastSync: string | null
  showMoney: boolean
  /** Units active now that were already live on `asOfLastYear`, and all active units. */
  sameStoreUnits: number
  activeUnits: number
  periods: SalesPeriod[]
  channels: SalesChannel[]
  directShare: number | null
  lyDirectShare: number | null
  days: SalesDay[]
  pace: {
    activeUnits: number
    from: string; to30: string; lyFrom: string
    nights30: number; nights60: number
    /** Portfolio comparison over the units that were already listed a year ago. */
    sameUnits: number; sameNights30: number; sameLy30: number; pct30: number | null
    /** All units: every night on the books now vs every night on the books then (units since left included). */
    allLy30: number; allPct30: number | null
    sameNights60: number; sameLy60: number; pct60: number | null
    occ30: number
    behind: number; cold: number; ahead: number
    units: PaceUnit[]
  }
  months: SalesMonth[]
  cancels: {
    /** 'changed' = cancelled reservations by the day they last changed; 'made' = no change dates held,
     *  so these are the bookings made in the last 30 days that have already cancelled. */
    mode: 'changed' | 'made'
    days: number
    count: number; nights: number; revenue: number
    byChannel: { name: string; count: number; revenue: number }[]
    list: SalesCancel[]
  }
  notes: string[]
}

const TZ = 'America/New_York'
const DAY = 86_400_000
const LIVE = LIVE_STAY_STATUSES
const CANCELLED = ['canceled', 'cancelled']
const DEAD_LISTING = ['inactive', 'disabled', 'archived', 'deleted']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const ymdET = (d: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const shift = (ymd: string, n: number): string => new Date(Date.parse(ymd + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10)
const diffDays = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY)
const pctChange = (a: number, b: number): number | null => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null)
const dOf = (v: any): string => str(v).slice(0, 10)

/** The Eastern day an instant falls on ('' when it cannot be read). */
function etDay(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  return Number.isFinite(t) ? ymdET(new Date(t)) : ''
}
/** The UTC instant of 00:00 in New York on `ymd`. */
function etMidnightUtc(ymd: string): string {
  const guess = Date.parse(ymd + 'T05:00:00Z')            // midnight EST
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date(guess))) % 24
  return new Date(guess - h * 3_600_000).toISOString()    // 1am EDT → back an hour
}
const monthStart = (ymd: string): string => ymd.slice(0, 8) + '01'
function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12
  return yy + '-' + String(mm + 1).padStart(2, '0')
}
function daysInMonth(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()
}
/** The same calendar date a year earlier (Feb 29 → Feb 28). */
function lastYearDate(ymd: string): string {
  const ym = addMonths(ymd.slice(0, 7), -12)
  const day = Math.min(Number(ymd.slice(8, 10)), daysInMonth(ym))
  return ym + '-' + String(day).padStart(2, '0')
}
/** Nights of [checkIn, checkOut) that fall in [from, toExcl). */
function overlap(checkIn: string, checkOut: string, from: string, toExcl: string): number {
  if (!checkIn || !checkOut) return 0
  const s = checkIn > from ? checkIn : from
  const e = checkOut < toExcl ? checkOut : toExcl
  const n = diffDays(s, e)
  return n > 0 ? n : 0
}
const isLive = (status: any): boolean => LIVE.indexOf(str(status).toLowerCase()) >= 0
const isCancelled = (status: any): boolean => /cancel/i.test(str(status))
const ownerish = (r: any): boolean => {
  const tagBlob = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).join(' ') : ''
  return isOwnerOrFriendsFamily(str(r.source), tagBlob, str(r.guest_name))
}
/** Accommodation the guest paid, before channel fees. */
const accom = (r: any): number => num(r.fare) || num(r.fareBase)
/** Accommodation after the channel fee — THE ONE NET (lib/basis channelFeeOf). */
const netAccom = (r: any): number => Math.max(0, accom(r) - channelFeeOf(r.feeInc, r.fee))
const stayNights = (r: any): number => Math.max(1, num(r.nights) || diffDays(dOf(r.check_in), dOf(r.check_out)) || 1)

function channelOf(source: string): { name: string; family: 'direct' | 'manual' | 'ota' } {
  const fam = familyFor(bucketFor(source))
  if (fam === 'direct') return { name: 'Direct', family: 'direct' }
  if (fam === 'manual' || fam === 'owner') return { name: 'Manual (office)', family: 'manual' }
  return { name: otaGroupFor(source), family: 'ota' }
}

const BOOKED_COLS = 'id,listing_id,check_in,check_out,nights,status,source,guest_name,created_at,' +
  'fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,tags:raw->tags'
const STAY_COLS = BOOKED_COLS + ',feeInc:raw->money->>hostServiceFeeIncTax,fee:raw->money->>hostServiceFee'
const CANCEL_COLS = 'id,listing_id,listing_name,check_in,check_out,nights,status,source,guest_name,created_at,' +
  'fare:raw->money->>fareAccommodationAdjusted,fareBase:raw->money->>fareAccommodation,tags:raw->tags,changed:raw->>lastUpdatedAt'

type Read = { rows: any[]; truncated: boolean }

/** Bookings (live or since cancelled) MADE on the Eastern days [fromDay, toDay]. */
function bookedBetween(fromDay: string, toDay: string): Promise<Read> {
  const lo = etMidnightUtc(fromDay), hi = etMidnightUtc(shift(toDay, 1))
  return pageRows<any>((a, b) => supabaseAdmin().from('guesty_reservations').select(BOOKED_COLS)
    .in('status', [...LIVE, ...CANCELLED]).gte('created_at', lo).lt('created_at', hi)
    .order('id').range(a, b), 20)
}
/** Live stays with a night in [from, toExcl). */
function staysBetween(from: string, toExcl: string): Promise<Read> {
  return pageRows<any>((a, b) => supabaseAdmin().from('guesty_reservations').select(STAY_COLS)
    .in('status', LIVE).gt('check_out', from).lt('check_in', toExcl)
    .order('id').range(a, b), 25)
}

const emptySide = (): SalesSide => ({ bookings: 0, nights: 0, revenue: 0, cancelled: 0, cancelledRevenue: 0 })
function addBooking(s: SalesSide, r: any) {
  const v = accom(r)
  s.bookings += 1; s.nights += stayNights(r); s.revenue += v
  if (isCancelled(r.status)) { s.cancelled += 1; s.cancelledRevenue += v }
}
const roundSide = (s: SalesSide): SalesSide => ({ ...s, revenue: Math.round(s.revenue), cancelledRevenue: Math.round(s.cancelledRevenue) })

async function compute(today: string): Promise<SalesReport> {
  const notes: string[] = []
  const nowMs = Date.now()
  const db = supabaseAdmin()

  // ---- the calendar ----
  const dow = new Date(Date.parse(today + 'T12:00:00Z')).getUTCDay()
  const weekStart = shift(today, -((dow + 6) % 7))            // Monday
  const mStart = monthStart(today)
  const trendStart = shift(today, -27)
  const asOf = shift(today, -364)                              // same weekday, a year ago
  const lyToday = lastYearDate(today)                          // same calendar date, a year ago
  const lyMStart = monthStart(lyToday)
  const curStart = [weekStart, mStart, trendStart].sort()[0]
  const lyStart = [shift(weekStart, -364), lyMStart, shift(trendStart, -364)].sort()[0]
  const lyEnd = asOf > lyToday ? asOf : lyToday

  const ym0 = today.slice(0, 7)
  const monthKeys = [ym0, addMonths(ym0, 1), addMonths(ym0, 2)]
  const lastMonthEndExcl = addMonths(ym0, 3) + '-01'
  const paceEndExcl = shift(today, 60)
  const stayToExcl = lastMonthEndExcl > paceEndExcl ? lastMonthEndExcl : paceEndExcl
  const lyStayFrom = [addMonths(ym0, -12) + '-01', asOf].sort()[0]
  const lyStayToExclA = addMonths(ym0, -9) + '-01', lyStayToExclB = shift(asOf, 60)
  const lyStayToExcl = lyStayToExclA > lyStayToExclB ? lyStayToExclA : lyStayToExclB

  // ---- reads ----
  const [bookedNow, bookedLy, staysNow, staysLy, listingRead, cancelRead, syncRes, budgets] = await Promise.all([
    bookedBetween(curStart, today),
    bookedBetween(lyStart, lyEnd),
    staysBetween(mStart, stayToExcl),
    staysBetween(lyStayFrom, lyStayToExcl),
    pageRows<any>((a, b) => db.from('guesty_listings')
      .select('id,title,nickname,building,status,created:raw->>createdAt').order('id').range(a, b), 4),
    // Cancelled reservations that arrive (or would have) from a week ago onwards — a cancellation in
    // the last week is nearly always for a stay still ahead.
    pageRows<any>((a, b) => db.from('guesty_reservations').select(CANCEL_COLS)
      .in('status', CANCELLED).gte('check_in', shift(today, -7))
      .order('id').range(a, b), 10),
    db.from('guesty_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle(),
    Promise.all(monthKeys.map(m => monthBudget(m).catch(() => null))),
  ])
  if (bookedNow.truncated) notes.push('this year\'s bookings read stopped early — booked figures are floors')
  if (bookedLy.truncated) notes.push('last year\'s bookings read stopped early — last-year figures are floors')
  if (staysNow.truncated) notes.push('the on-the-books read stopped early — pace figures are floors')
  if (staysLy.truncated) notes.push('last year\'s on-the-books read stopped early — pace comparisons lean in this year\'s favour')
  if (listingRead.truncated) notes.push('the listings read stopped early — some units are missing from the pace table')

  // ---- listings ----
  type L = { id: string; name: string; building: string; active: boolean; created: string }
  const lmap: Record<string, L> = {}
  for (const l of listingRead.rows) {
    const name = str(l.nickname || l.title || l.id)
    lmap[str(l.id)] = {
      id: str(l.id), name,
      building: rollupBuilding(str(l.building).trim(), name),
      active: DEAD_LISTING.indexOf(str(l.status).toLowerCase()) < 0 && !/\bfull\b/i.test(name),
      created: str(l.created).slice(0, 10),
    }
  }
  const active = Object.keys(lmap).map(k => lmap[k]).filter(l => l.active)

  // ---- same-store: active now AND live on this date last year ----
  const asOfCut = Date.parse(etMidnightUtc(shift(asOf, 1)))   // by the end of that Eastern day
  const soldByThen: Record<string, boolean> = {}
  for (const r of bookedLy.rows.concat(staysLy.rows)) {
    const ts = Date.parse(str(r.created_at))
    if (Number.isFinite(ts) && ts < asOfCut && r.listing_id) soldByThen[str(r.listing_id)] = true
  }
  const sameStore: Record<string, boolean> = {}
  for (const l of active) if ((l.created && l.created <= asOf) || soldByThen[l.id]) sameStore[l.id] = true
  const sameStoreUnits = Object.keys(sameStore).length
  const inSame = (r: any): boolean => sameStore[str(r.listing_id)] === true
  if (active.length > 0 && sameStoreUnits === 0) notes.push('no unit could be shown to have been live a year ago — same-store comparisons are blank')

  // ---- booked: periods ----
  const curBooked = bookedNow.rows.filter(r => !ownerish(r)).map(r => ({ r, day: etDay(str(r.created_at)), ts: Date.parse(str(r.created_at)) }))
  const lyBooked = bookedLy.rows.filter(r => !ownerish(r)).map(r => ({ r, day: etDay(str(r.created_at)), ts: Date.parse(str(r.created_at)) }))
  const yesterday = shift(today, -1)
  const defs: { key: SalesPeriod['key']; label: string; from: string; to: string; lyFrom: string; lyTo: string; cutDays: number | null }[] = [
    { key: 'today', label: 'Today', from: today, to: today, lyFrom: asOf, lyTo: asOf, cutDays: 364 },
    { key: 'yesterday', label: 'Yesterday', from: yesterday, to: yesterday, lyFrom: shift(yesterday, -364), lyTo: shift(yesterday, -364), cutDays: null },
    { key: 'week', label: 'This week', from: weekStart, to: today, lyFrom: shift(weekStart, -364), lyTo: asOf, cutDays: 364 },
    { key: 'month', label: 'This month', from: mStart, to: today, lyFrom: lyMStart, lyTo: lyToday, cutDays: diffDays(lyToday, today) },
  ]
  const periods: SalesPeriod[] = defs.map(p => {
    const now = emptySide(), ly = emptySide(), ssNow = emptySide(), ssLy = emptySide()
    for (const x of curBooked) if (x.day >= p.from && x.day <= p.to) { addBooking(now, x.r); if (inSame(x.r)) addBooking(ssNow, x.r) }
    const cut = p.cutDays == null ? null : nowMs - p.cutDays * DAY
    for (const x of lyBooked) {
      if (x.day < p.lyFrom || x.day > p.lyTo) continue
      if (cut != null && Number.isFinite(x.ts) && x.ts >= cut) continue
      addBooking(ly, x.r)
      if (inSame(x.r)) addBooking(ssLy, x.r)
    }
    return {
      key: p.key, label: p.label, from: p.from, to: p.to, lyFrom: p.lyFrom, lyTo: p.lyTo, partial: p.cutDays != null,
      now: roundSide(now), ly: roundSide(ly),
      revenuePct: pctChange(now.revenue, ly.revenue), bookingsPct: pctChange(now.bookings, ly.bookings),
      sameStore: {
        now: roundSide(ssNow), ly: roundSide(ssLy),
        revenuePct: pctChange(ssNow.revenue, ssLy.revenue), bookingsPct: pctChange(ssNow.bookings, ssLy.bookings),
      },
    }
  })

  // ---- booked: channel mix, month to date ----
  const mp = defs[3]
  const mCut = nowMs - (mp.cutDays || 0) * DAY
  type ChAcc = { name: string; family: 'direct' | 'manual' | 'ota'; bookings: number; nights: number; revenue: number; cancelled: number; lyRevenue: number; lyBookings: number }
  const ch: Record<string, ChAcc> = {}
  const chOf = (source: string): ChAcc => {
    const c = channelOf(source)
    return ch[c.name] = ch[c.name] || { name: c.name, family: c.family, bookings: 0, nights: 0, revenue: 0, cancelled: 0, lyRevenue: 0, lyBookings: 0 }
  }
  let mRev = 0, mCount = 0, mLyRev = 0, mLyCount = 0
  for (const x of curBooked) {
    if (x.day < mp.from || x.day > mp.to) continue
    const c = chOf(str(x.r.source)); const v = accom(x.r)
    c.bookings += 1; c.nights += stayNights(x.r); c.revenue += v
    if (isCancelled(x.r.status)) c.cancelled += 1
    mRev += v; mCount += 1
  }
  for (const x of lyBooked) {
    if (x.day < mp.lyFrom || x.day > mp.lyTo) continue
    if (Number.isFinite(x.ts) && x.ts >= mCut) continue
    const c = chOf(str(x.r.source)); const v = accom(x.r)
    c.lyRevenue += v; c.lyBookings += 1
    mLyRev += v; mLyCount += 1
  }
  const channels: SalesChannel[] = Object.keys(ch).map(k => ch[k])
    .filter(c => c.bookings > 0 || c.lyBookings > 0)
    .map(c => ({
      name: c.name, family: c.family, bookings: c.bookings, nights: c.nights, revenue: Math.round(c.revenue), cancelled: c.cancelled,
      share: mRev > 0 ? c.revenue / mRev : 0,
      lyShare: mLyRev > 0 ? c.lyRevenue / mLyRev : null,
      bookingShare: mCount > 0 ? c.bookings / mCount : 0,
      lyBookingShare: mLyCount > 0 ? c.lyBookings / mLyCount : null,
      lyRevenue: Math.round(c.lyRevenue), lyBookings: c.lyBookings,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings)
  const direct = ch['Direct']
  const directShare = mRev > 0 ? (direct ? direct.revenue : 0) / mRev : null
  const lyDirectShare = mLyRev > 0 ? (direct ? direct.lyRevenue : 0) / mLyRev : null

  // ---- booked: 28-day trend ----
  const dayIdx: Record<string, number> = {}
  const days: SalesDay[] = []
  for (let d = trendStart; d <= today; d = shift(d, 1)) { dayIdx[d] = days.length; days.push({ d, revenue: 0, bookings: 0, lyRevenue: 0, lyBookings: 0 }) }
  for (const x of curBooked) { const i = dayIdx[x.day]; if (i !== undefined) { days[i].revenue += accom(x.r); days[i].bookings += 1 } }
  for (const x of lyBooked) { const i = x.day ? dayIdx[shift(x.day, 364)] : undefined; if (i !== undefined) { days[i].lyRevenue += accom(x.r); days[i].lyBookings += 1 } }
  for (const d of days) { d.revenue = Math.round(d.revenue); d.lyRevenue = Math.round(d.lyRevenue) }

  // ---- pace: next 30 / 60 days by unit ----
  const t30 = shift(today, 30), t60 = shift(today, 60)
  const ly30End = shift(asOf, 30), ly60End = shift(asOf, 60)
  type U = { n30: number; n60: number; held30: number; rev30: number; ly30: number; ly60: number; pick: number; pickN: number }
  const acc: Record<string, U> = {}
  const uOf = (id: string): U => acc[id] = acc[id] || { n30: 0, n60: 0, held30: 0, rev30: 0, ly30: 0, ly60: 0, pick: 0, pickN: 0 }
  for (const r of staysNow.rows) {
    const id = str(r.listing_id); if (!id) continue
    const ci = dOf(r.check_in), co = dOf(r.check_out)
    const a = overlap(ci, co, today, t30)
    const b = overlap(ci, co, today, t60)
    if (b <= 0) continue
    const u = uOf(id)
    if (ownerish(r)) { u.held30 += a; continue }
    u.n30 += a; u.n60 += b
    if (a > 0) u.rev30 += (accom(r) / stayNights(r)) * a
  }
  for (const r of staysLy.rows) {
    const id = str(r.listing_id); if (!id || ownerish(r)) continue
    const ts = Date.parse(str(r.created_at))
    if (Number.isFinite(ts) && ts >= asOfCut) continue         // not yet booked at this point last year
    const ci = dOf(r.check_in), co = dOf(r.check_out)
    const b = overlap(ci, co, asOf, ly60End)
    if (b <= 0) continue
    const u = uOf(id)
    u.ly30 += overlap(ci, co, asOf, ly30End); u.ly60 += b
  }
  const pickFrom = shift(today, -13)
  for (const x of curBooked) {
    if (x.day < pickFrom || !isLive(x.r.status)) continue
    const id = str(x.r.listing_id); if (!id) continue
    const u = uOf(id); u.pick += 1; u.pickN += stayNights(x.r)
  }
  // Building benchmark: guest nights ÷ nights not held, next 30 days.
  const bAgg: Record<string, { sold: number; sellable: number }> = {}
  for (const l of active) {
    const u = acc[l.id]
    const b = bAgg[l.building] = bAgg[l.building] || { sold: 0, sellable: 0 }
    b.sold += u ? u.n30 : 0; b.sellable += 30 - (u ? Math.min(30, u.held30) : 0)
  }

  // THE PACE RULES — rules, not a model, and deliberately few:
  //   behind  same-store (live a year ago), last year had 5+ nights on the books by now, and we are 4+ nights short
  //   cold    20+ of the next 30 nights open and not one booking made in 14 days
  //   watch   10+ points under the building's booked share (no last-year read, or not short enough to be "behind")
  //   ahead   85%+ booked and 4+ nights up on last year — the rate is probably too low
  const units: PaceUnit[] = active.map(l => {
    const u = acc[l.id] || { n30: 0, n60: 0, held30: 0, rev30: 0, ly30: 0, ly60: 0, pick: 0, pickN: 0 }
    const held = Math.min(30, u.held30)
    const sellable = 30 - held
    const open30 = Math.max(0, sellable - u.n30)
    const occ30 = sellable > 0 ? Math.min(1, u.n30 / sellable) : 0
    const ba = bAgg[l.building]
    const bldOcc30 = ba && ba.sellable > 0 ? ba.sold / ba.sellable : 0
    const hasLy = sameStore[l.id] === true                     // the same same-store test as the headline
    const ly30 = hasLy ? u.ly30 : null, ly60 = hasLy ? u.ly60 : null
    const gapLy = ly30 == null ? 0 : ly30 - u.n30
    const gapBld = Math.round((bldOcc30 - occ30) * sellable)
    let status: PaceStatus = 'ok', action = '', why = ''
    if (sellable <= 3) {
      why = 'Held by the owner for most of the next 30 days'
    } else if (ly30 != null && ly30 >= 5 && gapLy >= 4) {
      status = 'behind'
      why = u.n30 + ' nights booked vs ' + ly30 + ' at this point last year'
      action = u.pick === 0
        ? 'Price: no booking in 14 days — cut the next two weeks about 10% and relax the minimum stay'
        : 'Price: still short with ' + u.pick + ' booking' + (u.pick === 1 ? '' : 's') + ' in 14 days — trim the open dates about 5%'
    } else if (open30 >= 20 && u.pick === 0) {
      status = 'cold'
      why = open30 + ' of the next 30 nights open, no booking in 14 days'
      action = bldOcc30 - occ30 >= 0.10
        ? 'Listing: the building is selling and this unit is not — check it is live on every channel, then photos, title and reviews'
        : 'Price: the building is slow too — review the near-term rate and minimum stay for the whole building'
    } else if (bldOcc30 - occ30 >= 0.10 && gapBld >= 3) {
      status = 'watch'
      why = Math.round(occ30 * 100) + '% booked vs ' + Math.round(bldOcc30 * 100) + '% for ' + l.building
      action = 'Compare rate and photos with the units in the building that are filling'
    } else if (occ30 >= 0.85 && ly30 != null && u.n30 - ly30 >= 4) {
      status = 'ahead'
      why = Math.round(occ30 * 100) + '% booked, ' + (u.n30 - ly30) + ' nights up on last year'
      action = 'Raise the rate on the nights still open'
    }
    const need = status === 'behind' ? gapLy : status === 'cold' ? Math.max(gapBld, Math.round(open30 / 4)) : status === 'watch' ? gapBld : 0
    return {
      id: l.id, name: l.name, building: l.building,
      nights30: u.n30, nights60: u.n60, ly30, ly60, held30: held, open30, occ30, bldOcc30,
      revenue30: Math.round(u.rev30), pickup14: u.pick, pickupNights14: u.pickN,
      status, need, action, why,
    }
  })
  const RANK: Record<PaceStatus, number> = { behind: 0, cold: 1, watch: 2, ahead: 3, ok: 4 }
  units.sort((a, b) => RANK[a.status] - RANK[b.status] || b.need - a.need || a.occ30 - b.occ30 || a.name.localeCompare(b.name))

  let nights30 = 0, nights60 = 0, sellableAll = 0, sameUnits = 0, sameN30 = 0, sameL30 = 0, sameN60 = 0, sameL60 = 0
  for (const u of units) {
    nights30 += u.nights30; nights60 += u.nights60; sellableAll += 30 - u.held30
    if (u.ly30 != null && u.ly60 != null) { sameUnits++; sameN30 += u.nights30; sameL30 += u.ly30; sameN60 += u.nights60; sameL60 += u.ly60 }
  }
  let allLy30 = 0
  for (const id of Object.keys(acc)) allLy30 += acc[id].ly30

  // ---- months: on the books vs last year at the same time, last year's final, and the budget ----
  const months: SalesMonth[] = monthKeys.map((ym, i) => {
    const from = ym + '-01', toExcl = addMonths(ym, 1) + '-01'
    const lyYm = addMonths(ym, -12), lyFrom = lyYm + '-01', lyToExcl = addMonths(lyYm, 1) + '-01'
    let nights = 0, revenue = 0, lyNightsST = 0, lyST = 0, lyFinal = 0
    let ssNights = 0, ssRev = 0, ssLyNights = 0, ssLy = 0
    for (const r of staysNow.rows) {
      if (ownerish(r)) continue
      const n = overlap(dOf(r.check_in), dOf(r.check_out), from, toExcl)
      if (n <= 0) continue
      const v = (netAccom(r) / stayNights(r)) * n
      nights += n; revenue += v
      if (inSame(r)) { ssNights += n; ssRev += v }
    }
    for (const r of staysLy.rows) {
      if (ownerish(r)) continue
      const n = overlap(dOf(r.check_in), dOf(r.check_out), lyFrom, lyToExcl)
      if (n <= 0) continue
      const v = (netAccom(r) / stayNights(r)) * n
      lyFinal += v
      const ts = Date.parse(str(r.created_at))
      if (!Number.isFinite(ts) || ts < asOfCut) {
        lyST += v; lyNightsST += n
        if (inSame(r)) { ssLy += v; ssLyNights += n }
      }
    }
    const dim = daysInMonth(ym)
    const bud = budgets[i]
    const budget = bud && bud.netAccom != null && bud.netAccom > 0 ? Math.round(bud.netAccom) : null
    const haveLy = !staysLy.truncated && lyFinal > 0
    return {
      month: ym, label: MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4),
      daysLeft: i === 0 ? dim - Number(today.slice(8, 10)) + 1 : dim,
      nights, occ: active.length > 0 ? nights / (active.length * dim) : 0,
      revenue: Math.round(revenue),
      lySameTime: haveLy ? Math.round(lyST) : null,
      lyFinal: haveLy ? Math.round(lyFinal) : null,
      lyNightsSameTime: haveLy ? lyNightsST : null,
      budget,
      pctOfBudget: budget ? Math.round((revenue / budget) * 100) : null,
      pctVsLy: haveLy ? pctChange(revenue, lyST) : null,
      ssNights, ssLyNightsSameTime: haveLy ? ssLyNights : null,
      ssRevenue: Math.round(ssRev), ssLySameTime: haveLy ? Math.round(ssLy) : null,
      ssPctVsLy: haveLy ? pctChange(ssRev, ssLy) : null,
    }
  })

  // ---- cancellations ----
  const CANCEL_DAYS = 7
  const cancelRows = cancelRead.rows.filter(r => !ownerish(r))
  const withDate = cancelRows.filter(r => !!etDay(str(r.changed))).length
  const datesKnown = cancelRows.length === 0 || withDate / cancelRows.length >= 0.5
  const toCancel = (r: any, changed: string): SalesCancel => {
    const l = lmap[str(r.listing_id)]
    const name = l ? l.name : (str(r.listing_name) || 'Unknown unit')
    const ci = dOf(r.check_in)
    return {
      id: str(r.id), unit: name, building: l ? l.building : rollupBuilding('', name),
      channel: channelOf(str(r.source)).name,
      checkIn: ci, checkOut: dOf(r.check_out), nights: stayNights(r), revenue: Math.round(accom(r)),
      changed, daysToArrival: changed && ci ? diffDays(changed, ci) : null,
    }
  }
  const cancelList: SalesCancel[] = []
  let cancelMode: 'changed' | 'made' = 'changed'
  let cancelDays = CANCEL_DAYS
  if (datesKnown) {
    const since = shift(today, -(CANCEL_DAYS - 1))
    for (const r of cancelRows) { const c = etDay(str(r.changed)); if (c && c >= since && c <= today) cancelList.push(toCancel(r, c)) }
    if (cancelRead.truncated) notes.push('the cancellations read stopped early — the cancelled list is incomplete')
  } else {
    // No change dates on these rows (synced before lastUpdatedAt was requested): fall back to what we
    // can say for certain — bookings MADE in the last 30 days that have already cancelled.
    cancelMode = 'made'; cancelDays = 28
    for (const x of curBooked) if (x.day >= trendStart && isCancelled(x.r.status)) cancelList.push(toCancel(x.r, x.day))
    notes.push('cancellation dates are not held for most reservations — showing bookings made in the last 28 days that have since cancelled')
  }
  cancelList.sort((a, b) => b.revenue - a.revenue || (a.daysToArrival ?? 999) - (b.daysToArrival ?? 999))
  const cByCh: Record<string, { name: string; count: number; revenue: number }> = {}
  let cNights = 0, cRev = 0
  for (const c of cancelList) {
    const k = cByCh[c.channel] = cByCh[c.channel] || { name: c.channel, count: 0, revenue: 0 }
    k.count += 1; k.revenue += c.revenue; cNights += c.nights; cRev += c.revenue
  }

  const lastSync = syncRes && syncRes.data && (syncRes.data as any).last_sync_at ? String((syncRes.data as any).last_sync_at) : null

  const report: SalesReport = {
    ok: true,
    generatedAt: new Date(nowMs).toISOString(),
    today, asOfLastYear: asOf, lastSync, showMoney: true,
    sameStoreUnits, activeUnits: active.length,
    periods, channels, directShare, lyDirectShare, days,
    pace: {
      activeUnits: active.length, from: today, to30: shift(today, 29), lyFrom: asOf,
      nights30, nights60,
      sameUnits, sameNights30: sameN30, sameLy30: sameL30, pct30: pctChange(sameN30, sameL30),
      allLy30, allPct30: staysLy.truncated ? null : pctChange(nights30, allLy30),
      sameNights60: sameN60, sameLy60: sameL60, pct60: pctChange(sameN60, sameL60),
      occ30: sellableAll > 0 ? nights30 / sellableAll : 0,
      behind: units.filter(u => u.status === 'behind').length,
      cold: units.filter(u => u.status === 'cold').length,
      ahead: units.filter(u => u.status === 'ahead').length,
      units,
    },
    months,
    cancels: {
      mode: cancelMode, days: cancelDays, count: cancelList.length, nights: cNights, revenue: cRev,
      byChannel: Object.keys(cByCh).map(k => cByCh[k]).sort((a, b) => b.revenue - a.revenue || b.count - a.count),
      list: cancelList.slice(0, 40),
    },
    notes,
  }
  return report
}

const cached = unstable_cache(compute, ['sales-report-v2'], { revalidate: 600, tags: ['revenue', 'sales'] })

/** The sales report for today (Eastern), cached ten minutes. */
export async function buildSalesReport(opts: { fresh?: boolean } = {}): Promise<SalesReport> {
  const today = ymdET()
  return opts.fresh ? compute(today) : cached(today)
}

/**
 * The same report with every dollar figure zeroed, for someone who may open the page but is not
 * cleared for money (lib/access canSeeMoney). Counts, nights and percentages of nights stay; channel
 * shares become shares of bookings. Done on the server so the amounts never reach the browser.
 */
export function withoutMoney(r: SalesReport): SalesReport {
  const side = (s: SalesSide): SalesSide => ({ ...s, revenue: 0, cancelledRevenue: 0 })
  const direct = r.channels.find(c => c.name === 'Direct')
  const anyNow = r.channels.some(c => c.bookings > 0)
  const anyLy = r.channels.some(c => c.lyBookings > 0)
  return {
    ...r,
    showMoney: false,
    periods: r.periods.map(p => ({
      ...p, now: side(p.now), ly: side(p.ly), revenuePct: null,
      sameStore: { ...p.sameStore, now: side(p.sameStore.now), ly: side(p.sameStore.ly), revenuePct: null },
    })),
    channels: r.channels
      .map(c => ({ ...c, revenue: 0, lyRevenue: 0, share: c.bookingShare, lyShare: c.lyBookingShare }))
      .sort((a, b) => b.bookings - a.bookings),
    directShare: anyNow ? (direct ? direct.bookingShare : 0) : null,
    lyDirectShare: anyLy ? (direct ? direct.lyBookingShare : 0) : null,
    days: r.days.map(d => ({ ...d, revenue: 0, lyRevenue: 0 })),
    pace: { ...r.pace, units: r.pace.units.map(u => ({ ...u, revenue30: 0 })) },
    months: r.months.map(m => ({
      ...m, revenue: 0, lySameTime: null, lyFinal: null, budget: null, pctOfBudget: null,
      pctVsLy: m.lyNightsSameTime != null ? pctChange(m.nights, m.lyNightsSameTime) : null,
      ssRevenue: null, ssLySameTime: null,
      ssPctVsLy: m.ssLyNightsSameTime != null ? pctChange(m.ssNights, m.ssLyNightsSameTime) : null,
    })),
    cancels: {
      ...r.cancels, revenue: 0,
      byChannel: r.cancels.byChannel.map(c => ({ ...c, revenue: 0 })).sort((a, b) => b.count - a.count),
      list: r.cancels.list.map(c => ({ ...c, revenue: 0 })),
    },
  }
}
