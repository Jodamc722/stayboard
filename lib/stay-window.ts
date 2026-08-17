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

// ================================================================================================
// THE SCHEDULE
// ================================================================================================
// Jon, 2026-08-17: "We just need to be able to turn this off and on at the time specified."
//
// Config lives in `app_settings` rather than its own table ON PURPOSE — a migration has to be run
// by hand in Supabase before the feature works, and this feature should work the moment it deploys.
// app_settings.value is TEXT, so lib/app-settings.ts does the JSON round-trip.
import { getSetting, setSetting } from './app-settings'

export const STAY_WINDOW_KEY = 'stay_window'

export type WindowListing = {
  id: string
  label: string
  // Cleared for stays under 30 nights in its own city. 7071 SW is in Plantation FL, which requires a
  // short-term vacation rental certificate for anything under 30 days — until someone ticks this,
  // the schedule reads the listing and leaves it alone rather than opening it up.
  cleared: boolean
}

export type RunLogEntry = {
  at: string
  direction: 'open' | 'close'
  listingId: string
  label: string
  minNights: number
  ok: boolean
  verified: boolean | null
  note: string
}

export type StayWindowConfig = {
  enabled: boolean
  days: number
  openHour: number      // ET hour the SHORT window opens (18 = 6pm)
  closeHour: number     // ET hour it closes and the long minimum returns (7 = 7am)
  shortMin: number      // 3
  longMin: number       // 30
  listings: WindowListing[]
  ranOn: Record<string, { open?: string; close?: string }>   // listingId -> last ET date per direction
  log: RunLogEntry[]
}

export const DEFAULT_CONFIG: StayWindowConfig = {
  enabled: false, days: 60, openHour: 18, closeHour: 7, shortMin: 3, longMin: 30,
  listings: [], ranOn: {}, log: [],
}

function clampInt(v: any, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.min(Math.max(n, lo), hi)
}

export function normalizeConfig(raw: any): StayWindowConfig {
  const r = (raw && typeof raw === 'object') ? raw : {}
  const listings: WindowListing[] = Array.isArray(r.listings)
    ? r.listings
        .filter((x: any) => x && typeof x === 'object' && str(x.id))
        .map((x: any) => ({ id: str(x.id), label: str(x.label) || str(x.id), cleared: x.cleared === true }))
        .slice(0, 50)
    : []
  const log: RunLogEntry[] = Array.isArray(r.log) ? r.log.slice(0, 40) : []
  return {
    enabled: r.enabled === true,
    days: clampInt(r.days, 1, 365, 60),
    openHour: clampInt(r.openHour, 0, 23, 18),
    closeHour: clampInt(r.closeHour, 0, 23, 7),
    shortMin: clampInt(r.shortMin, 1, 365, 3),
    longMin: clampInt(r.longMin, 1, 365, 30),
    listings,
    ranOn: (r.ranOn && typeof r.ranOn === 'object') ? r.ranOn : {},
    log,
  }
}

export async function readConfig(): Promise<StayWindowConfig> {
  const raw = await getSetting<any>(STAY_WINDOW_KEY, null)
  return normalizeConfig(raw)
}

export async function writeConfig(cfg: StayWindowConfig, by?: string | null) {
  return setSetting(STAY_WINDOW_KEY, normalizeConfig(cfg), by || null)
}

/** The current hour on the property's clock, 0-23. The cron fires on UTC; the calendar is Eastern. */
export function hourET(): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date())
  const n = Number(s)
  return Number.isFinite(n) ? (n === 24 ? 0 : n) : -1
}

/**
 * Apply one direction to every configured listing.
 *
 * 'open'  -> shortMin across today..today+days   (the 6pm flip)
 * 'close' -> longMin across the same range       (the 7am flip back)
 *
 * Idempotent per ET day unless `force` is set, so an hourly cron that fires twice in the same hour,
 * or a retry after a timeout, cannot write the same range twice.
 */
export async function runDirection(
  cfg: StayWindowConfig, direction: 'open' | 'close', force = false
): Promise<{ config: StayWindowConfig; results: RunLogEntry[] }> {
  const today = todayET()
  const start = today
  const end = addDays(today, cfg.days)
  const target = direction === 'open' ? cfg.shortMin : cfg.longMin
  const results: RunLogEntry[] = []

  for (const l of cfg.listings) {
    const already = (cfg.ranOn[l.id] || {})[direction]
    if (!force && already === today) continue

    const entry: RunLogEntry = {
      at: new Date().toISOString(), direction, listingId: l.id, label: l.label,
      minNights: target, ok: false, verified: null, note: '',
    }

    // The short direction is the only one that can do harm, and it is gated on the listing being
    // cleared for under-30-night stays in its own city.
    if (direction === 'open' && target < 30 && !l.cleared) {
      entry.note = 'Skipped — not marked cleared for short stays. Confirm the city registration first.'
      results.push(entry)
      continue
    }

    try {
      const terms = await readTerms(l.id)
      const clash = conflictsWithMax(target, terms.maxNights)
      if (clash) { entry.note = clash; results.push(entry); continue }

      const res = await writeMinNights(l.id, start, end, target)
      entry.ok = res.status >= 200 && res.status < 300
      if (!entry.ok) {
        entry.note = `Guesty ${res.status}: ${res.body.slice(0, 160)}`
      } else {
        try {
          const rows = await readMinNights(l.id, start, end)
          entry.verified = rows.length > 0 && rows.every(x => x.minNights === target)
          entry.note = entry.verified
            ? `${rows.length} days now read ${target} nights.`
            : `Write accepted but the calendar does not read ${target} on every day — check it.`
        } catch { entry.note = 'Write accepted; read-back failed.' }
        cfg.ranOn[l.id] = { ...(cfg.ranOn[l.id] || {}), [direction]: today }
      }
    } catch (e: any) {
      entry.note = str(e?.message).slice(0, 200)
    }
    results.push(entry)
  }

  cfg.log = results.concat(cfg.log).slice(0, 40)
  return { config: cfg, results }
}
