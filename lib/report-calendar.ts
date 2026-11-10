// THE MULTI-CALENDAR AND THE BIG DATES (Jon, 2026-11-10: "On the owner report can we have big
// dates slide, occ adr etc. They keep asking about it. Also maybe a multi cal view of the listing").
//
// ONE PULL FEEDS BOTH SLIDES. content.calendar holds every stay touching the window — the report's
// own month plus the next two — as a unit index, check-in, check-out, channel, and the per-night
// money on each basis. The multi-calendar draws those stays as bars; the big-dates slide reads the
// same stays night by night for each event. Because the per-night money is stored, an event the
// team types on the slide in edit mode is priced on the spot, with no server round-trip, and the
// two slides can never disagree about what is booked.
//
// PURE AND CLIENT-SAFE. No server imports here: ReportView reads these types and computes event
// stats in the browser. The server-side builder lives in lib/owner-report.ts (calendarFor).
//
// PRIVACY. No guest names, no reservation codes — an owner link shows a bar and a channel only.

import type { Basis } from './basis'

export type CalStay = {
  /** Index into ReportCalendar.units. */
  u: number
  ci: string
  co: string
  /** Short channel label: Airbnb, VRBO, Booking, Expedia, Direct, Owner, Other. */
  ch: string
  /** An owner / friends-and-family stay with no rate — shown on the calendar, never counted as sold. */
  own: boolean
  /** Per night: accommodation the guest paid before channel fees (the "Net + fees" basis). */
  g: number
  /** Per night: the channel's host fee. */
  f: number
  /** Per night: cleaning, prorated across the stay. */
  c: number
}

export type ReportCalendar = {
  from: string
  /** Inclusive last night shown. */
  toIncl: string
  asOf: string
  units: { id: string; label: string; building: string; beds: number | null; liveFrom?: string | null }[]
  stays: CalStay[]
  /** The team's shared big dates (app_settings 'owner_report_dates') as they stood when pulled. */
  shared?: BigEvent[]
}

export type BigEvent = { label: string; from: string; to: string; source?: 'holiday' | 'market' | 'team' }

export type BigDatesSection = {
  headline?: string
  subtitle?: string
  /** Events the team added on this report. */
  events?: BigEvent[]
  /** Built-in events the team removed from this report, keyed label|from. */
  hidden?: string[]
}

// ── DATES ────────────────────────────────────────────────────────────────────
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function nightsIn(from: string, toIncl: string): string[] {
  const out: string[] = []
  for (let d = from; d <= toIncl && out.length < 400; d = addDaysIso(d, 1)) out.push(d)
  return out
}
const isYmd = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

/** "Dec 4–6", "Dec 31 – Jan 1", "Nov 26". */
export function rangeLabel(from: string, to: string): string {
  const f = new Date(from + 'T12:00:00Z'), t = new Date(to + 'T12:00:00Z')
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  if (from === to) return mo(f) + ' ' + f.getUTCDate()
  if (f.getUTCMonth() === t.getUTCMonth()) return mo(f) + ' ' + f.getUTCDate() + '–' + t.getUTCDate()
  return mo(f) + ' ' + f.getUTCDate() + ' – ' + mo(t) + ' ' + t.getUTCDate()
}

// ── WHICH DATES ARE BIG ──────────────────────────────────────────────────────
// Holidays are computed (so they are right every year). Market events move every year and are only
// listed here once the organiser has published them — checked 2026-11-10 against artbasel.com and
// two Miami event calendars that agreed. Anything not yet confirmed (F1 2027, Miami Music Week,
// Orange Bowl) is left for the team to type on the slide, rather than guessed. Each night of an
// event range counts; `to` is the last NIGHT, so a fair that closes Sunday ends on Saturday night.
export const MARKET_EVENTS: BigEvent[] = [
  { label: 'Art Basel Miami Beach', from: '2026-12-02', to: '2026-12-05', source: 'market' },
  { label: 'Miami Boat Show', from: '2027-02-10', to: '2027-02-13', source: 'market' },
  { label: 'South Beach Wine & Food', from: '2027-02-25', to: '2027-02-27', source: 'market' },
  { label: 'Miami Open', from: '2027-03-14', to: '2027-03-27', source: 'market' },
  { label: 'Ultra Music Festival', from: '2027-03-26', to: '2027-03-27', source: 'market' },
]

const nth = (y: number, m: number, dow: number, n: number) => { const d = new Date(Date.UTC(y, m, 1)); const shift = (dow - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + shift + (n - 1) * 7)).toISOString().slice(0, 10) }
const lastDow = (y: number, m: number, dow: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); const back = (d.getUTCDay() - dow + 7) % 7; return new Date(Date.UTC(y, m + 1, -back)).toISOString().slice(0, 10) }

/** Holiday WEEKENDS as ranges of nights — the way a rental actually sells them. */
export function holidayEvents(year: number): BigEvent[] {
  const ymd = (m: number, d: number) => year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
  const mon = (iso: string, label: string): BigEvent => ({ label, from: addDaysIso(iso, -3), to: addDaysIso(iso, -1), source: 'holiday' }) // Fri–Sun nights before a Monday holiday
  const tg = nth(year, 10, 4, 4)
  return [
    { label: "New Year's Eve", from: ymd(12, 31), to: ymd(12, 31), source: 'holiday' },
    mon(nth(year, 0, 1, 3), 'MLK weekend'),
    { label: "Valentine's Day", from: ymd(2, 14), to: ymd(2, 14), source: 'holiday' },
    mon(nth(year, 1, 1, 3), "Presidents' Day weekend"),
    mon(lastDow(year, 4, 1), 'Memorial Day weekend'),
    { label: 'July 4th', from: ymd(7, 3), to: ymd(7, 4), source: 'holiday' },
    mon(nth(year, 8, 1, 1), 'Labor Day weekend'),
    { label: 'Halloween', from: ymd(10, 30), to: ymd(10, 31), source: 'holiday' },
    { label: 'Thanksgiving weekend', from: addDaysIso(tg, -1), to: addDaysIso(tg, 2), source: 'holiday' },
    { label: 'Christmas', from: ymd(12, 24), to: ymd(12, 25), source: 'holiday' },
  ]
}

export const eventKey = (e: BigEvent) => e.label + '|' + e.from

/** Every big date overlapping the window: holidays, market events, the shared list, and this report's own. */
export function eventsFor(from: string, toIncl: string, shared: BigEvent[], section?: BigDatesSection | null): BigEvent[] {
  const y0 = Number(from.slice(0, 4)), y1 = Number(toIncl.slice(0, 4))
  let all: BigEvent[] = []
  for (let y = y0; y <= y1; y++) all = all.concat(holidayEvents(y))
  all = all.concat(MARKET_EVENTS, shared.map(e => ({ ...e, source: 'market' as const })))
  const own = (section && Array.isArray(section.events) ? section.events : []).map(e => ({ ...e, source: 'team' as const }))
  const hidden = new Set(section && Array.isArray(section.hidden) ? section.hidden : [])
  const seen = new Set<string>()
  const out: BigEvent[] = []
  for (const e of all.concat(own)) {
    if (!isYmd(e.from) || !isYmd(e.to) || e.to < e.from || !e.label) continue
    if (e.to < from || e.from > toIncl) continue
    const k = eventKey(e)
    if (seen.has(k) || (e.source !== 'team' && hidden.has(k))) continue
    seen.add(k)
    out.push(e)
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.label.localeCompare(b.label))
}

// ── WHAT EACH BIG DATE HOLDS ─────────────────────────────────────────────────
export type EventStats = {
  nights: number          // nights of the event inside the window
  unitNights: number      // sellable unit-nights (live units × nights, less owner nights) — the denominator
  sold: number            // unit-nights sold to paying guests
  owner: number           // unit-nights held by owner stays
  open: number            // unit-nights still open
  occPct: number
  adr: number             // on the report's basis, over sold nights
  revenue: number
  unitsFull: number       // units sold for every night of the event
  units: number
}

function nightMoney(s: CalStay, b: Basis): number {
  if (b === 'gross') return s.g + s.c
  if (b === 'net') return Math.max(0, s.g - s.f)
  return s.g
}

export function eventStats(cal: ReportCalendar, e: BigEvent, basis: Basis): EventStats {
  const from = e.from < cal.from ? cal.from : e.from
  const to = e.to > cal.toIncl ? cal.toIncl : e.to
  const nights = to >= from ? nightsIn(from, to) : []
  const live = (u: { liveFrom?: string | null }, d: string) => !u.liveFrom || u.liveFrom <= d
  let unitNights = 0, sold = 0, owner = 0, revenue = 0
  const soldByUnit: Record<number, number> = {}
  const liveByUnit: Record<number, number> = {}
  for (const d of nights) {
    cal.units.forEach((u, i) => { if (live(u, d)) { unitNights++; liveByUnit[i] = (liveByUnit[i] || 0) + 1 } })
    for (const s of cal.stays) {
      if (s.ci <= d && s.co > d) {
        if (s.own) { owner++; continue }
        sold++; revenue += nightMoney(s, basis)
        soldByUnit[s.u] = (soldByUnit[s.u] || 0) + 1
      }
    }
  }
  let unitsFull = 0
  for (const k in liveByUnit) if ((soldByUnit[Number(k)] || 0) >= liveByUnit[Number(k)]) unitsFull++
  return {
    // Owner nights leave both sides, the way the report engine (engine 2) counts occupancy: the
    // share of SELLABLE nights that sold. unitNights is reported as sellable nights for the same reason.
    nights: nights.length, unitNights: Math.max(0, unitNights - owner), sold, owner, open: Math.max(0, unitNights - sold - owner),
    occPct: unitNights - owner > 0 ? Math.round((sold / (unitNights - owner)) * 100) : 0,
    adr: sold ? Math.round(revenue / sold) : 0,
    revenue: Math.round(revenue), unitsFull, units: Object.keys(liveByUnit).length,
  }
}

/** The window's own average, so an event's rate can be read against an ordinary night. */
export function baselineStats(cal: ReportCalendar, basis: Basis): EventStats {
  return eventStats(cal, { label: 'window', from: cal.from, to: cal.toIncl }, basis)
}

// ── CHANNEL LABELS + COLOURS (shared by the calendar legend and the bars) ────
export function channelLabel(source: string, owner: boolean): string {
  if (owner) return 'Owner'
  const s = String(source || '').toLowerCase()
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/vrbo|homeaway/.test(s)) return 'VRBO'
  if (/booking/.test(s)) return 'Booking'
  if (/expedia|hotels\.com|orbitz|egencia|travelocity/.test(s)) return 'Expedia'
  if (/direct|website|manual|stay|google/.test(s)) return 'Direct'
  return 'Other'
}
