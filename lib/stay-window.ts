// THE STAY WINDOW — reading and writing a listing's minimum length of stay, date by date.
//
// Jon's ask (2026-08-17): on selected listings, drop the minimum stay from 30 nights to 3 at 6pm ET
// and put it back to 30 at 7am ET, across a ROLLING 60-day window. The evening window is when
// last-minute short-stay demand shops; the rest of the day the property reads as a 30-day rental.
//
// WHY THE CALENDAR AND NOT THE LISTING:
// `terms.minNights` on the listing (what /api/bulk-policies writes) is the property DEFAULT. It has
// no end date, so flipping it to 3 would open every future date, not the next 60 — someone could
// book a 3-night stay nine months out. Guesty's calendar endpoint takes a start and an end date and
// its per-date values BEAT the listing default, which is exactly the shape this needs. Day 61 and
// beyond is never written, so it keeps the 30-night default on its own.
//
// SELF-CONTAINED ON PURPOSE: this file only borrows getToken() from lib/guesty.ts. Parallel sessions
// edit lib/guesty.ts regularly and a new feature is not worth a merge conflict in the API client.
import 'server-only'
import { getToken } from './guesty'

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

export type MinNightsDay = { date: string; minNights: number | null; status: string | null }
export type TermsRead = { minNights: number | null; maxNights: number | null }

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function numOrNull(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Every date in this feature is an EASTERN date. The cron fires on UTC wall-clock and the calendar
// Guesty holds is the property's local calendar; converting through the server's timezone would
// slide the window by a day twice a year.
export function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function authed(path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  let attempt = 0
  let force = false
  while (true) {
    attempt++
    const token = await getToken(force)
    force = false
    const r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (r.status === 401 && attempt === 1) { force = true; continue }
    if (r.status === 429 && attempt < 5) {
      await new Promise(res => setTimeout(res, Math.min(1000 * attempt, 8000)))
      continue
    }
    const body = await r.text().catch(() => '')
    return { status: r.status, body }
  }
}

// ---- READ: the listing's default min/max nights ----------------------------------------------
// maxNights matters more than it looks. 7071 SW carries a 45-night maximum, so a minimum of 60
// would put the floor above the ceiling and produce a window nothing fits through. Callers use this
// to refuse that write rather than push an unbookable range to seven channels.
export async function readTerms(listingId: string): Promise<TermsRead> {
  const { status, body } = await authed(`/listings/${encodeURIComponent(listingId)}?fields=terms`)
  if (status < 200 || status >= 300) throw new Error(`Guesty listing read ${status}: ${body.slice(0, 200)}`)
  let j: any = {}
  try { j = JSON.parse(body) } catch { j = {} }
  return { minNights: numOrNull(j?.terms?.minNights), maxNights: numOrNull(j?.terms?.maxNights) }
}

// ---- READ: per-date minimum nights across a range --------------------------------------------
// The response shape for this endpoint has moved between Guesty API versions, so every path is read
// defensively — same approach lib/guesty.ts already takes for the availability calendar.
export async function readMinNights(listingId: string, startDate: string, endDate: string): Promise<MinNightsDay[]> {
  const qs = new URLSearchParams({ startDate, endDate })
  const { status, body } = await authed(`/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}?${qs.toString()}`)
  if (status < 200 || status >= 300) throw new Error(`Guesty calendar read ${status}: ${body.slice(0, 200)}`)
  let payload: any = {}
  try { payload = JSON.parse(body) } catch { payload = {} }
  const rows: any[] =
    (Array.isArray(payload?.data?.days) ? payload.data.days : null)
    ?? (Array.isArray(payload?.data?.days?.calendar) ? payload.data.days.calendar : null)
    ?? (Array.isArray(payload?.data?.calendar) ? payload.data.calendar : null)
    ?? (Array.isArray(payload?.data) ? payload.data : null)
    ?? (Array.isArray(payload) ? payload : [])
  const out: MinNightsDay[] = []
  for (const d of rows) {
    const date = str(d?.date || d?.day).slice(0, 10)
    if (!date) continue
    out.push({
      date,
      minNights: numOrNull(d?.minNights ?? d?.minStay ?? d?.min_nights),
      status: d?.status ? str(d.status).toLowerCase() : null,
    })
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

// ---- WRITE: set the minimum nights across a range --------------------------------------------
// One call covers the whole range. Nothing else in the body: no price, no status, no cta/ctd — a
// calendar write that carries fields it did not mean to change is how a pricing tool's work gets
// silently overwritten.
export async function writeMinNights(
  listingId: string, startDate: string, endDate: string, minNights: number
): Promise<{ status: number; body: string }> {
  return authed(`/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, minNights }),
  })
}

// ---- Guard: never write a minimum above the listing's own maximum -----------------------------
// Encoded rather than remembered. The 30-to-60 test Jon proposed would have tripped exactly this.
export function conflictsWithMax(minNights: number, maxNights: number | null): string | null {
  if (maxNights == null || !Number.isFinite(maxNights) || maxNights <= 0) return null
  if (minNights > maxNights) {
    return `Minimum ${minNights} nights is above this listing's maximum of ${maxNights} nights — nothing could book that range. Raise the listing's maxNights first, or pick a minimum at or below ${maxNights}.`
  }
  return null
}

// A compact summary of what the range currently looks like, so a human can eyeball whether anything
// is already overriding min-stay on those dates before we start writing over them.
export function summarize(days: MinNightsDay[]): { total: number; distinct: Array<{ minNights: number | null; count: number }> } {
  const counts = new Map<string, number>()
  for (const d of days) {
    const k = d.minNights == null ? 'null' : String(d.minNights)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const distinct: Array<{ minNights: number | null; count: number }> = []
  counts.forEach((count, k) => { distinct.push({ minNights: k === 'null' ? null : Number(k), count }) })
  distinct.sort((a, b) => b.count - a.count)
  return { total: days.length, distinct }
}
