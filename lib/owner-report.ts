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
import { isOwnerOrFriendsFamily } from './owner-audit'

// ---------- ENGINE VERSION (2026-11-09, pass 3) ----------
// A report's numbers are computed under the engine it was GENERATED with, forever. The engine is
// saved on the report as content.meta.engine; a report with no engine on it is engine 1 and every
// recompute on it (refresh a slide, change the period, the per-unit table) keeps engine-1 maths,
// so a link an owner already holds never moves because the method changed underneath it.
//
// Engine 2 (Jon approved, 2026-11-09):
//   · no-rate owner / friends-and-family nights leave BOTH occupied and available nights — ADR is
//     the paid rate, occupancy is the share of SELLABLE nights;
//   · a unit counts toward available nights only from its first live date, when one is known;
//   · a partial-building scope is measured against the building revenue budget pro-rated by units.
export const REPORT_ENGINE = 2
/** How to compute. Omitted (or engine < 2) = the original method, exactly. */
export type CalcOpts = {
  engine?: number
  /** The scope's listings — carries each unit's first live date for the availability denominator. */
  listings?: { id: string; liveFrom?: string | null; building?: string }[]
}
/** The engine a stored report was generated under (1 when it predates the flag). */
export function engineOf(content: any): number {
  const n = Number(content?.meta?.engine)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}
const v2 = (o?: CalcOpts) => !!o && Number(o.engine) >= 2

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

// ---------- ET clock helpers for TIMESTAMPS (2026-11-09 audit) ----------
// Stay dates are ET-naive strings, but `created_at` is a UTC timestamp. Slicing it to ten
// characters gives the UTC day, so a booking made at 9pm in Miami was dated tomorrow: it fell
// outside "as of today", and landed in the next report's "bookings since" instead of this one.
const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
/** The ET calendar day (YYYY-MM-DD) a timestamp falls on; null when it is not a date. */
function etDayOf(ts: unknown): string | null {
  if (!ts) return null
  const d = new Date(String(ts))
  return Number.isNaN(d.getTime()) ? null : ET_DAY.format(d)
}
/** The UTC instant at which an ET calendar day begins (DST-aware: 04:00Z or 05:00Z). */
function etDayStartUtc(iso: string): string {
  const noonUtc = new Date(iso + 'T12:00:00Z')
  const hourEt = Number(ET_HOUR.format(noonUtc)) // 8 in summer, 7 in winter
  const offset = Number.isFinite(hourEt) ? 12 - hourEt : 5
  return new Date(Date.parse(iso + 'T00:00:00Z') + offset * 3_600_000).toISOString()
}

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
  /** Occupied nights that were OWNER stays with no rate (Guesty source starting "owner", fare 0). They are inside
   *  occupiedNights — so occupancy counts them and a $0 owner night pulls ADR down — and are
   *  carried separately so the report can say so instead of leaving a low ADR unexplained. */
  ownerNights?: number
  /** Engine 2 only: no-rate owner / friends-and-family nights taken OUT of occupied and available. */
  excludedNights?: number
}
export type ReportListing = { id: string; name: string; unit: string; bedrooms: number | null; building: string
  /** The ET day Guesty created the listing — the earliest it can have been sellable. Null when unknown. */
  liveFrom?: string | null }

export type ReportContent = {
  meta: {
    scopeLabel: string; periodStart: string; periodEnd: string; asOf: string
    activeListings: number; daysRemaining: number; generatedAt: string
    /** Calculation engine this report was generated under — see REPORT_ENGINE. Absent = 1. */
    engine?: number
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
    .select('id, title, nickname, building, unit, bedrooms, status, createdAt:raw->>createdAt')
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
    picked.push({ id: String(l.id), name, unit: String(l.unit || ''), bedrooms: l.bedrooms ?? null, building: roll, liveFrom: etDayOf(l.createdAt) })
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
type Resv = { listing_id: string; check_in: string; check_out: string; nights: number; fare: number; grossFare: number; fee: number; cleaning: number; source: string; created_at: string | null; owner: boolean
  /** An owner or friends-and-family stay that carries no accommodation rate (engine 2 excludes these nights). */
  noRate: boolean }
// An owner's own stay — the day sheet's rule, used app-wide: the Guesty source starts with "owner".
const OWNER_SRC = /^owner/
// Expedia-family channels bundle the cleaning fee into accommodation, so ~1/3 arrive with cleaning=0.
const EXPEDIA_RE = /expedia|hotels\.com|orbitz|egencia|travelocity/

export async function pullReservations(listingIds: string[], from: string, toExcl: string): Promise<Resv[]> {
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 20; i++) {
    const { data } = await db
      .from('guesty_reservations')
      .select('listing_id, check_in, check_out, nights, status, source, guest_name, created_at, tags:raw->tags, cleaning:raw->money->>fareCleaning, fare:raw->money->>fareAccommodation, grossFare:raw->money->>fareAccommodationAdjusted, fee:raw->money->>hostServiceFee')
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
    .map((r: any) => {
      const fare = num(r.fare), grossFare = num(r.grossFare)
      const tagBlob = Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)).join(' ') : ''
      return {
        listing_id: String(r.listing_id || ''),
        check_in: String(r.check_in), check_out: String(r.check_out),
        nights: Math.max(1, num(r.nights) || daysBetween(String(r.check_in), String(r.check_out))),
        fare, grossFare, fee: Math.max(0, num(r.fee)), cleaning: num(r.cleaning),
        source: String(r.source || '').toLowerCase(),
        // The ET day the booking was made (not the UTC one — see etDayOf).
        created_at: etDayOf(r.created_at),
        owner: OWNER_SRC.test(String(r.source || '').trim().toLowerCase()),
        // The app-wide owner / F&F test (lib/owner-audit), and only when the stay carries no rate:
        // an owner's PAID booking is revenue like any other and stays in.
        noRate: fare <= 0 && grossFare <= 0 && isOwnerOrFriendsFamily(String(r.source || ''), tagBlob, String(r.guest_name || '')),
      }
    })

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
export function metricsFor(resv: Resv[], units: number, from: string, toExcl: string, opts?: CalcOpts): MetricSet {
  const e2 = v2(opts)
  let accom = 0, grossAccom = 0, cleaning = 0, fees = 0, occNights = 0, resCount = 0, ownerNights = 0, excluded = 0
  // Engine 2: the earliest night each unit is seen occupied in what we were handed. A unit with a
  // stay before its recorded creation date was plainly live by then, so the stay wins.
  const firstSeen: Record<string, string> = {}
  for (const r of resv) {
    if (e2 && (!firstSeen[r.listing_id] || r.check_in < firstSeen[r.listing_id])) firstSeen[r.listing_id] = r.check_in
    const on = overlapNights(r.check_in, r.check_out, from, toExcl)
    if (on <= 0) continue
    if (e2 && r.noRate) { excluded += on; continue } // not sold and not for sale: out of both sides
    resCount++
    occNights += on
    if (r.owner && r.fare <= 0 && r.grossFare <= 0) ownerNights += on // owner nights that carry no rate
    accom += (r.fare / r.nights) * on
    // Gross accommodation = room revenue BEFORE the OTA host fee (guest-paid). Use the larger of the
    // net fare and the adjusted (gross) fare so Gross is always ≥ Net even on channels that pass the
    // OTA fee to the guest (VRBO/direct), where the "adjusted" value can dip below the net fare.
    grossAccom += (Math.max(r.fare, r.grossFare) / r.nights) * on
    fees += (r.fee / r.nights) * on // channel host fee, prorated the same way as the fare it came off
    cleaning += (r.cleaning / r.nights) * on // prorate cleaning by night-fraction (matches 17W methodology)
  }
  const days = daysBetween(from, toExcl)
  let avail = Math.max(0, units * days)
  if (e2) {
    // AVAILABLE = SELLABLE. Each unit counts from its first live date (when one is known and falls
    // inside the window — otherwise the whole window, as before), then the excluded nights come off.
    if (opts && opts.listings && opts.listings.length) {
      avail = 0
      for (const l of opts.listings) {
        let live = l.liveFrom && /^\d{4}-\d{2}-\d{2}$/.test(l.liveFrom) ? l.liveFrom : ''
        const seen = firstSeen[l.id]
        if (live && seen && seen < live) live = seen
        const start = live && live > from ? live : from
        avail += Math.max(0, daysBetween(start, toExcl))
      }
    }
    avail = Math.max(occNights, avail - excluded)
  }
  const gross = grossAccom + cleaning // accommodation (gross of OTA fees) + cleaning
  return {
    accomRevenue: Math.round(accom), grossRevenue: Math.round(gross),
    accomGrossRevenue: Math.round(grossAccom), cleaningRevenue: Math.round(cleaning),
    channelFees: Math.round(fees),
    ownerNights: e2 ? 0 : ownerNights,
    excludedNights: e2 ? excluded : 0,
    occupiedNights: occNights, availableNights: avail,
    occupancyPct: avail > 0 ? Math.round((occNights / avail) * 100) : 0,
    adr: occNights > 0 ? Math.round(accom / occNights) : 0,
    grossAdr: occNights > 0 ? Math.round(gross / occNights) : 0,
    revpar: avail > 0 ? Math.round(accom / avail) : 0,
    grossRevpar: avail > 0 ? Math.round(gross / avail) : 0,
    reservations: resCount,
  }
}

// HEADLINE MONEY, AT A PRECISION THAT SURVIVES A ONE-UNIT OWNER (2026-11-09 audit). This used to
// round everything from $1,000 up to whole thousands, which was written for a 40-unit building
// ("$109K") and is wrong for the owner-scoped reports that are now the default: a single unit's
// $1,480 month printed as "$1K" and $4,449 as "$4K". Now: exact dollars under $10K, one decimal
// to $100K, whole thousands above. 999,500+ rolls to "$1.00M" instead of printing "$1000K".
// components/ReportView.tsx fmtMoney mirrors this exactly — change them together.
export function fmtK(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (abs >= 999_500) return sign + '$' + (abs / 1_000_000).toFixed(2) + 'M'
  if (abs >= 99_950) return sign + '$' + Math.round(abs / 1000) + 'K'
  if (abs >= 10_000) return sign + '$' + (abs / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return sign + '$' + Math.round(abs).toLocaleString('en-US')
}

// ---------- YTD ----------
export async function ytdStats(listingIds: string[], asOf: string, units: number, opts?: CalcOpts) {
  const jan1 = asOf.slice(0, 4) + '-01-01'
  const toExcl = addDays(asOf, 1)
  const pulled = await pullReservations(listingIds, jan1, toExcl)
  const m = metricsFor(pulled, units, jan1, toExcl, opts)
  // Engine 2: an owner's own no-rate stay is not a reservation we booked, so it stays out of the
  // count, the average stay and the booking window as well as out of occupancy.
  const resv = v2(opts) ? pulled.filter(r => !r.noRate) : pulled
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
const CHANNEL_NAME = (s: string) => /be-?api|booking ?engine|website|direct|manual|owner/.test(s) ? 'Direct' : /airbnb/.test(s) ? 'Airbnb' : /booking/.test(s) ? 'Booking.com' : /vrbo|homeaway/.test(s) ? 'Vrbo' : /expedia|hotels\.com/.test(s) ? 'Expedia' : /direct|website|manual|owner/.test(s) ? 'Direct' : s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Other'
export async function bookingsSince(listingIds: string[], since: string, asOf: string, names: Record<string, string>): Promise<NewBookings | null> {
  if (!listingIds.length) return null
  const db = supabaseAdmin()
  let all: any[] = []
  for (let i = 0; i < 10; i++) {
    const { data } = await db.from('guesty_reservations')
      .select('id, listing_id, check_in, check_out, nights, status, source, created_at, grossFare:raw->money->>fareAccommodationAdjusted, fare:raw->money->>fareAccommodation')
      .in('status', CONFIRMED).in('listing_id', listingIds)
      // ET days, not UTC ones: `since` and `asOf` are Miami calendar dates (see etDayStartUtc).
      .gte('created_at', etDayStartUtc(since)).lt('created_at', etDayStartUtc(addDays(asOf, 1)))
      .order('id').range(i * 1000, i * 1000 + 999)
    if (!data || !data.length) break
    all = all.concat(data)
    if (data.length < 1000) break
  }
  // AN OWNER'S OWN STAY IS NOT A BOOKING WE WON (2026-11-09 audit). Owner holds arrive as confirmed
  // reservations with source "owner" and no fare; they were being counted here as new "Direct"
  // bookings at $0, which inflated the count and nights and dragged the slide's ADR down.
  const rows = all.filter(r => r.check_in && r.check_out && !OWNER_SRC.test(String(r.source || '').trim().toLowerCase())).map(r => {
    const nights = Math.max(1, num(r.nights) || daysBetween(String(r.check_in).slice(0, 10), String(r.check_out).slice(0, 10)))
    return { unit: names[String(r.listing_id)] || 'Unit', checkIn: String(r.check_in).slice(0, 10), checkOut: String(r.check_out).slice(0, 10), nights,
      revenue: Math.round((num(r.grossFare) || num(r.fare)) * 100) / 100, channel: CHANNEL_NAME(String(r.source || '').toLowerCase()), booked: etDayOf(r.created_at) || String(r.created_at).slice(0, 10) }
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
    const { data } = await db.from('owner_reports').select('as_of, title, scope_label, listing_ids').lt('as_of', asOf).order('as_of', { ascending: false }).limit(200)
    const want = new Set(listingIds)
    // ONLY AN OWNER REVIEW IS "THE LAST OWNER REPORT" (2026-11-09 audit). Projections, onboarding
    // decks and sales proposals live in the same table with their own as_of, so a proposal built
    // last Tuesday for a building used to reset every owner's "bookings since" to last Tuesday.
    // Same title test the Reports desk classifies rows with.
    const isReview = (r: any) => !/onboarding|proposal|projection/i.test(String(r.title || ''))
    const hit = ((data || []) as any[]).find(r => isReview(r) && (String(r.scope_label || '') === scopeLabel || (Array.isArray(r.listing_ids) && r.listing_ids.some((x: any) => want.has(String(x))))))
    return hit ? String(hit.as_of).slice(0, 10) : null
  } catch { return null }
}

// ---------- months-ahead (OTB by stay month) ----------
export async function monthsAhead(listingIds: string[], asOf: string, units: number, count: number, opts?: CalcOpts) {
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
    try { mix = mixFor(v2(opts) ? resv.filter(r => !r.noRate) : resv, beds, listingIds, cur, end, extra) } catch { mix = undefined }
    months.push({ iso: cur, label: monthLabel(cur), short: monthShort(cur), m: metricsFor(resv, units, cur, end, opts), mix })
    cur = end
  }
  return months // [prev month, current, +1, ...]
}

// ---------- budgets ----------
export type BudgetRow = { building_key: string; year: number; month: number; occupancy_pct: number | null; adr: number | null; revpar: number | null; gross_revenue: number | null }

export async function pullBudgets(buildings: string[], monthIsos: string[], revenueShare?: Record<string, number>): Promise<Record<string, BudgetRow>> {
  const db = supabaseAdmin()
  if (!buildings.length || !monthIsos.length) return {}
  const years = Array.from(new Set(monthIsos.map(m => Number(m.slice(0, 4))).filter(y => Number.isFinite(y))))
  const { data } = await db.from('owner_budgets')
    .select('building_key, year, month, occupancy_pct, adr, revpar, gross_revenue')
    .in('building_key', buildings).in('year', years)
  const out: Record<string, BudgetRow> = {}
  for (const raw of (data || []) as any[]) {
    const iso = String(raw.year) + '-' + String(raw.month).padStart(2, '0') + '-01'
    if (monthIsos.indexOf(iso) < 0) continue
    // Engine 2: each building's REVENUE budget is scaled to the share of its units in scope before
    // anything is added up. The per-night targets (occupancy / ADR / RevPAR) are not scaled.
    const sh = revenueShare ? revenueShare[String(raw.building_key)] : undefined
    const r: any = sh != null && Number.isFinite(sh) && raw.gross_revenue != null
      ? { ...raw, gross_revenue: Number(raw.gross_revenue) * Math.max(0, Math.min(1, sh)) } : raw
    const prev = out[iso]
    if (!prev) { out[iso] = r as BudgetRow; continue }
    // TWO BUILDINGS, ONE MONTH (2026-11-09 audit). The last row read used to win, so a report
    // spanning two budgeted buildings compared both buildings' actuals with ONE building's plan.
    // Revenue budgets add; occupancy / ADR / RevPAR are ratios that cannot be combined without
    // each building's nights, so those rows are left out rather than averaged into a made-up target.
    out[iso] = {
      building_key: prev.building_key + ' + ' + String(r.building_key), year: prev.year, month: prev.month,
      occupancy_pct: null, adr: null, revpar: null,
      gross_revenue: prev.gross_revenue != null && r.gross_revenue != null ? Number(prev.gross_revenue) + Number(r.gross_revenue) : null,
    }
  }
  return out
}

// ---------- reviews ----------
export type ReviewRow = { rating: number | null; content: string; guest_name: string | null; listing_id: string | null; created_at: string | null; channel: string | null
  /** Marked "does not count toward the score" on the reviews desk. Still quotable; never averaged. */
  excluded?: boolean }

export async function pullReviews(listingIds: string[], from: string, asOf: string): Promise<ReviewRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('guesty_reviews')
    .select('rating, content, guest_name, listing_id, created_at, channel, excluded_from_score')
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
    excluded: !!r.excluded_from_score,
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
  opts?: CalcOpts,
): Promise<ReportContent['plan']> {
  const mAhead = (mAheadIn && mAheadIn.length) ? mAheadIn : await monthsAhead(listingIds, asOf, units, 6, opts)
  if (!mAhead.length) return null
  const e2 = v2(opts)

  // The deck shows the two closed months, the month in progress, and next month's pace.
  const prevPrev = monthStart(addDays(mAhead[0].iso, -1))
  const wantIsos = [prevPrev].concat(mAhead.slice(0, 3).map(m => m.iso))
  // IS THIS THE WHOLE BUILDING, OR SOME OF ITS UNITS? (2026-11-09 audit.) Budgets are stored per
  // BUILDING. Reports are scoped by owner by default, and an owner with three of a building's
  // forty units was shown their three units' revenue "vs" the whole building's revenue budget —
  // permanently ~90% behind plan. Occupancy, ADR and RevPAR are per-night ratios and compare
  // fairly at any size; the revenue TOTAL does not.
  //   engine 1 — the revenue row is left out when the scope is under 80% of the building's units.
  //   engine 2 — the building's revenue budget is PRO-RATED by unit share (3 of 40 units is
  //              measured against 3/40 of the budget), and the slide says so in a visible note.
  let partialScope = false
  let share: Record<string, number> | undefined
  let shareNote = ''
  try {
    const whole = await resolveScope([], buildings)
    partialScope = whole.listings.length > 0 && listingIds.length < whole.listings.length * 0.8
    if (e2) {
      const total: Record<string, number> = {}, mine: Record<string, number> = {}
      const want = new Set(listingIds)
      for (const l of whole.listings) {
        total[l.building] = (total[l.building] || 0) + 1
        if (want.has(l.id)) mine[l.building] = (mine[l.building] || 0) + 1
      }
      const parts: string[] = []
      const sh: Record<string, number> = {}
      for (const bld of buildings) {
        if (!total[bld]) continue
        const m = mine[bld] || 0
        sh[bld] = m / total[bld]
        if (m < total[bld]) parts.push(m + ' of ' + total[bld] + ' units' + (buildings.length > 1 ? ' at ' + bld : ''))
      }
      if (parts.length) { share = sh; shareNote = parts.join(', ') }
    }
  } catch { partialScope = false; share = undefined; shareNote = '' }

  const budgets = await pullBudgets(buildings, wantIsos, share)
  if (!Object.keys(budgets).length) return null

  const candidates: { iso: string; endExcl: string; pacing?: boolean }[] = [{ iso: prevPrev, endExcl: mAhead[0].iso }]
  candidates.push({ iso: mAhead[0].iso, endExcl: mAhead[1] ? mAhead[1].iso : monthEndExcl(mAhead[0].iso) })
  if (mAhead[1]) candidates.push({ iso: mAhead[1].iso, endExcl: mAhead[2] ? mAhead[2].iso : monthEndExcl(mAhead[1].iso) })
  // Forward "PACING" card: next month's on-the-books pace against its budget.
  if (mAhead[2]) candidates.push({ iso: mAhead[2].iso, endExcl: mAhead[3] ? mAhead[3].iso : monthEndExcl(mAhead[2].iso), pacing: true })

  // One reservation pull for the whole four-month span, sliced per month by metricsFor — this was
  // four sequential round-trips, one per card.
  const withBudget = candidates.filter(c => !!budgets[c.iso])
  if (!withBudget.length) return null
  const spanFrom = withBudget[0].iso
  const spanToExcl = withBudget[withBudget.length - 1].endExcl
  const spanResv = await pullReservations(listingIds, spanFrom, spanToExcl)

  const monthsOut: NonNullable<ReportContent['plan']>['months'] = []
  for (const c of withBudget) {
    const b = budgets[c.iso]
    if (!b) continue
    const mm = metricsFor(spanResv, units, c.iso, c.endExcl, opts)
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
    if (b.gross_revenue != null && (e2 || !partialScope)) {
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
  return {
    headline: 'Tracking against the ' + asOf.slice(0, 4) + ' budget.',
    subtitle: e2
      ? (shareNote ? 'Revenue budget is the building’s, pro-rated to the units in this report (' + shareNote + '). Occupancy, ADR and RevPAR are the building’s per-night targets.' : '')
      : (partialScope ? 'Measured against the building’s per-night targets. The building-wide revenue budget is not shown for a partial set of units.' : ''),
    months: monthsOut,
  }
}
