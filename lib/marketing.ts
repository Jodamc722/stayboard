// DIRECT BOOKING / MARKETING TRACKER — shared vocabulary.
//
// Everything here is keyed on the date a booking was CREATED (guesty_reservations.created_at),
// not the stay date. That is the only basis on which "is our marketing working this month?" can be
// answered: a booking made today for a stay in November is marketing traction TODAY.
//
// Source values below are the REAL lowercase values observed in the live Guesty mirror
// (2026-08-03 crawl): be-api, website, direct, manual, owner, owner-guest, airbnb2, booking.com,
// expedia, expedia affiliate network, hotels.com, vrbo, homeaway ca/cafr/uk, bluegroundnestpick.
// Anything new that Guesty starts emitting falls through to OTA and is flagged as unmapped so it
// can never silently vanish from the totals.

export type Bucket = 'be' | 'website' | 'direct' | 'manual' | 'owner' | 'ota'
export type Family = 'direct' | 'manual' | 'owner' | 'ota'

export const BUCKET_LABEL: Record<Bucket, string> = {
  be: 'Booking engine (BE API)',
  website: 'Website',
  direct: 'Direct',
  manual: 'Manual',
  owner: 'Owner',
  ota: 'OTA',
}

export const FAMILY_LABEL: Record<Family, string> = {
  direct: 'Direct',
  manual: 'Manual',
  owner: 'Owner',
  ota: 'OTA',
}

// Sources we know about. Used both to bucket a booking and to detect a source Guesty has newly
// invented (which we surface rather than hide).
const KNOWN_OTA = [
  'airbnb', 'airbnb2', 'booking.com', 'booking', 'bookingcom', 'expedia',
  'expedia affiliate network', 'hotels.com', 'orbitz', 'travelocity', 'ebookers', 'cheaptickets',
  'vrbo', 'homeaway', 'homeaway ca', 'homeaway cafr', 'homeaway uk',
  'american express travel', 'amex travel', 'chase travel', 'capital one travel',
  'bluegroundnestpick', 'tripadvisor', 'agoda', 'marriott',
]

// OTA breakdown rows are grouped by the company that actually controls the channel, not by the
// raw Guesty string. Orbitz, Hotels.com and Travelocity are all Expedia Group — showing them as
// separate "sites" overstates how many OTAs we really sell through. Matches the Channels page.
export function otaGroupFor(rawSource: string | null | undefined): string {
  const s = (rawSource || '').trim().toLowerCase()
  if (!s) return 'Unknown'
  if (s === 'airbnb' || s === 'airbnb2') return 'Airbnb'
  if (s === 'booking' || s === 'booking.com' || s === 'bookingcom') return 'Booking.com'
  if (s === 'expedia' || s === 'expedia affiliate network' || s === 'hotels.com' || s === 'orbitz' || s === 'travelocity' || s === 'ebookers' || s === 'cheaptickets') return 'Expedia Group'
  if (s === 'vrbo' || s.indexOf('homeaway') === 0) return 'Vrbo'
  return s.split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function bucketFor(rawSource: string | null | undefined): Bucket {
  const s = (rawSource || '').trim().toLowerCase()
  if (s === 'be-api' || s === 'be_api' || s === 'beapi' || s === 'booking engine' || s === 'bookingengine') return 'be'
  if (s === 'website' || s === 'web' || s === 'widget') return 'website'
  if (s === 'direct') return 'direct'
  if (s === 'manual') return 'manual'
  if (s === 'owner' || s === 'owner-guest' || s === 'ownerguest') return 'owner'
  return 'ota'
}

export function familyFor(b: Bucket): Family {
  if (b === 'be' || b === 'website' || b === 'direct') return 'direct'
  if (b === 'manual') return 'manual'
  if (b === 'owner') return 'owner'
  return 'ota'
}

// A source string we have never mapped. Reported on the page so a new Guesty channel gets noticed
// instead of quietly inflating "OTA".
export function isUnmappedSource(rawSource: string | null | undefined): boolean {
  const s = (rawSource || '').trim().toLowerCase()
  if (!s) return true
  if (bucketFor(s) !== 'ota') return false
  return KNOWN_OTA.indexOf(s) < 0
}

// ── Booking state ──────────────────────────────────────────────────────────
// Guesty statuses seen live: confirmed, canceled, inquiry, closed (+ checked_in / checked_out on
// stays in progress or finished, and declined / expired on dead enquiries).
export type State = 'booked' | 'inhouse' | 'stayed' | 'pending' | 'canceled'

export function stateFor(status: string | null | undefined): State {
  const s = (status || '').trim().toLowerCase()
  if (s === 'checked_in' || s === 'checkedin') return 'inhouse'
  if (s === 'checked_out' || s === 'checkedout') return 'stayed'
  if (s === 'confirmed' || s === 'reserved') return 'booked'
  if (/cancel|declin|expired|closed/.test(s)) return 'canceled'
  return 'pending' // inquiry, awaiting_payment, anything unrecognised
}

// Counts toward "bookings won": everything that is or became a real stay.
export function isWon(st: State): boolean {
  return st === 'booked' || st === 'inhouse' || st === 'stayed'
}

export const STATE_LABEL: Record<State, string> = {
  booked: 'Booked',
  inhouse: 'In house',
  stayed: 'Stayed',
  pending: 'Inquiry',
  canceled: 'Canceled',
}

// ── Payment ────────────────────────────────────────────────────────────────
export type Pay = 'paid' | 'partial' | 'unpaid'

export function payFor(money: any, fallbackPaid: number, fallbackBalance: number): Pay {
  const paid = num(money && money.totalPaid !== undefined ? money.totalPaid : fallbackPaid)
  const bal = num(money && money.balanceDue !== undefined ? money.balanceDue : fallbackBalance)
  const fully = money && money.isFullyPaid === true
  if (fully || (paid > 0 && bal <= 0.01)) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export const PAY_LABEL: Record<Pay, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid' }

// ── Money ──────────────────────────────────────────────────────────────────
// Net accommodation — the same basis the Revenue Center and the Botanica report use, so a number
// on this page reconciles with a number on those. Cleaning and fees are reported alongside, never
// folded into the headline.
export function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export function accomOf(money: any): number {
  if (!money) return 0
  const adj = money.fareAccommodationAdjusted
  if (adj !== undefined && adj !== null && Number.isFinite(Number(adj))) return Number(adj)
  return num(money.fareAccommodation)
}
export function cleaningOf(money: any): number { return num(money && money.fareCleaning) }

// ── Dates ──────────────────────────────────────────────────────────────────
// Everything is bucketed in Eastern time: a booking that lands at 9pm ET on the 31st belongs to
// that month, not to the next one in UTC.
export function etDay(iso: string | null | undefined): string {
  if (!iso) return ''
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)) } catch { return String(iso).slice(0, 10) }
}
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
export function daysBetweenIso(a: string, b: string): number {
  const ms = new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()
  return Math.round(ms / 86400000)
}
