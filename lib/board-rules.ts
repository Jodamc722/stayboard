// THE BOARD — the rules, importing only other client-safe rules, so the page, the server and plain
// node (lib/__tests__/board-rules.test.mjs) all read one copy.
//
// Jon, 2026-11-25, on the Leadership board: "Want to revamp that. Can we please make that much cleaner
// and better. Does not work the way I want it to at all. It's hard to see, organize and filter. We
// need to also be able to create and manage tasks, projects, vendors, or future projects. Things that
// should auto populate should be offline listings, meaning not connected to a channel. We should be
// able to organize. Need to be clean, visually easy to see and understand, have priority tags, due
// date, mark complete, add notes, attach photo or link to activities in the app. We can also have
// assignee and it should show on briefs pending and delayed." And: "Let's rename it too."
//
// What that became:
//   - FIVE KINDS, one tab each: Tasks, Projects, Vendors, Future projects, and Offline listings, which
//     fill themselves from the channel check and close themselves when the listing is back.
//   - ORGANIZE is one row of buttons: group the list by due date, person, property, priority or kind.
//   - A ROW reads left to right in fixed columns: done, what, who, when, how urgent.
//   - ATTACH a photo, or a link to anything: a page in Lighthouse or a page outside it.
//   - THE BRIEFS read the same rows: what is delayed, what is due that day, how much is pending.
import { CHANNELS, MAJOR_KEYS, CHANNEL_LABEL } from './channel-types'

export const BOARD_NAME = 'Tasks & Projects'
export const BOARD_PATH = '/tasks'

// ── Kinds ───────────────────────────────────────────────────────────────────────────────────────
export const LANES = ['Tasks', 'Projects', 'Vendors', 'Future projects', 'Offline listings'] as const
export type Lane = typeof LANES[number]
/** What a person can add. Offline listings add themselves. */
export const ADD_LANES: Lane[] = ['Tasks', 'Projects', 'Vendors', 'Future projects']
export const AUTO_LANE: Lane = 'Offline listings'
export const LANE_ONE: Record<Lane, string> = { Tasks: 'Task', Projects: 'Project', Vendors: 'Vendor', 'Future projects': 'Future project', 'Offline listings': 'Offline listing' }
export const LANE_HINT: Record<Lane, string> = {
  Tasks: 'One thing a person on the team owes',
  Projects: 'Work that runs for weeks: a renovation, a rollout, an onboarding',
  Vendors: 'An outside company or an owner we are waiting on',
  'Future projects': 'Ideas and plans with no start yet. They stay off the briefs.',
  'Offline listings': 'Added by Lighthouse: a listing that is not selling on a main channel, or is on no channel at all. Each closes itself when the listing is back.',
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
/** The kind a stored row belongs to. The board's first two lanes, since renamed, still read. */
export function laneOf(v: unknown): Lane {
  const s = str(v).trim()
  if ((LANES as readonly string[]).includes(s)) return s as Lane
  if (/^vendor/i.test(s)) return 'Vendors'
  if (/^future/i.test(s)) return 'Future projects'
  if (/^offline/i.test(s)) return 'Offline listings'
  if (/^project/i.test(s)) return 'Projects'
  return 'Tasks'
}

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
/** Most urgent first: the order a list is sorted and grouped in. */
export const PRI_ORDER = ['urgent', 'high', 'normal', 'low']
export const priOf = (v: unknown): string => ((PRIORITIES as readonly string[]).includes(str(v)) ? str(v) : 'normal')
export const priRank = (p: string) => { const i = PRI_ORDER.indexOf(p); return i < 0 ? 2 : i }

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const daysLate = (due: string, today: string) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(due + 'T12:00:00Z')) / 86400_000)

// ── Attachments: a photo, or a link ─────────────────────────────────────────────────────────────
// Both live in board_photos (url + caption). A photo is a file in our own bucket; anything else is a link.
export const isPhotoUrl = (url: string) => /\/storage\/v1\/object\/.*\/board-photos\//.test(str(url))
const APP_HOSTS = ['lighthouse-stay.vercel.app']
/**
 * A link someone pasted, made safe to store and open: a page in Lighthouse becomes its path
 * ("/glitches?id=…"), anything else must be a plain http(s) address. null when it is neither.
 */
export function cleanLink(raw: unknown, extraHosts: string[] = []): { url: string; inApp: boolean } | null {
  const s = str(raw).trim().slice(0, 600)
  if (!s || /\s/.test(s)) return null
  if (s.startsWith('//')) return null
  if (s.startsWith('/')) return { url: s, inApp: true }
  let u: URL
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (!u.hostname.includes('.')) return null
  if (APP_HOSTS.concat(extraHosts).includes(u.hostname.toLowerCase())) return { url: (u.pathname || '/') + u.search + u.hash, inApp: true }
  return { url: u.toString(), inApp: false }
}
const PAGE_WORD: Record<string, string> = {
  plan: 'Ops board', schedule: 'Schedule', team: 'Week plan', briefs: 'Briefs', checklist: 'Open & Close', maintenance: 'Maintenance', blocked: 'Blocked units', upkeep: 'Upkeep',
  glitches: 'Guest issue', claims: 'Claim', reviews: 'Review', inbox: 'Guest inbox', messages: 'Message', reservations: 'Reservation', listings: 'Listing', buildings: 'Property',
  channels: 'Channels', admin: 'Admin', orders: 'Order', requests: 'Request', 'clean-invoices': 'Invoice', 'owner-onboarding': 'Owner onboarding', onboarding: 'Unit setup', reports: 'Owner report',
  labor: 'Labor', 'lost-found': 'Lost & Found', 'guest-orders': 'Guest order', audits: 'Audit', walks: 'Inspection', photos: 'Photos', optimize: 'Listing optimizer', command: 'Today', tasks: BOARD_NAME,
}
/** What to call a link nobody named: the page for one of ours, the site for anything else. */
export function linkLabel(url: string): string {
  const s = str(url)
  if (s.startsWith('/')) { const seg = s.split(/[/?#]/).filter(Boolean)[0] || ''; return PAGE_WORD[seg] || (seg ? seg.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Lighthouse') }
  try { return new URL(s).hostname.replace(/^www\./, '') } catch { return 'Link' }
}

// ── Offline listings: what the channel check found ──────────────────────────────────────────────
export type SnapshotLite = { at?: string; cells: Record<string, string>; units: Record<string, { name: string; building: string; market: string; active: boolean }> }
export type OfflineItem = { listingId: string; ref: string; unit: string; building: string; market: string; title: string; priority: string; none: boolean; channels: { key: string; label: string; verdict: string }[] }
/** A channel that had the listing and is not selling it. "Never connected" on one channel is a gap, not an outage. */
const NOT_SELLING = ['delisted', 'suspended', 'failed', 'disconnected']
const SELLING = ['live', 'stale']
const VERDICT_WORD: Record<string, string> = { delisted: 'page removed', suspended: 'suspended', failed: 'sync failed', disconnected: 'disconnected' }
export const OFFLINE_REF = 'offline:'
/** A listing named with a leading "!" is a test listing. */
const isTest = (name: string) => /^\s*!/.test(str(name))

/**
 * The listings that belong on the board, from the channel check's snapshot:
 *   - on NO channel at all (nothing live anywhere): urgent, it cannot be booked;
 *   - not selling on a main channel it was connected to (Airbnb, Booking.com, Vrbo, Expedia).
 * A listing that was simply never connected to one of the four is left to the Channels page: half the
 * portfolio is not on Expedia by choice, and a board row for each would bury the real outages.
 */
export function offlineFromSnapshot(snap: SnapshotLite | null): OfflineItem[] {
  if (!snap || !snap.cells || !snap.units) return []
  const out: OfflineItem[] = []
  for (const id of Object.keys(snap.units)) {
    const u = snap.units[id]
    if (!u || !u.active || isTest(u.name)) continue
    const all = CHANNELS.map(c => ({ key: c.key as string, v: str(snap.cells[id + ':' + c.key]) }))
    if (!all.some(c => c.v)) continue                              // the check never saw this listing: say nothing
    const anyLive = all.some(c => SELLING.includes(c.v))
    const down = all.filter(c => (MAJOR_KEYS as string[]).includes(c.key) && NOT_SELLING.includes(c.v)).map(c => ({ key: c.key, label: CHANNEL_LABEL[c.key] || c.key, verdict: c.v }))
    if (anyLive && !down.length) continue
    const what = down.map(c => `${c.label} (${VERDICT_WORD[c.verdict] || c.verdict})`).join(', ')
    const title = !anyLive ? `${u.name}: not on any channel${what ? '. ' + what : ''}` : `${u.name}: offline on ${what}`
    out.push({ listingId: id, ref: OFFLINE_REF + id, unit: u.name, building: u.building, market: u.market, none: !anyLive, channels: down,
      title: title.slice(0, 300), priority: !anyLive ? 'urgent' : down.some(c => c.key === 'airbnb2') ? 'high' : 'normal' })
  }
  return out.sort((a, b) => priRank(a.priority) - priRank(b.priority) || a.unit.localeCompare(b.unit, undefined, { numeric: true }))
}

export type AutoRow = { id: string; ref: string; status: string; title: string }
export type OfflinePlan = { insert: OfflineItem[]; retitle: { id: string; title: string }[]; close: { id: string; ref: string }[]; release: { id: string; ref: string }[] }
/**
 * What to change on the board so it matches the listings that are offline now.
 *   - offline and no row              → add one
 *   - offline and an open row         → keep it (its title follows the channels; a person's priority, owner, date and notes stay)
 *   - offline and a row a person closed → leave it closed: they dealt with it, or it is offline on purpose
 *   - back online and an open row     → close it, and free its key
 *   - back online and a closed row    → free its key, so the next outage is a new row
 * `stamp` is added to a freed key; the key is unique on the table.
 */
export function planOfflineSync(items: OfflineItem[], rows: AutoRow[], stamp: string): OfflinePlan {
  const live = rows.filter(r => r.ref.startsWith(OFFLINE_REF) && r.ref.split(':').length === 2)
  const byRef = new Map(live.map(r => [r.ref, r] as [string, AutoRow]))
  const want = new Set(items.map(i => i.ref))
  const plan: OfflinePlan = { insert: [], retitle: [], close: [], release: [] }
  for (const it of items) {
    const r = byRef.get(it.ref)
    if (!r) plan.insert.push(it)
    else if (r.status !== 'done' && r.title !== it.title) plan.retitle.push({ id: r.id, title: it.title })
  }
  for (const r of live) {
    if (want.has(r.ref)) continue
    const freed = { id: r.id, ref: r.ref + ':' + stamp }
    if (r.status === 'done') plan.release.push(freed); else plan.close.push(freed)
  }
  return plan
}
/** A snapshot older than this is not trusted to close rows: a check that stopped running proves nothing. */
export const SNAPSHOT_MAX_AGE_H = 72
export const snapshotFresh = (snap: SnapshotLite | null, now = Date.now()) => !!snap && !!snap.at && now - Date.parse(snap.at) < SNAPSHOT_MAX_AGE_H * 3600_000 && Object.keys(snap.units || {}).length > 0

// ── Organizing the list ─────────────────────────────────────────────────────────────────────────
export type RowLite = { id: string; lane: string; title: string; done: boolean; priority: string; due: string | null; property: string | null; assignees: string[] }
export type GroupBy = 'due' | 'person' | 'property' | 'priority' | 'kind'
export const GROUP_BYS: { key: GroupBy; label: string }[] = [{ key: 'due', label: 'Due date' }, { key: 'person', label: 'Person' }, { key: 'property', label: 'Property' }, { key: 'priority', label: 'Priority' }, { key: 'kind', label: 'Kind' }]
export type Group<T> = { key: string; title: string; late?: boolean; rows: T[] }

/** Late first, then soonest, then most urgent, then by name: the one order every list uses. */
export function sortOpen<T extends RowLite>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || priRank(a.priority) - priRank(b.priority) || a.title.localeCompare(b.title, undefined, { numeric: true }))
}

export function groupRows<T extends RowLite>(rows: T[], by: GroupBy, today: string, nameOf: (email: string) => string = e => e): Group<T>[] {
  const sorted = sortOpen(rows)
  const wk = addDays(today, 7)
  let groups: Group<T>[]
  if (by === 'due') groups = [
    { key: 'late', title: 'Late', late: true, rows: sorted.filter(i => !!i.due && i.due < today) },
    { key: 'today', title: 'Today', rows: sorted.filter(i => i.due === today) },
    { key: 'week', title: 'Next 7 days', rows: sorted.filter(i => !!i.due && i.due > today && i.due <= wk) },
    { key: 'later', title: 'Later', rows: sorted.filter(i => !!i.due && i.due > wk) },
    { key: 'none', title: 'No date', rows: sorted.filter(i => !i.due) },
  ]
  else if (by === 'priority') groups = PRI_ORDER.map(p => ({ key: 'pri:' + p, title: p.charAt(0).toUpperCase() + p.slice(1), late: p === 'urgent', rows: sorted.filter(i => priOf(i.priority) === p) }))
  else if (by === 'kind') groups = LANES.map(l => ({ key: 'kind:' + l, title: l as string, rows: sorted.filter(i => laneOf(i.lane) === l) }))
  else if (by === 'property') {
    const names = Array.from(new Set(sorted.map(i => i.property || ''))).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    groups = names.map(p => ({ key: 'prop:' + p, title: p, rows: sorted.filter(i => i.property === p) }))
    groups.push({ key: 'prop:', title: 'No property', rows: sorted.filter(i => !i.property) })
  } else {
    // By person: nobody first (it needs a name), then whoever carries the most. A row with two people is under both.
    const who = Array.from(new Set(sorted.flatMap(i => i.assignees)))
    const each = who.map(e => ({ key: 'who:' + e, title: nameOf(e), rows: sorted.filter(i => i.assignees.includes(e)) })).sort((a, b) => b.rows.length - a.rows.length || a.title.localeCompare(b.title))
    groups = [{ key: 'who:', title: 'No owner', late: true, rows: sorted.filter(i => !i.assignees.length) }, ...each]
  }
  return groups.filter(g => g.rows.length > 0)
}

// ── What the briefs read ────────────────────────────────────────────────────────────────────────
export type BriefPick<T> = { late: T[]; today: T[]; soon: T[]; pending: number; noOwner: number; offline: number }
/**
 * The board, for one day's brief. Future projects stay off it. An offline listing is counted in
 * `offline` and only listed when someone gave it a due date.
 *   late     due before the day, most days late first
 *   today    due that day
 *   soon     due in the three days after
 *   pending  everything open that a person owes (tasks, projects, vendors), dated or not
 */
export function boardForBrief<T extends RowLite>(rows: T[], day: string): BriefPick<T> {
  const open = rows.filter(r => !r.done && laneOf(r.lane) !== 'Future projects')
  const owed = open.filter(r => laneOf(r.lane) !== AUTO_LANE)
  const dated = open.filter(r => !!r.due)
  const byUrgency = (a: T, b: T) => priRank(a.priority) - priRank(b.priority) || a.title.localeCompare(b.title)
  return {
    late: dated.filter(r => r.due! < day).sort((a, b) => a.due!.localeCompare(b.due!) || byUrgency(a, b)),
    today: dated.filter(r => r.due === day).sort(byUrgency),
    soon: dated.filter(r => r.due! > day && r.due! <= addDays(day, 3)).sort((a, b) => a.due!.localeCompare(b.due!) || byUrgency(a, b)),
    pending: owed.length,
    noOwner: owed.filter(r => !r.assignees.length).length,
    offline: open.filter(r => laneOf(r.lane) === AUTO_LANE).length,
  }
}
