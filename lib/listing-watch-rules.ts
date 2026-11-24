// THE LISTING WATCH — the rules, pure, so plain node can test them (lib/__tests__/listing-watch.test.mjs).
// The Slack posting is lib/listing-watch.ts.
//
// Jon, 2026-11-24: "in the admin dashboard, please have or catch properties without a cleaning fee.
// That should be red urgent, and if there's a property without a cleaning fee, please have Eve message
// us in Slack in the leadership chat." And: "have Eve send in the leadership chat any listings that
// are offline from Airbnb in particular."
//
// Two standing lists, read off the same rows as the Admin desk (so the page and the message can never
// disagree): active listings with no cleaning fee, and active listings Airbnb is not selling.
//
// WHEN IT SPEAKS. The moment a listing joins a list (the listings sync runs twice a day, and a new one
// is announced on the first run inside the sending hours), and once each morning while anything is
// still on a list. A morning with both lists empty says nothing. A listing that leaves a list and
// comes back is new again.
import { noCleaningFee, airbnbOffline, type AdminRow } from './admin-desk-shared'

export const WATCH_KEY = 'listing_watch'
export type WatchKind = 'fee' | 'airbnb'
/** The few fields of an Admin desk row the watch reads. A whole AdminRow fits. */
export type WatchRow = Pick<AdminRow, 'id' | 'name' | 'building' | 'active' | 'cleaningFee' | 'feeExempt' | 'listed' | 'channels'>
export type WatchItem = { id: string; name: string; building: string; note: string; since: string | null }
export type WatchSide = { seen: Record<string, string>; lastDay: string }
export type WatchState = { fee: WatchSide; airbnb: WatchSide; lastRun: string | null; lastError: string | null }

const side = (v: any): WatchSide => ({ seen: v && v.seen && typeof v.seen === 'object' ? { ...v.seen } : {}, lastDay: String((v && v.lastDay) || '') })
export function cleanWatchState(v: unknown): WatchState {
  const x = (v && typeof v === 'object' ? v : {}) as any
  return { fee: side(x.fee), airbnb: side(x.airbnb), lastRun: x.lastRun || null, lastError: x.lastError || null }
}

const byPlace = (a: WatchItem, b: WatchItem) => a.building.localeCompare(b.building) || a.name.localeCompare(b.name, undefined, { numeric: true })
const VERDICT: Record<string, string> = { delisted: 'page removed', suspended: 'suspended', failed: 'failed', disconnected: 'disconnected' }

/** Active listings with no cleaning fee. */
export function feeItems(rows: WatchRow[]): WatchItem[] {
  return rows.filter(noCleaningFee).map(r => ({ id: r.id, name: r.name, building: r.building, note: r.listed === false ? 'not listed yet' : '', since: null })).sort(byPlace)
}
/** Active listings Airbnb is not selling, with how and since when. */
export function airbnbItems(rows: WatchRow[]): WatchItem[] {
  return rows.filter(airbnbOffline).map(r => {
    const c = r.channels.airbnb2
    return { id: r.id, name: r.name, building: r.building, note: VERDICT[c.verdict] || c.verdict, since: c.since ? String(c.since).slice(0, 10) : null }
  }).sort(byPlace)
}

/** Should this list be posted now? `reminder` is the morning run: it speaks once a day while the list is not empty. */
export function decide(items: WatchItem[], s: WatchSide, today: string, reminder: boolean): { post: boolean; fresh: string[]; why: string } {
  if (!items.length) return { post: false, fresh: [], why: 'nothing on the list' }
  const fresh = items.filter(i => !s.seen[i.id]).map(i => i.id)
  if (fresh.length) return { post: true, fresh, why: fresh.length + ' new' }
  if (reminder && s.lastDay !== today) return { post: true, fresh: [], why: 'morning reminder' }
  return { post: false, fresh: [], why: reminder ? 'already said today' : 'nothing new' }
}
/** What is remembered after a run. A listing that left the list is forgotten, so it is new if it returns. Only a message that went out marks anything as said. */
export function nextSide(items: WatchItem[], s: WatchSide, today: string, nowIso: string, posted: boolean): WatchSide {
  const seen: Record<string, string> = {}
  for (const i of items) { if (s.seen[i.id]) seen[i.id] = s.seen[i.id]; else if (posted) seen[i.id] = nowIso }
  return { seen, lastDay: posted ? today : s.lastDay }
}

// ── The words ───────────────────────────────────────────────────────────────────────────────────
const esc = (v: string) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shortDay = (ymd: string | null) => { if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ''; return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }
const MAX_LINES = 25
function lines(items: WatchItem[], fresh: string[]): string {
  const isNew = new Set(fresh)
  // New ones first, so the reason for the message is its first line.
  const sorted = items.slice().sort((a, b) => Number(isNew.has(b.id)) - Number(isNew.has(a.id)) || byPlace(a, b))
  const out = sorted.slice(0, MAX_LINES).map(i => {
    const bits = [i.note, i.since ? 'since ' + shortDay(i.since) : '', isNew.has(i.id) && fresh.length < items.length ? '*new*' : ''].filter(Boolean)
    return '• *' + esc(i.name) + '*' + (i.building && i.name.toLowerCase().indexOf(i.building.toLowerCase()) < 0 ? ' (' + esc(i.building) + ')' : '') + (bits.length ? ' · ' + bits.join(' · ') : '')
  })
  if (sorted.length > MAX_LINES) out.push('…and ' + (sorted.length - MAX_LINES) + ' more')
  return out.join('\n')
}
const head = (n: number, one: string, many: string, fresh: number) => ':red_circle: *' + (n === 1 ? '1 ' + one : n + ' ' + many) + '*' + (fresh && fresh < n ? ' · ' + fresh + ' new' : '')

export function feeMessage(items: WatchItem[], fresh: string[], appUrl: string, cc = ''): { body: string; summary: string } {
  const n = items.length
  const body = head(n, 'property has no cleaning fee', 'properties have no cleaning fee', fresh.length) + '\n'
    + lines(items, fresh) + '\n'
    + 'Guests pay nothing for the clean on any booking made while the fee is empty. Set it on the listing in Guesty (Pricing) or from the building page in Lighthouse.\n'
    + '<' + appUrl + '/admin?tab=listings&show=noCleaningFee|Open the list>'
    + (cc && fresh.length ? '\n' + cc : '')
  return { body, summary: n + (n === 1 ? ' property has' : ' properties have') + ' no cleaning fee' }
}
export function airbnbMessage(items: WatchItem[], fresh: string[], appUrl: string, cc = ''): { body: string; summary: string } {
  const n = items.length
  const body = head(n, 'listing is offline on Airbnb', 'listings are offline on Airbnb', fresh.length) + '\n'
    + lines(items, fresh) + '\n'
    + 'Guests cannot book these on Airbnb until each is fixed in the Airbnb host account or reconnected in Guesty.\n'
    + '<' + appUrl + '/admin?tab=channels&channel=airbnb2&problems=1|Open Channels>'
    + (cc && fresh.length ? '\n' + cc : '')
  return { body, summary: n + (n === 1 ? ' listing is' : ' listings are') + ' offline on Airbnb' }
}
