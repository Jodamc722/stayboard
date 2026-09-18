// CHANNEL HEALTH — is every listing actually connected to every channel we think it is on?
//
// Jon, 2026-09-18: "A report or data set that shows our listings and whether we are connected to
// channels. A report or page that creates a trigger if a listing is suspended etc. Need to identify
// listings not connected."
//
// WHERE THE ANSWER LIVES. Guesty keeps one entry per channel in `guesty_listings.raw.integrations[]`:
//   { _id, platform: 'airbnb2', externalUrl, airbnb2: { status: 'COMPLETED', approvalStatus, syncCategory, … } }
// The sub-object's `status` is Guesty's own verdict on the connection (COMPLETED / FAILED /
// DISCONNECTED as seen on 2026-09-18 across 2,334 entries). Airbnb adds `approvalStatus`, which is
// Airbnb's verdict on the LISTING — a listing can be perfectly connected and still not for sale
// because Airbnb suspended it. Both are read; neither is assumed.
//
// DETERMINISTIC. No model anywhere in this file. Every verdict is a rule you can read below, and a
// status value this code has never seen becomes its own `unknown` bucket with the value shown —
// never folded into "fine". The day Guesty invents a fourth status is the day it shows up amber on
// the page rather than green.
//
// SLIM READS. Only `raw->integrations` is selected, never the whole raw blob — the listing sync
// stores photos, descriptions and calendars in there and 290 of them is several MB per call.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { rollupBuilding } from './optimize-score'
import { marketOf } from './segments'
import { getSetting, setSetting } from './app-settings'
import {
  CHANNELS, MAJOR_KEYS, emptyTotals, isProblem, worstOf, verdictRank,
  type Cell, type CellVerdict, type ChannelHealth, type ChannelKey, type ListingHealth, type ChannelTotals,
} from './channel-types'

export type { ChannelHealth, ListingHealth, Cell, CellVerdict } from './channel-types'

const str = (v: any) => (v == null ? '' : String(v)).trim()
const lc = (v: any) => str(v).toLowerCase()
const httpish = (u: any): string | null => { const s = str(u); return /^https?:\/\//i.test(s) ? s : null }

/** Bookings that count as a channel producing. Same exclusion list the audit uses for arrivals. */
const NOT_A_BOOKING = /cancel|declin|inquir|expire|reject/i
const BOOKING_WINDOW_DAYS = 90
/** How far back we look for "last booking from this channel". Older than this reads as none on file. */
const LAST_BOOKING_LOOKBACK_DAYS = 365
/** A listing with at least this many bookings from anywhere in the window is clearly selling — so a major channel that produced none of them is worth a look. */
const STALE_MIN_OTHER_BOOKINGS = 3

// ── The channel a reservation came from ─────────────────────────────────────────────────────────

/** `source` → channel key, or null for direct / manual / owner / anything we do not distribute on. */
export function channelOfSource(source: any): ChannelKey | null {
  const s = lc(source)
  if (!s) return null
  // "booking engine" / "be-api" is OUR site, not Booking.com — check before the prefix match.
  if (/^be[-_ ]?api|booking\s*engine|bookingengine|^website$|^direct$|^manual$|^owner/.test(s)) return null
  for (const ch of CHANNELS) {
    for (const src of ch.sources) if (s.indexOf(src) >= 0) return ch.key
  }
  return null
}

// ── airbnb2.approvalStatus ──────────────────────────────────────────────────────────────────────
//
// Seen as an OBJECT in the live data and never documented by Guesty. Read defensively: any string
// field that looks like a status wins, then any reason/notes text is appended so the page shows
// what Airbnb actually said. If the shape changes, the raw JSON (trimmed) is the text — a person
// can still read it, and the verdict below only ever matches on words, never on structure.
export function approvalText(v: any): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v !== 'object') return String(v)
  const parts: string[] = []
  const keys = ['status', 'state', 'value', 'approvalStatus', 'approval', 'result']
  for (const k of keys) {
    const x = (v as any)[k]
    if (typeof x === 'string' && x.trim()) { parts.push(x.trim()); break }
  }
  for (const k of ['reason', 'reasons', 'notes', 'note', 'message', 'text', 'description']) {
    const x = (v as any)[k]
    if (typeof x === 'string' && x.trim()) parts.push(x.trim().slice(0, 200))
    else if (Array.isArray(x) && x.length) parts.push(x.map(y => typeof y === 'string' ? y : JSON.stringify(y)).join('; ').slice(0, 200))
  }
  if (parts.length) return parts.join(' — ')
  try { return JSON.stringify(v).slice(0, 240) } catch { return String(v) }
}

/** Airbnb has taken the listing off sale, or never put it on. Matched on words so the object shape is irrelevant. */
export function approvalBlocks(text: string | null): boolean {
  if (!text) return false
  return /suspend|reject|declin|denied|pending|blocked|unlisted|not[\s_-]?approved|in[\s_-]?review|under[\s_-]?review|snooz|paused|delist/i.test(text)
}
export function approvalOk(text: string | null): boolean {
  if (!text) return true
  return !approvalBlocks(text) && /approv|listed|active|ready|live|ok\b/i.test(text)
}

// ── One cell ────────────────────────────────────────────────────────────────────────────────────

function cellFor(entry: any, ch: ChannelKey, bookings: { last: string | null; n90: number } | undefined): Cell {
  const book = bookings || { last: null, n90: 0 }
  if (!entry) return { connected: false, status: null, approval: null, syncCategory: null, url: null, lastBookingAt: book.last, bookings90d: book.n90, verdict: 'missing' }
  const sub = entry && typeof entry[ch] === 'object' && entry[ch] ? entry[ch] : {}
  const status = str(sub.status) || null
  const approval = ch === 'airbnb2' ? approvalText(sub.approvalStatus) : null
  const syncCategory = str(sub.syncCategory || sub.syncType) || null
  const url = httpish(entry.externalUrl)
  let verdict: CellVerdict
  const up = (status || '').toUpperCase()
  if (up === 'COMPLETED') verdict = 'live'
  else if (up === 'FAILED') verdict = 'failed'
  else if (up === 'DISCONNECTED') verdict = 'disconnected'
  else verdict = 'unknown'
  // Airbnb's own verdict outranks the connection status: a COMPLETED sync to a suspended listing
  // is still a listing nobody can book.
  if (ch === 'airbnb2' && verdict === 'live' && approvalBlocks(approval)) verdict = 'suspended'
  return { connected: true, status: status || '(no status)', approval, syncCategory, url, lastBookingAt: book.last, bookings90d: book.n90, verdict }
}

// ── The whole picture ───────────────────────────────────────────────────────────────────────────

export async function buildChannelHealth(): Promise<ChannelHealth> {
  const db = supabaseAdmin()

  // Listings — slim: the integrations array only, not raw.
  const listings: any[] = []
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await db.from('guesty_listings')
      .select('id,nickname,title,building,status,address_city,ints:raw->integrations')
      .order('id').range(from, from + 999)
    if (error) throw new Error('guesty_listings: ' + error.message)
    listings.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  // Bookings by listing × channel, by the date the booking was MADE (created_at) — a channel that
  // produced a booking last week is alive whatever its stay dates are.
  const since90 = new Date(Date.now() - BOOKING_WINDOW_DAYS * 86400000).toISOString()
  const sinceLast = new Date(Date.now() - LAST_BOOKING_LOOKBACK_DAYS * 86400000).toISOString()
  const perCell: Record<string, { last: string | null; n90: number }> = {}
  const perListing: Record<string, number> = {}
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await db.from('guesty_reservations')
      .select('listing_id,source,status,created_at')
      .gte('created_at', sinceLast).order('created_at', { ascending: false }).range(from, from + 999)
    if (error) throw new Error('guesty_reservations: ' + error.message)
    for (const r of (data || []) as any[]) {
      if (NOT_A_BOOKING.test(lc(r.status))) continue
      const lid = str(r.listing_id); if (!lid) continue
      const ch = channelOfSource(r.source)
      const at = str(r.created_at)
      const in90 = at >= since90
      if (in90) perListing[lid] = (perListing[lid] || 0) + 1
      if (!ch) continue
      const k = lid + ':' + ch
      const c = perCell[k] || (perCell[k] = { last: null, n90: 0 })
      if (!c.last || at > c.last) c.last = at
      if (in90) c.n90++
    }
    if (!data || data.length < 1000) break
  }

  const totals: ChannelTotals = {}
  const statusesSeen: Record<string, Record<string, number>> = {}
  for (const ch of CHANNELS) { totals[ch.key] = emptyTotals(); statusesSeen[ch.key] = {} }

  const active: ListingHealth[] = []
  const inactive: ListingHealth[] = []
  for (const l of listings) {
    const id = str(l.id); if (!id) continue
    const name = str(l.nickname) || str(l.title) || id
    const building = rollupBuilding(l.building, name)
    const market = marketOf(l.building, l.address_city, name)
    // The exact-match rule every board uses: anything that is not literally 'active' is off the book.
    const isActive = lc(l.status) === 'active'
    const ints: any[] = Array.isArray(l.ints) ? l.ints : []
    const cells: Record<string, Cell> = {}
    const total90 = perListing[id] || 0
    for (const ch of CHANNELS) {
      const entry = ints.find(it => it && (str(it.platform) === ch.key || (it[ch.key] && typeof it[ch.key] === 'object')))
      const cell = cellFor(entry, ch.key, perCell[id + ':' + ch.key])
      // STALE: connected and reporting fine, yet a MAJOR channel has sent nothing in 90 days while
      // the listing books ≥3 times elsewhere. Not an alert — a question worth asking Guesty.
      if (ch.major && cell.verdict === 'live' && cell.bookings90d === 0 && total90 - cell.bookings90d >= STALE_MIN_OTHER_BOOKINGS) cell.verdict = 'stale'
      cells[ch.key] = cell
      if (isActive) {
        totals[ch.key][cell.verdict]++
        const sk = cell.connected ? String(cell.status) : '(none)'
        statusesSeen[ch.key][sk] = (statusesSeen[ch.key][sk] || 0) + 1
      }
    }
    const majorVerdicts = MAJOR_KEYS.map(k => cells[k].verdict)
    const row: ListingHealth = {
      id, name, building, market, active: isActive, status: str(l.status) || '(none)',
      cells, verdict: worstOf(majorVerdicts),
      missingMajor: MAJOR_KEYS.filter(k => isProblem(cells[k].verdict)),
      bookings90d: total90,
    }
    ;(isActive ? active : inactive).push(row)
  }
  const byName = (a: ListingHealth, b: ListingHealth) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name)
  active.sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict) || byName(a, b))
  inactive.sort(byName)

  return { at: new Date().toISOString(), listings: active, inactive, totals, statusesSeen, channels: CHANNELS }
}

// ── The snapshot — what the trigger compares against ────────────────────────────────────────────

export const SNAPSHOT_KEY = 'channel_health_snapshot'

export type SnapshotUnit = { name: string; building: string; market: string; active: boolean }
export type ChannelSnapshot = {
  at: string
  /** `<listingId>:<platform>` → verdict, every listing (active or not) × every channel. */
  cells: Record<string, CellVerdict>
  /** `<listingId>` → the airbnb2 approval text, so a change of Airbnb's mind is a transition too. */
  approval: Record<string, string | null>
  units: Record<string, SnapshotUnit>
}

export function snapshotOf(h: ChannelHealth): ChannelSnapshot {
  const cells: Record<string, CellVerdict> = {}
  const approval: Record<string, string | null> = {}
  const units: Record<string, SnapshotUnit> = {}
  for (const l of h.listings.concat(h.inactive)) {
    units[l.id] = { name: l.name, building: l.building, market: l.market, active: l.active }
    for (const ch of CHANNELS) cells[l.id + ':' + ch.key] = l.cells[ch.key].verdict
    const a = l.cells.airbnb2 ? l.cells.airbnb2.approval : null
    if (a != null) approval[l.id] = a
  }
  return { at: h.at, cells, approval, units }
}

export async function readSnapshot(): Promise<ChannelSnapshot | null> {
  const s = await getSetting<any>(SNAPSHOT_KEY, null)
  if (!s || typeof s !== 'object' || !s.cells || typeof s.cells !== 'object') return null
  return { at: str(s.at), cells: s.cells, approval: s.approval && typeof s.approval === 'object' ? s.approval : {}, units: s.units && typeof s.units === 'object' ? s.units : {} }
}
export async function writeSnapshot(s: ChannelSnapshot, actor = 'channel-check'): Promise<void> {
  const r = await setSetting(SNAPSHOT_KEY, s, actor)
  if (!r.ok) throw new Error('snapshot: ' + r.error)
}

export type Transition = {
  listingId: string
  unit: string
  building: string
  platform: ChannelKey | 'airbnb2:approval'
  from: string
  to: string
  /** True when a person should hear about it: an ACTIVE listing losing a MAJOR channel, or Airbnb's approval moving away from approved. */
  alert: boolean
}

/**
 * What changed between two snapshots. Every cell that moved is returned; `alert` marks the ones
 * worth a Slack message. Going live → stale is not alert-worthy (nobody broke anything), and a
 * listing that is no longer active is never alerted whatever happened to it.
 */
export function diffChannelHealth(prev: ChannelSnapshot | null, next: ChannelSnapshot): Transition[] {
  if (!prev) return []
  const out: Transition[] = []
  const wasLive = (v: string) => v === 'live' || v === 'stale'
  for (const key of Object.keys(next.cells)) {
    const to = next.cells[key]
    const from = prev.cells[key]
    if (from == null || from === to) continue
    const i = key.lastIndexOf(':')
    const listingId = key.slice(0, i)
    const platform = key.slice(i + 1) as ChannelKey
    const u = next.units[listingId] || { name: listingId, building: '', market: '', active: false }
    const alert = !!u.active && MAJOR_KEYS.indexOf(platform) >= 0 && wasLive(from) && isProblem(to)
    out.push({ listingId, unit: u.name, building: u.building, platform, from, to, alert })
  }
  for (const listingId of Object.keys(next.approval)) {
    const to = next.approval[listingId]
    const from = prev.approval[listingId]
    if (from === undefined || from === to) continue
    const u = next.units[listingId] || { name: listingId, building: '', market: '', active: false }
    const alert = !!u.active && approvalOk(from ?? null) && !approvalOk(to ?? null)
    out.push({ listingId, unit: u.name, building: u.building, platform: 'airbnb2:approval', from: from ?? '(none)', to: to ?? '(none)', alert })
  }
  out.sort((a, b) => Number(b.alert) - Number(a.alert) || a.unit.localeCompare(b.unit))
  return out
}

/** The active listings currently off a major channel, straight from a snapshot — no recompute. */
export function problemsFromSnapshot(s: ChannelSnapshot | null): { listingId: string; unit: string; building: string; market: string; platform: ChannelKey; verdict: CellVerdict }[] {
  if (!s) return []
  const out: { listingId: string; unit: string; building: string; market: string; platform: ChannelKey; verdict: CellVerdict }[] = []
  for (const key of Object.keys(s.cells)) {
    const v = s.cells[key]
    if (!isProblem(v)) continue
    const i = key.lastIndexOf(':')
    const listingId = key.slice(0, i)
    const platform = key.slice(i + 1) as ChannelKey
    if (MAJOR_KEYS.indexOf(platform) < 0) continue
    const u = s.units[listingId]
    if (!u || !u.active) continue
    out.push({ listingId, unit: u.name, building: u.building, market: u.market, platform, verdict: v })
  }
  out.sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict) || a.unit.localeCompare(b.unit))
  return out
}
