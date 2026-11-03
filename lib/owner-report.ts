// Owner Report engine — assembles the content JSON for an owner-facing report
// (modeled on the 17 West Weekly Owner Review deck). Pure data assembly from the
// Supabase mirrors (guesty_reservations / guesty_listings / guesty_reviews /
// breezeway_tasks_sync) plus stored owner_budgets. The AI narrative pass lives in
// the generate route; everything here is deterministic math so numbers are auditable.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting } from './app-settings'
import { rollupBuilding } from './optimize-score'
import type { Basis } from './basis'

const CONFIRMED = ['confirmed', 'checked_in', 'checked_out']

// ---------- date helpers (all ET-naive YYYY-MM-DD strings) ----------
export function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function overlapNights(checkIn: string, checkOut: string, from: string, toExcl: string): number {
  if (!checkIn || !checkOut) return 0
  const s = checkIn > from ? checkIn : from
  const e = checkOut < toExcl ? checkOut : toExcl
  const n = daysBetween(s, e)
  return n > 0 ? n : 0
}
function monthStart(iso: string): string { return iso.slice(0, 7) + '-01' }
function monthEndExcl(iso: string): string {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7))
  const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1
  return String(ny) + '-' + String(nm).padStart(2, '0') + '-01'
}
function monthLabel(iso: string): string {
  const d = new Date(iso.slice(0, 7) + '-15T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function monthShort(iso: string): string {
  const d = new Date(iso.slice(0, 7) + '-15T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// ---------- types (content JSON shape) ----------
export type MetricSet = {
  accomRevenue: number; grossRevenue: number; occupiedNights: number; availableNights: number
  occupancyPct: number; adr: number; grossAdr: number; revpar: number; grossRevpar: number
  reservations: number
  // Raw components for the 3-basis model (see lib/basis.ts):
  // accomRevenue      = base accommodation fare (Guesty fareAccommodation, before adjustments)
  // accomGrossRevenue = accommodation the guest paid, before channel fees (netota)
  // channelFees       = channel/OTA host fee (Guesty hostServiceFee); net = accomGross - channelFees
  // cleaningRevenue   = prorated cleaning; gross = accomGrossRevenue + cleaningRevenue
  accomGrossRevenue: number; cleaningRevenue: number; channelFees: number
}
export type ReportListing = { id: string; name: string; unit: string; bedrooms: number | null; building: string }

export type ReportContent = {
  meta: {
    scopeLabel: string; periodStart: string; periodEnd: string; asOf: string
    activeListings: number; daysRemaining: number; generatedAt: string
    /** 'review' (the owner performance report) or 'projection' (the standalone season report).
     *  The Next Season section belongs ONLY to the projection report — see `projection` below. */
    kind?: 'review' | 'projection'
  }
  hero: { eyebrow: string; title: string; headline: string; preparedFor: string; dateLabel: string; heroImage: string | null }
  snapshot: {
    headline: string; subtitle: string
    cards: { key: string; label: string; value: string; sub: string; gross?: string }[]
    ytd: { text: string; stats: { value: string; label: string }[] } | null
    // Raw period metrics so the snapshot can render Revenue/ADR/RevPAR in any basis (see lib/basis.ts).
    metrics?: { accomNum: number; accomGrossNum: number; cleaningNum: number; feeNum?: number; occNights: number; availNights: number; reservations: number; units: number; occPct: number }
  }
  pacing: { headline: string; subtitle: string; rows: { metric: string; ours: string; comps: string; delta: string }[] } | null
  plan: {
    headline: string; subtitle: string
    months: { label: string; status: string; rows: { metric: string; actual: string; budget: string; delta: string; good: boolean }[]; note: string }[]
  } | null
  // Owner statement section, built from the Guesty owner-statement mirror (lib/owner-statements).
  // Figures are the RECOGNISED Owners-ledger basis: `net` is what the owner earned, `paid` is the
  // payout that actually moved. `items` is legacy — reports generated from uploaded PDFs before
  // the mirror existed still carry it, and the renderer falls back to it when there are no kpis.
  statement: {
    headline: string; subtitle: string; scope: string; note: string
    kpis: { label: string; value: string; sub: string }[]
    months: { month: string; label: string; rental: number; commission: number; other: number; net: number; paid: number }[]
    owners: { ownerName: string; rental: number; commission: number; net: number; paid: number; months: number }[]
    totals: {
      rental: number; commission: number; commissionPct: number; other: number
      net: number; paid: number; variance: number
      ownerMonths: number; statements: number; orphans: number; tied: number
    }
    items?: { title: string; summary: string; url: string | null }[]
  } | null
  ahead: {
    headline: string; subtitle: string
    // adr/revpar are the stored (legacy-net) strings; the raw components below let the renderer
    // re-derive them in whichever basis is selected, exactly like snaps and byListing.
    months: {
      label: string; status: string; occPct: number; adr: string; revpar: string; note: string
      accomNum?: number; accomGrossNum?: number; cleaningNum?: number; feeNum?: number
      occNights?: number; availNights?: number
    }[]
    strip: { month: string; occPct: number; mix?: MonthMix | null }[]
  }
  /** Bookings made since the last owner report on these units (any stay month). */
  newBookings?: NewBookings | null
  voices: {
    headline: string; subtitle: string
    quotes: { text: string; guest: string; unit: string; br: string }[]
    themes: { title: string; body: string; action: string }[]
  }
  projects: {
    headline: string; subtitle: string
    weeks: { label: string; groups: { category: string; items: string[] }[] }[]
    tracking: { title: string; body: string }[]
  }
  // Per-calendar-month breakdown for the "view by month" toggle; only set when the period spans 2+ months.
  // Carries the raw basis components so these cards follow the basis picker instead of being frozen
  // to legacy Net — without them the monthly cards silently disagreed with the snapshot above.
  byMonth?: {
    label: string; monthIso: string; revenue: string; grossRevenue: string
    occPct: number; adr: string; grossAdr: string; revpar: string
    accomNum?: number; accomGrossNum?: number; cleaningNum?: number; feeNum?: number
    occNights?: number; availNights?: number
  }[]
  snaps?: { key?: string; label: string; from: string; to: string; revenue: string; grossRevenue: string; occPct: number; adr: string; grossAdr: string; revpar: string; grossRevpar?: string; reservations?: number; units?: number; accomNum?: number; accomGrossNum?: number; cleaningNum?: number; feeNum?: number; occNights?: number; availNights?: number }[]
  byListing?: { id: string; name: string; unit: string; bedrooms: number | null; building?: string; revenue: string; grossRevenue: string; occPct: number; adr: string; grossAdr: string; revpar: string; grossRevpar?: string; reservations: number; revNum: number; accomNum?: number; grossNum?: number; accomGrossNum?: number; cleaningNum?: number; feeNum?: number; occNights?: number; availNights?: number }[]
  // Per-section revenue basis (see lib/basis.ts). default flows to every section unless overridden.
  // Snapshot cards show a big primary number with a secondary number beneath ('none' hides it).
  basis?: { default?: Basis; snapshotPrimary?: Basis; snapshotSecondary?: Basis | 'none'; snaps?: Basis; byListing?: Basis; byMonth?: Basis; ahead?: Basis }
  // NEXT SEASON PROJECTION — THE STANDALONE PROJECTION REPORT ONLY (Jon, 2026-09-08: "the
  // projection part in the owner report is terrible. remove that"). It rode along on every owner
  // REVIEW report as a "Next Season" section: a wide month-by-unit grid of modelled numbers
  // pinned under a report whose whole promise is what actually happened. Owners read the two as
  // the same kind of fact, and a projection that misses becomes the thing they remember.
  //
  // So the review report no longer carries it. The section still powers the dedicated season
  // projection report (kind 'projection'), where a forecast is the point and is labelled as one —
  // that report sets meta.kind and is the only thing that renders this.
  projection?: {
    headline: string; subtitle: string
    monthLabels: string[]
    units: { name: string; months: number[]; total: number; health?: number; band?: string; rating?: number | null }[]
    byMonth: number[]
    total: number; nights: number; mgmtPct: number
    upsides?: { unit: string; text: string; adrPct: number }[]
    note: string
  } | null
  // Listing ids blocked/off-market for the period — dropped from revenue and the occupancy denominator.
  excludeListings?: string[]
  // Legacy (pre-basis) flag; superseded by `basis` above. Kept so old reports still parse.
  showGross?: boolean
  omit: string[]
}

// ---------- scope resolution ----------
export async function resolveScope(listingIds: string[], buildings: string[]): Promise<{ listings: ReportListing[]; scopeLabel: string }> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_listings')
    .select('id, title, nickname, building, unit, bedrooms, status')
    .limit(1000) // deliberate cap: one row per listing, ~290 in the portfolio
  const all = (data || []) as any[]
  const wantIds = new Set(listingIds.map(String))
  const wantBuildings = buildings.map(b => b.toLowerCase())
  const picked: ReportListing[] = []
  for (const l of all) {
    const st = String(l.status || '').toLowerCase()
    if (['inactive', 'disabled', 'archived', 'deleted'].indexOf(st) >= 0) continue
    const roll = rollupBuilding(String(l.building || '').trim())
    const inIds = wantIds.has(String(l.id))
    const inBld = wantBuildings.length > 0 && wantBuildings.indexOf(roll.toLowerCase()) >= 0
    if (!inIds && !inBld) continue
    const name = String(l.nickname || l.title || l.id)
    if (/\bfull\b/i.test(name)) continue
    picked.push({ id: String(l.id), name, unit: String(l.unit || ''), bedrooms: l.bedrooms ?? null, building: roll })
  }
  const bldSet: string[] = []
  for (const p of picked) if (bldSet.indexOf(p.building) < 0) bldSet.push(p.building)
  const scopeLabel = bldSet.length === 1 ? bldSet[0] : (bldSet.length ? bldSet.join(' + ') : 'Portfolio')
  return { listings: picked, scopeLabel }
}

// ---------- reservations pull + metrics ----------
// fare = fareAccommodation (the BASE accommodation fare, before booking alterations/adjustments).
// grossFare = fareAccommodationAdjusted (accommodation the guest actually paid, after alterations).
//   Verified against Guesty data: the gap between these two is the price ADJUSTMENT, not the OTA
//   fee — it runs in both directions and is non-zero on channels with hostServiceFee = 0.
// fee = hostServiceFee (the channel's host-side commission). Net = grossFare - fee.
//   Do NOT use Guesty's own `netIncome` field: on Airbnb rows it subtracts hostServiceFee twice
//   (netIncome = fareAccommodationAdjusted - 2 x hostServiceFee), which understates owner net.
type Resv = { listing_id: string; check_in: string; check_out: string; nights: number; fare: number; grossFare: number; fee: number; cleaning: number; source: string; created_at: string | null }
// Expedia-family channels bundle the cleaning fee into accommodation, so ~1/3 arrive with cleaning=0.
const EXPEDIA_RE = /expedia|hotels\.com|orbitz|egencia|travelocity/

export async function pullReservations(listingIds: string[], from: string, toExcl: string): Promise<Resv[]> {
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 20; i++) {
    const { data } = await db
      .from('guesty_reservations')
      .select('listing_id, check_in, check_out, nights, status, source, created_at, cleaning:raw->money->>fareCleaning, fare:raw->money->>fareAccommodation, grossFare:raw->money->>fareAccommodationAdjusted, fee:raw->money->>hostServiceFee')
      .in('status', CONFIRMED)
      .in('listing_id', listingIds)
      .gt('check_out', from)
      .lt('check_in', toExcl)
      // ORDERED PAGING (2026-09-03): PostgREST ranges over an unordered set are not stable —
      // a window past 1,000 rows could repeat or skip stays. These are the numbers an owner reads.
      .order('id')
      .range(i * 1000, i * 1000 + 999)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  const list: Resv[] = all
    .filter((r: any) => r.check_in && r.check_out)
    .map((r: any) => ({
      listing_id: String(r.listing_id || ''),
      check_in: String(r.check_in), check_out: String(r.check_out),
      nights: Math.max(1, num(r.nights) || daysBetween(String(r.check_in), String(r.check_out))),
      fare: num(r.fare), grossFare: num(r.grossFare), fee: Math.max(0, num(r.fee)), cleaning: num(r.cleaning),
      source: String(r.source || '').toLowerCase(),
      created_at: r.created_at ? String(r.created_at).slice(0, 10) : null,
    }))

  // Expedia cleaning back-fill: Expedia-family channels bundle the cleaning fee into the
  // accommodation fare (so it arrives as cleaning=0). Rebuild each unit's typical cleaning fee
  // from its NON-Expedia bookings (the modal value), then split it out of those bundled fares so
  // Net (accommodation) and Gross line up with the other channels. Gross total is unchanged.
  const pool: Record<string, Record<string, number>> = {}
  for (const r of list) {
    if (!EXPEDIA_RE.test(r.source) && r.cleaning > 0) {
      const key = String(Math.round(r.cleaning))
      ;(pool[r.listing_id] = pool[r.listing_id] || {})[key] = (pool[r.listing_id]?.[key] || 0) + 1
    }
  }
  const modal: Record<string, number> = {}
  for (const id in pool) {
    let best = 0, bestN = 0
    for (const k in pool[id]) { if (pool[id][k] > bestN) { bestN = pool[id][k]; best = Number(k) } }
    modal[id] = best
  }
  for (const r of list) {
    if (EXPEDIA_RE.test(r.source) && r.cleaning === 0 && modal[r.listing_id] > 0) {
      const m = Math.min(modal[r.listing_id], r.fare)
      r.cleaning = m
      r.fare = r.fare - m
      r.grossFare = Math.max(0, r.grossFare - m) // cleaning is bundled into the gross fare too
    }
  }
  return list
}

// Per-night proration: a stay contributes fare/nights for each night inside the window,
// so month boundaries and partial ranges attribute revenue correctly. Cleaning fees are
// whole-stay and attributed when the CHECKOUT falls inside the window.
export function metricsFor(resv: Resv[], units: number, from: string, toExcl: string): MetricSet {
  let accom = 0, grossAccom = 0, cleaning = 0, fees = 0, occNights = 0, resCount = 0
  for (const r of resv) {
    const on = overlapNights(r.check_in, r.check_out, from, toExcl)
    if (on <= 0) continue
    resCount++
    occNights += on
    accom += (r.fare / r.nights) * on
    // Gross accommodation = room revenue BEFORE the OTA host fee (guest-paid). Use the larger of the
    // net fare and the adjusted (gross) fare so Gross is always ≥ Net even on channels that pass the
    // OTA fee to the guest (VRBO/direct), where the "adjusted" value can dip below the net fare.
    grossAccom += (Math.max(r.fare, r.grossFare) / r.nights) * on
    fees += (r.fee / r.nights) * on // channel host fee, prorated the same way as the fare it came off
    cleaning += (r.cleaning / r.nights) * on // prorate cleaning by night-fraction (matches 17W methodology)
  }
  const days = daysBetween(from, toExcl)
  const avail = Math.max(0, units * days)
  const gross = grossAccom + cleaning // accommodation (gross of OTA fees) + cleaning
  return {
    accomRevenue: Math.round(accom), grossRevenue: Math.round(gross),
    accomGrossRevenue: Math.round(grossAccom), cleaningRevenue: Math.round(cleaning),
    channelFees: Math.round(fees),
    occupiedNights: occNights, availableNights: avail,
    occupancyPct: avail > 0 ? Math.round((occNights / avail) * 100) : 0,
    adr: occNights > 0 ? Math.round(accom / occNights) : 0,
    grossAdr: occNights > 0 ? Math.round(gross / occNights) : 0,
    revpar: avail > 0 ? Math.round(accom / avail) : 0,
    grossRevpar: avail > 0 ? Math.round(gross / avail) : 0,
    reservations: resCount,
  }
}

export function fmtK(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'K'
  return '$' + Math.round(n).toLocaleString()
}

// ---------- YTD ----------
export async function ytdStats(listingIds: string[], asOf: string, units: number) {
  const jan1 = asOf.slice(0, 4) + '-01-01'
  const toExcl = addDays(asOf, 1)
  const resv = await pullReservations(listingIds, jan1, toExcl)
  const m = metricsFor(resv, units, jan1, toExcl)
  let stayNights = 0, windows = 0, windowCount = 0
  for (const r of resv) {
    stayNights += r.nights
    if (r.created_at && r.created_at <= r.check_in) {
      windows += daysBetween(r.created_at, r.check_in)
      windowCount++
    }
  }
  const avgStay = resv.length ? Math.round((stayNights / resv.length) * 100) / 100 : 0
  const avgWindow = windowCount ? Math.round((windows / windowCount) * 100) / 100 : 0
  return { reservations: resv.length, avgStay, avgWindow, occupancyPct: m.occupancyPct }
}

// ---------- the month's booking mix (Jon, 2026-11-03: "unit types booked, weekdays vs weekends,
// important dates … in the hover") ----------
export type MonthMix = {
  types: { label: string; units: number; nights: number; avail: number; pct: number }[]
  weekday: { nights: number; avail: number; pct: number }
  weekend: { nights: number; avail: number; pct: number }
  dates: { label: string; date: string; booked: number; units: number }[]
}
const nth = (y: number, m: number, dow: number, n: number) => { const d = new Date(Date.UTC(y, m, 1)); const shift = (dow - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + shift + (n - 1) * 7)).toISOString().slice(0, 10) }
const lastDow = (y: number, m: number, dow: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); const back = (d.getUTCDay() - dow + 7) % 7; return new Date(Date.UTC(y, m + 1, -back)).toISOString().slice(0, 10) }
/** The nights that matter in a year: holidays (computed, so always right) and their long weekends. */
export function keyDates(year: number): { date: string; label: string }[] {
  const ymd = (m: number, d: number) => year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
  const tg = nth(year, 10, 4, 4)
  return [
    { date: ymd(1, 1), label: "New Year's Day" }, { date: nth(year, 0, 1, 3), label: 'MLK Day' },
    { date: ymd(2, 14), label: "Valentine's Day" }, { date: nth(year, 1, 1, 3), label: "Presidents' Day" },
    { date: lastDow(year, 4, 1), label: 'Memorial Day' }, { date: ymd(7, 4), label: 'July 4th' },
    { date: nth(year, 8, 1, 1), label: 'Labor Day' }, { date: nth(year, 9, 1, 2), label: 'Columbus Day' },
    { date: ymd(10, 31), label: 'Halloween' }, { date: ymd(11, 11), label: 'Veterans Day' },
    { date: addDays(tg, -1), label: 'Thanksgiving Eve' }, { date: tg, label: 'Thanksgiving' }, { date: addDays(tg, 2), label: 'Thanksgiving Saturday' },
    { date: ymd(12, 24), label: 'Christmas Eve' }, { date: ymd(12, 25), label: 'Christmas' }, { date: ymd(12, 31), label: "New Year's Eve" },
  ]
}
function mixFor(resv: Resv[], beds: Record<string, number | null>, listingIds: string[], from: string, toExcl: string, extraDates: { date: string; label: string }[]): MonthMix {
  const typeOf = (b: number | null | undefined) => b == null ? 'Other' : b <= 0 ? 'Studio' : b >= 4 ? '4BR+' : b + 'BR'
  const unitsByType: Record<string, number> = {}
  for (const id of listingIds) { const k = typeOf(beds[id]); unitsByType[k] = (unitsByType[k] || 0) + 1 }
  const nightsByType: Record<string, number> = {}
  let wkN = 0, weN = 0
  const bookedOn: Record<string, Set<string>> = {}
  for (const r of resv) {
    let d = r.check_in < from ? from : r.check_in
    const end = r.check_out > toExcl ? toExcl : r.check_out
    const k = typeOf(beds[r.listing_id])
    while (d < end) {
      nightsByType[k] = (nightsByType[k] || 0) + 1
      const dow = new Date(d + 'T12:00:00Z').getUTCDay()
      if (dow === 5 || dow === 6) weN++; else wkN++      // Friday and Saturday nights are the weekend
      ;(bookedOn[d] = bookedOn[d] || new Set()).add(r.listing_id)
      d = addDays(d, 1)
    }
  }
  let wkDays = 0, weDays = 0
  for (let d = from; d < toExcl; d = addDays(d, 1)) { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); if (dow === 5 || dow === 6) weDays++; else wkDays++ }
  const n = listingIds.length || 1
  const pct = (a: number, b: number) => b > 0 ? Math.round(a / b * 100) : 0
  const order = ['Studio', '1BR', '2BR', '3BR', '4BR+', 'Other']
  const days = daysBetween(from, toExcl)
  const types = Object.keys(unitsByType).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(label => {
    const avail = unitsByType[label] * days, nights = nightsByType[label] || 0
    return { label, units: unitsByType[label], nights, avail, pct: pct(nights, avail) }
  })
  const year = Number(from.slice(0, 4))
  const dates = keyDates(year).concat(extraDates).filter(x => x.date >= from && x.date < toExcl).sort((a, b) => a.date.localeCompare(b.date))
    .map(x => ({ label: x.label, date: x.date, booked: bookedOn[x.date] ? bookedOn[x.date].size : 0, units: listingIds.length }))
  return { types, weekday: { nights: wkN, avail: wkDays * n, pct: pct(wkN, wkDays * n) }, weekend: { nights: weN, avail: weDays * n, pct: pct(weN, weDays * n) }, dates }
}

// ---------- bookings since the last owner report (Jon, 2026-11-03) ----------
export type NewBookings = {
  since: string; sinceLabel: string; asOf: string
  count: number; nights: number; revenue: number; adr: number; avgLead: number; avgStay: number
  byMonth: { iso: string; label: string; count: number; nights: number; revenue: number }[]
  byChannel: { channel: string; count: number; revenue: number }[]
  top: { unit: string; checkIn: string; checkOut: string; nights: number; revenue: number; channel: string; booked: string }[]
}
const CHANNEL_NAME = (s: string) => /airbnb/.test(s) ? 'Airbnb' : /booking/.test(s) ? 'Booking.com' : /vrbo|homeaway/.test(s) ? 'Vrbo' : /expedia|hotels\.com/.test(s) ? 'Expedia' : /direct|website|manual|owner/.test(s) ? 'Direct' : s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other'
export async function bookingsSince(listingIds: string[], since: string, asOf: string, names: Record<string, string>): Promise<NewBookings | null> {
  if (!listingIds.length) return null
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 10; i++) {
    const { data } = await db.from('guesty_reservations')
      .select('id, listing_id, check_in, check_out, nights, status, source, created_at, grossFare:raw->money->>fareAccommodationAdjusted, fare:raw->money->>fareAccommodation')
      .in('status', CONFIRMED).in('listing_id', listingIds)
      .gte('created_at', since + 'T00:00:00').lte('created_at', asOf + 'T23:59:59')
      .order('id').range(i * 1000, i * 1000 + 999)
    if (!data || !data.length) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  const rows = all.filter(r => r.check_in && r.check_out).map(r => {
    const nights = Math.max(1, num(r.nights) || daysBetween(String(r.check_in).slice(0, 10), String(r.check_out).slice(0, 10)))
    return { unit: names[String(r.listing_id)] || 'Unit', checkIn: String(r.check_in).slice(0, 10), checkOut: String(r.check_out).slice(0, 10), nights,
      revenue: Math.round((num(r.grossFare) || num(r.fare)) * 100) / 100, channel: CHANNEL_NAME(String(r.source || '').toLowerCase()), booked: String(r.created_at).slice(0, 10) }
  })
  const count = rows.length, nights = rows.reduce((a, r) => a + r.nights, 0), revenue = Math.round(rows.reduce((a, r) => a + r.revenue, 0))
  const leads = rows.map(r => daysBetween(r.booked, r.checkIn)).filter(d => d >= 0)
  const bm: Record<string, { iso: string; label: string; count: number; nights: number; revenue: number }> = {}
  for (const r of rows) { const iso = monthStart(r.checkIn); const x = bm[iso] = bm[iso] || { iso, label: monthLabel(iso), count: 0, nights: 0, revenue: 0 }; x.count++; x.nights += r.nights; x.revenue += r.revenue }
  const bc: Record<string, { channel: string; count: number; revenue: number }> = {}
  for (const r of rows) { const x = bc[r.channel] = bc[r.channel] || { channel: r.channel, count: 0, revenue: 0 }; x.count++; x.revenue += r.revenue }
  return {
    since, sinceLabel: monthLabel(since).replace(/\s+\d{4}$/, '') + ' ' + Number(since.slice(8, 10)), asOf,
    count, nights, revenue, adr: nights ? Math.round(revenue / nights) : 0,
    avgLead: leads.length ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length) : 0,
    avgStay: count ? Math.round(nights / count * 10) / 10 : 0,
    byMonth: Object.values(bm).sort((a, b) => a.iso.localeCompare(b.iso)).map(x => ({ ...x, revenue: Math.round(x.revenue) })),
    byChannel: Object.values(bc).sort((a, b) => b.revenue - a.revenue).map(x => ({ ...x, revenue: Math.round(x.revenue) })),
    top: rows.sort((a, b) => b.revenue - a.revenue).slice(0, 5),
  }
}
/** When the last owner report for these units was dated — the "since" line. */
export async function lastReportDate(listingIds: string[], scopeLabel: string, asOf: string): Promise<string | null> {
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('owner_reports').select('as_of, scope_label, listing_ids').lt('as_of', asOf).order('as_of', { ascending: false }).limit(200)
    const want = new Set(listingIds)
    const hit = ((data || []) as any[]).find(r => String(r.scope_label || '') === scopeLabel || (Array.isArray(r.listing_ids) && r.listing_ids.some((x: any) => want.has(String(x)))))
    return hit ? String(hit.as_of).slice(0, 10) : null
  } catch { return null }
}

// ---------- months-ahead (OTB by stay month) ----------
export async function monthsAhead(listingIds: string[], asOf: string, units: number, count: number) {
  const first = monthStart(asOf)
  const months: { iso: string; label: string; short: string; m: MetricSet; mix?: MonthMix }[] = []
  // one pull covering the whole horizon
  let horizonEnd = first
  for (let i = 0; i < count; i++) horizonEnd = monthEndExcl(horizonEnd)
  const prevStart = monthStart(addDays(first, -1)) // include the just-closed month for the strip
  const resv = await pullReservations(listingIds, prevStart, horizonEnd)
  const beds: Record<string, number | null> = {}
  try {
    const { data: ls } = await supabaseAdmin().from('guesty_listings').select('id, bedrooms').in('id', listingIds)
    for (const l of (ls || []) as any[]) beds[String(l.id)] = l.bedrooms == null ? null : Number(l.bedrooms)
  } catch { /* types read as Other */ }
  let extra: { date: string; label: string }[] = []
  try { const v = await getSetting<any>('owner_report_dates', null); if (Array.isArray(v?.dates)) extra = v.dates.filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date)) && x?.label).map((x: any) => ({ date: String(x.date), label: String(x.label).slice(0, 40) })) } catch { /* holidays only */ }
  let cur = prevStart
  for (let i = 0; i < count + 1; i++) {
    const end = monthEndExcl(cur)
    let mix: MonthMix | undefined
    try { mix = mixFor(resv, beds, listingIds, cur, end, extra) } catch { mix = undefined }
    months.push({ iso: cur, label: monthLabel(cur), short: monthShort(cur), m: metricsFor(resv, units, cur, end), mix })
    cur = end
  }
  return months // [prev month, current, +1, ...]
}

// ---------- budgets ----------
export type BudgetRow = { building_key: string; year: number; month: number; occupancy_pct: number | null; adr: number | null; revpar: number | null; gross_revenue: number | null }

export async function pullBudgets(buildings: string[], monthIsos: string[]): Promise<Record<string, BudgetRow>> {
  const db = supabaseAdmin()
  if (!buildings.length || !monthIsos.length) return {}
  const { data } = await db.from('owner_budgets').select('*').in('building_key', buildings)
  const out: Record<string, BudgetRow> = {}
  for (const r of (data || []) as any[]) {
    const iso = String(r.year) + '-' + String(r.month).padStart(2, '0') + '-01'
    if (monthIsos.indexOf(iso) >= 0) out[iso] = r as BudgetRow
  }
  return out
}

// ---------- reviews ----------
export type ReviewRow = { rating: number | null; content: string; guest_name: string | null; listing_id: string | null; created_at: string | null; channel: string | null }

export async function pullReviews(listingIds: string[], from: string, asOf: string): Promise<ReviewRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_reviews')
    .select('rating, content, guest_name, listing_id, created_at, channel')
    .in('listing_id', listingIds)
    .is('removed_at', null)
    .gte('created_at', from + 'T00:00:00Z')
    .lte('created_at', asOf + 'T23:59:59Z')
    .order('created_at', { ascending: false })
    .limit(200)
  return ((data || []) as any[]).map(r => ({
    rating: r.rating != null ? Number(r.rating) : null,
    content: String(r.content || ''),
    guest_name: r.guest_name ? String(r.guest_name) : null,
    listing_id: r.listing_id ? String(r.listing_id) : null,
    created_at: r.created_at ? String(r.created_at) : null,
    channel: r.channel ? String(r.channel) : null,
  }))
}

// ---------- breezeway tasks ----------
export type TaskRow = { name: string; department: string | null; status: string | null; date: string; assignee: string | null; unit: string }

export async function pullTasks(listingIds: string[], listingById: Record<string, ReportListing>, from: string, to: string): Promise<{ completed: TaskRow[]; open: TaskRow[] }> {
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 10; i++) {
    const { data } = await db
      .from('breezeway_tasks_sync')
      .select('name, type_department, status, scheduled_date, finished_at, assignee_name, reference_property_id')
      .in('reference_property_id', listingIds)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .order('id')
      .range(i * 1000, i * 1000 + 999)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  const completed: TaskRow[] = []
  const open: TaskRow[] = []
  for (const t of all) {
    const st = String(t.status || '').toLowerCase()
    const lid = String(t.reference_property_id || '')
    const unit = listingById[lid] ? (listingById[lid].unit || listingById[lid].name) : ''
    const row: TaskRow = {
      name: String(t.name || ''), department: t.type_department ? String(t.type_department) : null,
      status: st || null, date: String(t.scheduled_date || '').slice(0, 10),
      assignee: t.assignee_name ? String(t.assignee_name) : null, unit,
    }
    if (!row.name) continue
    if (st === 'done' || st === 'completed' || st === 'finished' || !!t.finished_at) completed.push(row)
    else open.push(row)
  }
  return { completed, open }
}

export function weekBuckets(from: string, to: string): { start: string; endIncl: string; label: string }[] {
  // Split the period into up to 3 trailing 7-day buckets ending at `to` (deck shows "last three weeks").
  const buckets: { start: string; endIncl: string; label: string }[] = []
  let end = to
  for (let i = 0; i < 3; i++) {
    const start = addDays(end, -6)
    const s = start < from ? from : start
    const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase()
    buckets.unshift({ start: s, endIncl: end, label: fmt(s) + ' – ' + fmt(end) })
    if (s <= from) break
    end = addDays(s, -1)
  }
  return buckets
}

export function makeCode(): string {
  const c: any = (globalThis as any).crypto
  const uuid = c && c.randomUUID ? c.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
  return String(uuid).replace(/-/g, '').slice(0, 16)
}

// ---------- Performance vs Plan (the budget slide) ----------
// ONE BUILDER, TWO CALLERS (2026-10-27). This was inline in /api/reports/generate, which meant the
// only way to get the budget slide was to mint a whole new report. Jon deleted a month from a live
// 17 West report by hand and there was nothing to put it back with. Now the generator and the
// per-slide Refresh both derive the section from owner_budgets + the reservation mirror through
// here, so a refreshed slide and a freshly generated one can never disagree.
//
// Returns null when the scope has no budget rows — the section simply does not render then.
export async function planSectionFor(
  listingIds: string[], buildings: string[], asOf: string, units: number,
  mAheadIn?: { iso: string; label: string; short: string; m: MetricSet }[],
): Promise<ReportContent['plan']> {
  const mAhead = (mAheadIn && mAheadIn.length) ? mAheadIn : await monthsAhead(listingIds, asOf, units, 6)
  if (!mAhead.length) return null

  // The deck shows the two closed months, the month in progress, and next month's pace.
  const prevPrev = monthStart(addDays(mAhead[0].iso, -1))
  const wantIsos = [prevPrev].concat(mAhead.slice(0, 3).map(m => m.iso))
  const budgets = await pullBudgets(buildings, wantIsos)
  if (!Object.keys(budgets).length) return null

  const candidates: { iso: string; endExcl: string; pacing?: boolean }[] = [{ iso: prevPrev, endExcl: mAhead[0].iso }]
  candidates.push({ iso: mAhead[0].iso, endExcl: mAhead[1] ? mAhead[1].iso : monthEndExcl(mAhead[0].iso) })
  if (mAhead[1]) candidates.push({ iso: mAhead[1].iso, endExcl: mAhead[2] ? mAhead[2].iso : monthEndExcl(mAhead[1].iso) })
  // Forward "PACING" card: next month's on-the-books pace against its budget.
  if (mAhead[2]) candidates.push({ iso: mAhead[2].iso, endExcl: mAhead[3] ? mAhead[3].iso : monthEndExcl(mAhead[2].iso), pacing: true })

  const monthsOut: NonNullable<ReportContent['plan']>['months'] = []
  for (const c of candidates) {
    const b = budgets[c.iso]
    if (!b) continue
    const mresv = await pullReservations(listingIds, c.iso, c.endExcl)
    const mm = metricsFor(mresv, units, c.iso, c.endExcl)
    const inMonth = asOf >= c.iso && asOf < c.endExcl
    const rows: NonNullable<ReportContent['plan']>['months'][number]['rows'] = []
    if (b.occupancy_pct != null) {
      const d = mm.occupancyPct - Number(b.occupancy_pct)
      rows.push({ metric: 'Occupancy', actual: mm.occupancyPct + '%', budget: 'vs ' + Math.round(Number(b.occupancy_pct)) + '%', delta: (d >= 0 ? '+' : '−') + Math.abs(Math.round(d)) + ' pts', good: d >= 0 })
    }
    if (b.adr != null) {
      const d = mm.grossAdr - Number(b.adr)
      rows.push({ metric: 'ADR', actual: '$' + mm.grossAdr, budget: 'vs $' + Math.round(Number(b.adr)), delta: (d >= 0 ? '+$' : '−$') + Math.abs(Math.round(d)), good: d >= 0 })
    }
    if (b.revpar != null) {
      const d = mm.grossRevpar - Number(b.revpar)
      rows.push({ metric: 'RevPAR', actual: '$' + mm.grossRevpar, budget: 'vs $' + Math.round(Number(b.revpar)), delta: (d >= 0 ? '+$' : '−$') + Math.abs(Math.round(d)), good: d >= 0 })
    }
    if (b.gross_revenue != null) {
      const d = mm.grossRevenue - Number(b.gross_revenue)
      rows.push({ metric: 'Gross Rev', actual: fmtK(mm.grossRevenue), budget: 'vs ' + fmtK(Number(b.gross_revenue)), delta: (d >= 0 ? '+' : '−') + fmtK(Math.abs(Math.round(d))), good: d >= 0 })
    }
    if (!rows.length) continue
    const mLabel = new Date(c.iso.slice(0, 7) + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase()
    monthsOut.push({
      label: mLabel,
      status: inMonth ? 'IN MONTH' : (c.pacing ? 'PACING' : 'CLOSED'),
      rows,
      note: c.pacing ? 'On the books so far — these numbers build as the month fills in.' : '',
    })
  }
  if (!monthsOut.length) return null
  return { headline: 'Tracking against the ' + asOf.slice(0, 4) + ' budget.', subtitle: '', months: monthsOut }
}
