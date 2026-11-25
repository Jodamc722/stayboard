// THE CALENDAR LINK — Guesty ⇄ Cloudbeds, room by room (Jon, 2026-11-24: "would it be possible to sync
// Guesty calendar with Cloudbeds? … if those virtual rooms get booked, block that virtual room in
// Cloudbeds; if there's a block in Cloudbeds for that virtual room, block the calendar in Guesty … this
// would have to be instant" · 2026-11-25: "this should be a trigger … instant … have Adam audit this …
// prevent failures … double bookings can disrupt everything").
//
// THE CONNECTIONS
//   a Botanica unit        one Guesty listing whose name carries a room number ("Botanica 1001")
//   the same room          in Cloudbeds twice: the physical room "1001" (inside a shared room type) and a
//                          VIRTUAL room, a room type of its own named "1001" — the one sold on the channels.
//                          Cloudbeds links the pair: blocking one blocks the other.
//   so                     room number → { Guesty listing id, Cloudbeds virtual room id, physical room id }
//
// ONE RULE, RUN FOR ONE ROOM OVER A STRETCH OF NIGHTS (reconcileRoom):
//   a night Guesty holds (a booking, or a block somebody made there)        → a block on the room in Cloudbeds
//   a night Cloudbeds holds (a booking in the room, or a block made there)   → the night closed in Guesty
//   a block THIS FILE made whose reason has gone                             → removed
// What this file makes is marked ("Lighthouse link" in the Cloudbeds reason and the Guesty note), so it
// never mistakes its own block for the other side's booking. A night with a GUEST on both sides is a double
// booking: reported at once, nothing written.
//
// THE TRIGGER. Guesty and Cloudbeds each call a webhook the moment a booking or a block changes. The webhook
// runs the rule for just the nights that changed (a few seconds), then for the whole year behind it.
//
// WHAT KEEPS IT FROM FAILING
//   never trusts a message     a webhook only says "look"; every decision is made from a fresh read of both systems
//   never acts on a bad read   if Guesty or Cloudbeds answers short, nothing is written (an empty answer would
//                              otherwise look like "no bookings" and take our blocks off)
//   one at a time per room     a lock, so two messages about the same booking cannot write two blocks
//   every write is retried     three tries, then the room is marked "pending"
//   every write is checked     the room is read again afterwards; if it does not show what was written → pending + alert
//   pending is retried         every five minutes until it goes through, and the half-hourly sync re-checks every linked room
//   a ceiling on closing       it will not close more than CLOSE_CAP nights of one Guesty calendar in a run
//   only its own blocks        it never removes or edits a block it did not make
//   the audit                  every half hour ALL Botanica rooms are compared (written to nothing): double bookings,
//                              nights one side has sold that the other still offers, linked rooms out of step. Adam
//                              reads it (his calendar_link tool) and the Cloudbeds & feeds page shows it.
//
// SAFE BY DEFAULT: it only ever writes for rooms switched on in the list, and it ignores Cloudbeds blocks whose
// reason is on the ignore list — today the hotel's blanket "AIRBNB" blocks.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getSettingFresh, setSetting } from '../app-settings'
import { cbGet, cbPostV, cbDeleteV } from './cloudbeds'
import { botanicaListings } from './guesty-bridge'
import { getMultiCalendar, guestyWrite, isOpsBlock, type MultiCalDay } from '../guesty'

export const MARK = 'Lighthouse link'
/** How far ahead the link looks: a year covers every booking Guesty can hold. */
export const HORIZON_DAYS = 365
/** The most nights of one Guesty calendar a single run may close. Past it, nothing is written and a person is told. */
export const CLOSE_CAP = 120
const KEY = 'garden_calendar_link'
const DAY = 86400000
const D = /^\d{4}-\d{2}-\d{2}$/
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const ms = (ymd: string) => Date.parse(ymd + 'T00:00:00Z')
const s = (v: any) => (v == null ? '' : String(v))
const num = (name: string) => (s(name).match(/\b(\d{3,4})\b/) || [])[1] || ''
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const sleep = (n: number) => new Promise(r => setTimeout(r, n))

export type Pending = { since: string; tries: number; error: string }
export type AuditItem = { room: string; from: string; to: string; kind: 'double' | 'guesty_open' | 'cloudbeds_open' | 'drift'; detail: string }
export type Audit = { at: string; rooms: number; nights: number; ok: boolean; counts: Record<string, number>; items: AuditItem[]; errors: string[]; ms: number }
export type LinkSettings = { rooms: string[]; ignore: string[]; log: { at: string; room: string; what: string; by: string }[]; alertTo: string[]; alerted: string[]; pending: Record<string, Pending>; audit: Audit | null }
export type LinkedRoom = { room: string; listingId: string; listingName: string; virtualId: string | null; physicalId: string | null; virtualTypeId: string | null }
export type Night = { date: string; guesty: 'free' | 'booked' | 'blocked' | 'ours'; cloudbeds: 'free' | 'booked' | 'blocked' | 'ours' | 'ignored'; detail?: string }

export async function linkSettings(): Promise<LinkSettings> {
  const v = await getSettingFresh<Partial<LinkSettings> | null>(KEY, null).catch(() => null)
  return {
    rooms: Array.isArray(v?.rooms) ? v!.rooms!.map(String) : [], ignore: Array.isArray(v?.ignore) ? v!.ignore!.map(String) : ['AIRBNB'], log: Array.isArray(v?.log) ? v!.log! : [],
    alertTo: Array.isArray(v?.alertTo) ? v!.alertTo!.map(String) : [], alerted: Array.isArray(v?.alerted) ? v!.alerted!.map(String) : [],
    pending: v?.pending && typeof v.pending === 'object' ? v.pending as Record<string, Pending> : {}, audit: (v?.audit as Audit) || null,
  }
}
/** Read, change, write — the settings row is small and written by few things; every writer goes through here. */
async function patch(f: (cur: LinkSettings) => Partial<LinkSettings>): Promise<LinkSettings> {
  const cur = await linkSettings(), next = { ...cur, ...f(cur) }
  await setSetting(KEY, next, 'calendar-link')
  return next
}
const note = (room: string, what: string, by: string) => patch(c => ({ log: [{ at: new Date().toISOString(), room, what: what.slice(0, 600), by }, ...c.log].slice(0, 120) })).catch(() => null)
export async function setLinkedRooms(rooms: string[], by: string): Promise<LinkSettings> {
  const all = await roomMap()
  const ok = Array.from(new Set(rooms.map(String))).filter(r => all[r]?.virtualId || all[r]?.physicalId)
  return patch(c => ({ rooms: ok, pending: Object.fromEntries(Object.entries(c.pending).filter(([r]) => ok.includes(r))), log: [{ at: new Date().toISOString(), room: ok.join(', ') || '—', what: 'linked rooms set', by }, ...c.log].slice(0, 120) }))
}

/** room number → the Guesty listing and the two Cloudbeds rooms. Only rooms that have a Botanica listing. */
export async function roomMap(): Promise<Record<string, LinkedRoom>> {
  const [units, { data }] = await Promise.all([botanicaListings(), supabaseAdmin().from('garden_rooms').select('id,name,room_type_id,virtual:raw->>isVirtual')])
  const out: Record<string, LinkedRoom> = {}
  for (const u of units) { const n = num(u.name); if (n) out[n] = { room: n, listingId: u.id, listingName: u.name, virtualId: null, physicalId: null, virtualTypeId: null } }
  for (const r of ((data || []) as any[])) { const o = out[s(r.name)]; if (!o) continue; if (r.virtual === 'true' || r.virtual === true) { o.virtualId = s(r.id); o.virtualTypeId = s(r.room_type_id) || s(r.id).replace(/-\d+$/, '') || null } else o.physicalId = s(r.id) }
  return out
}

// ── One at a time per room ─────────────────────────────────────────────────────────────────────
// app_settings.key is unique, so INSERTING a row is an atomic "is anyone else here?": the second insert fails.
const lockKey = (room: string) => `${KEY}_lock_${room}`
async function lock(room: string): Promise<boolean> {
  const db = supabaseAdmin()
  const row = { key: lockKey(room), value: JSON.stringify({ at: new Date().toISOString() }), updated_by: 'calendar-link', updated_at: new Date().toISOString() }
  for (let i = 0; i < 40; i++) {                       // up to ~20 seconds: a run is a few seconds
    const { error } = await db.from('app_settings').insert(row)
    if (!error) return true
    // A lock nobody released (a run that died) is taken over after 90 seconds.
    const { data } = await db.from('app_settings').select('updated_at').eq('key', row.key).maybeSingle()
    if (data?.updated_at && Date.now() - Date.parse(data.updated_at) > 90_000) await db.from('app_settings').delete().eq('key', row.key).lt('updated_at', new Date(Date.now() - 90_000).toISOString())
    else await sleep(500)
  }
  return false
}
const unlock = (room: string) => supabaseAdmin().from('app_settings').delete().eq('key', lockKey(room)).then(() => null, () => null)

/** Three tries, a little longer apart each time. */
async function attempt<T>(label: string, f: () => Promise<T>): Promise<T> {
  let last: any
  for (let i = 0; i < 3; i++) { try { return await f() } catch (e) { last = e; await sleep(400 * (i + 1) * (i + 1)) } }
  throw new Error(`${label}: ${String(last?.message || last).slice(0, 200)}`)
}

// ── Cloudbeds ───────────────────────────────────────────────────────────────────────────────────
type CbBlock = { id: string; reason: string; type: string; start: string; end: string; roomIds: string[] }
/** Cloudbeds blocks touching [from, to], read live (35 days a call is Cloudbeds' limit; four calls at a time). */
async function cbBlocks(from: string, to: string): Promise<CbBlock[]> {
  const seen = new Map<string, CbBlock>()
  const wins: [string, string][] = []
  for (let a = ms(from); a <= ms(to); a += 34 * DAY) wins.push([iso(a), iso(Math.min(ms(to), a + 33 * DAY))])
  for (let i = 0; i < wins.length; i += 4) {
    const got = await Promise.all(wins.slice(i, i + 4).map(([x, y]) => attempt('Cloudbeds getRoomBlocks', () => cbGet<any>('getRoomBlocks', { startDate: x, endDate: y }))))
    for (const { data } of got) for (const x of (Array.isArray(data) ? data : [data]).flatMap((y: any) => Array.isArray(y?.roomBlocks) ? y.roomBlocks : [y])) {
      const id = s(x?.roomBlockID || x?.id); if (!id) continue
      seen.set(id, { id, reason: s(x.roomBlockReason || x.reason), type: s(x.roomBlockType || x.type), start: s(x.startDate).slice(0, 10), end: s(x.endDate).slice(0, 10), roomIds: (Array.isArray(x.rooms) ? x.rooms : []).map((r: any) => s(r.roomID)).filter(Boolean) })
    }
  }
  return Array.from(seen.values())
}
/** A block on one room in Cloudbeds. The virtual room is the one blocked; Cloudbeds carries it to the linked physical room. */
export async function cbBlockRoom(roomId: string, from: string, to: string, reason: string): Promise<string | null> {
  const j: any = await cbPostV('v1.3', 'postRoomBlock', { roomBlockType: 'blocked_dates', roomBlockReason: reason.slice(0, 120), startDate: from, endDate: to, 'rooms[0][roomID]': roomId })
  return s(j?.roomBlockID || j?.data?.roomBlockID) || null
}
export async function cbUnblock(blockId: string): Promise<void> {
  // Cloudbeds' reference shows deleteRoomBlock under DELETE and, in its menu, under POST: try one, then the other.
  try { await cbDeleteV('v1.3', 'deleteRoomBlock', { roomBlockID: blockId }) }
  catch { await cbPostV('v1.3', 'deleteRoomBlock', { roomBlockID: blockId }) }
}
/** Cloudbeds' side for the whole property, read once and shared by every room in a run. */
export type CbRes = { id: string; status: string; checkIn: string | null; checkOut: string | null; roomNames: string[]; raw: any }
export type CbSide = { blocks: CbBlock[]; res: CbRes[]; at: number }
/**
 * Cloudbeds bookings arriving OR departing in [from, to], read live. Both questions are asked at the same time and
 * without guest details (the link needs rooms and dates only), which is what makes the instant pass quick. A full
 * last page means the answer was cut short, and that is an error — never "no more bookings".
 */
async function cbStays(from: string, to: string): Promise<CbRes[]> {
  const seen = new Map<string, CbRes>()
  const pull = async (axis: Record<string, string>) => {
    for (let page = 1; ; page++) {
      if (page > 40) throw new Error('Cloudbeds has more bookings than the link reads in one go — nothing was changed.')
      const { data } = await attempt('Cloudbeds getReservations', () => cbGet<any[]>('getReservations', { ...axis, includeAllRooms: 'true', pageNumber: page, pageSize: 100 }))
      const rows = Array.isArray(data) ? data : []
      for (const r of rows) { const id = s(r?.reservationID); if (id) seen.set(id, { id, status: s(r?.status).toLowerCase(), checkIn: s(r?.startDate).slice(0, 10) || null, checkOut: s(r?.endDate).slice(0, 10) || null, roomNames: (Array.isArray(r?.rooms) ? r.rooms : []).map((x: any) => s(x?.roomName)).filter(Boolean), raw: r }) }
      if (rows.length < 100) break
    }
  }
  await Promise.all([pull({ checkInFrom: from, checkInTo: to }), pull({ checkOutFrom: from, checkOutTo: to })])
  // Bookings that come back with no room lines at all mean Cloudbeds left them off the answer: every room would look empty.
  const all = Array.from(seen.values())
  if (all.length && !all.some(x => Array.isArray(x.raw?.rooms) && x.raw.rooms.length)) throw new Error('Cloudbeds returned bookings without their rooms — nothing was changed.')
  return Array.from(seen.values())
}
/**
 * Cloudbeds can only be asked for bookings by arrival date or by departure date, so a stay that began before the
 * window and ends after it would be missed by both questions. The window is therefore widened by `pad` days each
 * side before asking (the longest stay on the books is 28 nights; the pad is 35 to 45).
 */
export async function readCloudbeds(from: string, to: string, pad?: number): Promise<CbSide> {
  const span = Math.round((ms(to) - ms(from)) / DAY), p = pad ?? Math.max(0, Math.min(45, 370 - span))
  const [blocks, res] = await Promise.all([cbBlocks(from, to), cbStays(iso(ms(from) - p * DAY), iso(ms(to) + (p + 1) * DAY))])
  return { blocks, res, at: Date.now() }
}

// ── Guesty ──────────────────────────────────────────────────────────────────────────────────────
const gyPath = (listingId: string) => `/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}`
/** Close nights in Guesty (endDate is the last night closed). */
export async function gyBlock(listingId: string, from: string, to: string, text: string): Promise<void> { await guestyWrite(gyPath(listingId), { startDate: from, endDate: to, status: 'unavailable', blockReason: 'Other', note: text.slice(0, 300) }, 'PUT') }
export async function gyOpen(listingId: string, from: string, to: string): Promise<void> { await guestyWrite(gyPath(listingId), { startDate: from, endDate: to, status: 'available' }, 'PUT') }
export type GySide = Record<string, Record<string, MultiCalDay>>
/** Guesty calendars for several listings at once: listing id → date → day. */
export async function readGuesty(listingIds: string[], from: string, to: string): Promise<GySide> {
  const out: GySide = {}
  for (const d of await getMultiCalendar(listingIds, from, to)) (out[d.listingId] = out[d.listingId] || {})[d.date] = d
  return out
}

const isOurs = (t: string | null | undefined) => s(t).startsWith(MARK)
/** Runs of consecutive dates → [first, last] pairs. */
function runs(dates: string[]): [string, string][] {
  const out: [string, string][] = []
  for (const d of dates.slice().sort()) { const last = out[out.length - 1]; if (last && ms(d) - ms(last[1]) === DAY) last[1] = d; else out.push([d, d]) }
  return out
}

type Pre = { cb?: CbSide; gy?: GySide; map?: Record<string, LinkedRoom>; st?: LinkSettings; pad?: number }
/** How a run behaves. person: someone pressed the button (no ceiling). protect: only ever adds blocks and closes nights, never releases. */
export type RunOpts = { person?: boolean; protect?: boolean }
const RES_KEYS = ['r', 'reserved', 'reservation', 'booked']
/** A Guesty night with a guest in it, whether or not Guesty attached the reservation id to the day. */
const gyBooked = (g: MultiCalDay) => !!g.reservationId || g.status === 'booked' || g.status === 'reserved' || Object.keys(g.blocks || {}).some(k => RES_KEYS.includes(k.toLowerCase()) && !!(g.blocks as any)[k])
type Stay = { id: string; from: string; to: string; unassigned: boolean }
/**
 * The Cloudbeds bookings that hold THIS room, taken from each booking's own room lines (a booking can hold several
 * rooms, each with its own dates). A line counts when it names either of the room's two Cloudbeds ids, or the room
 * number, or — for a booking not yet given a room — the virtual room's own room type, which has only this room in it.
 */
function staysFor(r: LinkedRoom, cb: CbSide): Stay[] {
  const ids = [r.virtualId, r.physicalId].filter(Boolean) as string[], out: Stay[] = []
  for (const x of cb.res) {
    if (x.status === 'canceled' || x.status === 'cancelled' || x.status === 'no_show') continue
    const lines: any[] = Array.isArray((x as any).raw?.rooms) ? (x as any).raw.rooms : []
    if (!lines.length) { if ((x.roomNames || []).map(String).includes(r.room) && x.checkIn && x.checkOut) out.push({ id: x.id, from: x.checkIn, to: x.checkOut, unassigned: false }); continue }
    for (const e of lines) {
      if (/cancel|no_show/i.test(s(e?.roomStatus))) continue
      const rid = s(e?.roomID), named = (rid && ids.includes(rid)) || (s(e?.roomName) && s(e?.roomName) === r.room)
      const byType = !rid && !s(e?.roomName) && ((!!r.virtualTypeId && s(e?.roomTypeID) === r.virtualTypeId) || s(e?.roomTypeName) === r.room)
      if (!named && !byType) continue
      const a = s(e?.roomCheckIn).slice(0, 10) || x.checkIn, b = s(e?.roomCheckOut).slice(0, 10) || x.checkOut
      if (a && b && D.test(a) && D.test(b)) out.push({ id: x.id, from: a, to: b, unassigned: byType })
    }
  }
  return out
}
/** Both calendars for one room, night by night, read live from both systems. Throws if either side answers short. */
export async function readRoom(room: string, from: string, to: string, pre?: Pre): Promise<{ room: LinkedRoom; nights: Night[]; blocks: CbBlock[]; ours: CbBlock[] }> {
  if (!D.test(from) || !D.test(to) || to < from) throw new Error('from and to (YYYY-MM-DD) are needed')
  if ((ms(to) - ms(from)) / DAY > 400) throw new Error('400 nights at most at a time')
  const map = pre?.map || await roomMap(), r = map[room]
  if (!r) throw new Error(`Room ${room} has no Botanica listing in Guesty.`)
  const cbIds = [r.virtualId, r.physicalId].filter(Boolean) as string[]
  if (!cbIds.length) throw new Error(`Room ${room} was not found in Cloudbeds.`)
  const st = pre?.st || await linkSettings()
  const want = Math.round((ms(to) - ms(from)) / DAY) + 1
  const full = (g?: GySide) => Object.keys(g?.[r.listingId] || {}).filter(d => d >= from && d <= to).length >= want
  // A shared Guesty read that is missing this room's nights is not trusted: the room is read on its own instead.
  const [cb, gy] = await Promise.all([pre?.cb ? Promise.resolve(pre.cb) : readCloudbeds(from, to, pre?.pad), pre?.gy && full(pre.gy) ? Promise.resolve(pre.gy) : attempt('Guesty calendar', async () => { const g = await readGuesty([r.listingId], from, to); if (!full(g)) throw new Error(`Guesty answered ${Object.keys(g[r.listingId] || {}).length} of ${want} nights for room ${room} — nothing was changed`); return g })])
  const days = gy[r.listingId] || {}
  // A SHORT ANSWER IS NOT AN EMPTY CALENDAR. Guesty must have a day for every night asked for; if it does not,
  // the read failed, and acting on it would take our Cloudbeds blocks off nights that are really booked.
  if (!full(gy)) throw new Error(`Guesty answered short for room ${room} — nothing was changed.`)
  const blocks = cb.blocks.filter(b => b.roomIds.some(id => cbIds.includes(id)))
  const stays = staysFor(r, cb)
  const ignored = (b: CbBlock) => st.ignore.some(x => x && b.reason.toLowerCase().includes(x.toLowerCase()))
  const nights: Night[] = []
  for (let t = ms(from); t <= ms(to); t += DAY) {
    const date = iso(t), g = days[date]
    const gOurs = isOurs(g.note) || g.refs.some(x => isOurs(x.note))
    const gb = gyBooked(g)
    const guesty: Night['guesty'] = gb ? 'booked' : gOurs ? 'ours' : isOpsBlock(g) ? 'blocked' : 'free'
    const stay = stays.find(x => x.from <= date && x.to > date)
    const on = blocks.filter(b => b.start <= date && b.end >= date)
    const cloudbeds: Night['cloudbeds'] = stay ? 'booked' : on.some(b => !isOurs(b.reason) && !ignored(b)) ? 'blocked' : on.some(b => isOurs(b.reason)) ? 'ours' : on.length ? 'ignored' : 'free'
    nights.push({ date, guesty, cloudbeds, detail: [stay ? `Cloudbeds booking ${stay.id}${stay.unassigned ? ' (no room given yet)' : ''}` : '', on.map(b => `Cloudbeds block "${b.reason || b.type}"`).join(', '), gb ? 'Guesty booking' : guesty === 'blocked' ? `Guesty block${g.refs[0]?.reason ? ' "' + g.refs[0].reason + '"' : ''}` : ''].filter(Boolean).join(' · ') || undefined })
  }
  return { room: r, nights, blocks, ours: blocks.filter(b => isOurs(b.reason)) }
}

const gHolds = (n: Night) => n.guesty === 'booked' || n.guesty === 'blocked'
const cHolds = (n: Night) => n.cloudbeds === 'booked' || n.cloudbeds === 'blocked'
// A DOUBLE BOOKING is a guest on each side for the same night. A booking on one side and a block made by hand on
// the other is the opposite: somebody already closed it, which is what the link would have done.
const both = (n: Night) => n.guesty === 'booked' && n.cloudbeds === 'booked'
/**
 * What the rule says should be done for these nights (nothing is done here).
 * `protect` (the instant pass over a few nights): only ever ADD — block Cloudbeds, close Guesty. Releasing waits for
 * the whole-year pass, which sees everything. A block of ours that reaches outside the nights being looked at is
 * never removed here either: taking it off would open nights nobody looked at.
 */
function plan(R: { nights: Night[]; ours: CbBlock[] }, from: string, to: string, protect = false) {
  const today = todayET()
  // CLOUDBEDS REFUSES A BLOCK ON A NIGHT THAT IS ALREADY BLOCKED (tested live, 2026-11-25). So a night under one of
  // the hotel's blanket blocks needs nothing from us and gets nothing; and a block of ours is never laid over another.
  const wanted = new Set(R.nights.filter(n => gHolds(n) && (n.cloudbeds === 'free' || n.cloudbeds === 'ours')).map(n => n.date))
  const inWin = R.ours.filter(b => b.end >= from && b.start <= to)
  const edge = (b: CbBlock) => (b.start < from && from > today) || b.end > to
  const nightsOf = (b: CbBlock) => { const c: string[] = []; for (let t = Math.max(ms(b.start), ms(from)); t <= Math.min(ms(b.end), ms(to)); t += DAY) c.push(iso(t)); return c }
  // A block of ours is kept while every night of it is still held in Guesty. One that covers a night no longer held
  // comes off, and what is still held under it goes straight back on. In `protect`, and for a block reaching outside
  // the nights being looked at, nothing comes off.
  const removeCb = protect ? [] : inWin.filter(b => !edge(b) && nightsOf(b).some(d => !wanted.has(d)))
  const kept = new Set<string>(); for (const b of inWin) if (!removeCb.includes(b)) for (const d of nightsOf(b)) kept.add(d)
  return {
    removeCb, addCb: runs(Array.from(wanted).filter(d => !kept.has(d))),
    close: runs(R.nights.filter(n => cHolds(n) && n.guesty === 'free').map(n => n.date)),
    open: protect ? [] as [string, string][] : runs(R.nights.filter(n => !cHolds(n) && n.guesty === 'ours').map(n => n.date)),
    conflicts: R.nights.filter(both),
  }
}
const count = (rs: [string, string][]) => rs.reduce((a, [x, y]) => a + (ms(y) - ms(x)) / DAY + 1, 0)

async function setPending(room: string, error: string | null) {
  await patch(c => { const p = { ...c.pending }; if (error == null) delete p[room]; else p[room] = { since: p[room]?.since || new Date().toISOString(), tries: (p[room]?.tries || 0) + 1, error: error.slice(0, 240) }; return { pending: p } }).catch(() => null)
}
/** Tell a person, once per subject (an in-app notice). */
async function alert(subject: string, title: string, body: string): Promise<void> {
  const st = await linkSettings()
  if (st.alerted.includes(subject)) return
  await patch(c => ({ alerted: [subject, ...c.alerted].slice(0, 400) }))
  const { notify } = await import('../notify')
  await notify(st.alertTo.length ? st.alertTo : ['jon@stay-hospitality.com'], { kind: 'calendar_link', title, body, link: '/garden/users?tab=settings&panel=feeds', entity: { type: 'calendar_link', id: subject } }).catch(() => null)
}

/**
 * Make each side show what the other holds, for one room. `dry` only says what it would do.
 * Locked per room, every write retried, the result read back; a failure marks the room pending and tells someone.
 *
 * A run handed a read made a moment ago (one read shared by every room in a pass) may use it to decide there is
 * NOTHING to do, or to ADD protection. It may never RELEASE on it: before a block comes off or a night reopens,
 * both systems are read again inside the lock.
 */
export async function reconcileRoom(room: string, from: string, to: string, by: string, dry = false, pre?: Pre, opts: RunOpts = {}): Promise<{ room: string; did: string[]; conflicts: string[]; nights: Night[]; ms: number; verified?: boolean }> {
  const t0 = Date.now(), base: Pre = { map: pre?.map, st: pre?.st, pad: opts.protect ? 35 : undefined }
  const says = (p: ReturnType<typeof plan>) => p.conflicts.map(n => `${n.date}: a booking on both sides (${n.detail || 'see both calendars'})`)
  if (dry) { const R = await readRoom(room, from, to, pre), p = plan(R, from, to, opts.protect); return { room, did: describe(room, p), conflicts: says(p), nights: R.nights, ms: Date.now() - t0 } }
  // The shared read, if it is under a minute old: when it shows nothing to do and no double booking, the room is done without a lock or a write.
  const shared = pre?.cb && pre?.gy && Date.now() - pre.cb.at < 60_000 ? pre : undefined
  if (shared) {
    try { const R = await readRoom(room, from, to, shared), p = plan(R, from, to, opts.protect); if (!describe(room, p).length && !p.conflicts.length) return { room, did: [], conflicts: [], nights: R.nights, ms: Date.now() - t0, verified: true } }
    catch { /* the room is read on its own below */ }
  }
  if (!(await lock(room))) { await setPending(room, 'busy: another run held the room for 20 seconds'); throw new Error(`Room ${room} is busy; it will be retried.`) }
  try {
    // Inside the lock the read is always fresh: what was read before the lock may be what the other run just changed.
    const R = await readRoom(room, from, to, base)
    const p = plan(R, from, to, opts.protect)
    const did = describe(room, p), conflicts = says(p)
    if (p.conflicts.length) await alert(`double|${room}|${p.conflicts[0].date}`, `Double booking: room ${room}, ${runs(p.conflicts.map(n => n.date)).map(([a, b]) => a === b ? a : `${a} → ${b}`).join(', ')}`, `Guesty and Cloudbeds each have a guest in room ${room} on ${p.conflicts.length === 1 ? 'this night' : 'these nights'}. ${p.conflicts[0].detail || ''} Nothing was changed; one of the two has to be moved.`)
    // THE CEILING, on anything that runs by itself: a run about to hold more than CLOSE_CAP nights on either side stops and asks a person.
    const closing = count(p.close), blocking = count(p.addCb) - p.removeCb.reduce((a, b) => a + (ms(b.end) - ms(b.start)) / DAY + 1, 0), releasing = p.removeCb.reduce((a, b) => a + (ms(b.end) - ms(b.start)) / DAY + 1, 0) - count(p.addCb) + count(p.open)
    if (!opts.person && (closing > CLOSE_CAP || blocking > CLOSE_CAP || releasing > CLOSE_CAP)) {
      const what = closing > CLOSE_CAP ? `close ${closing} nights of the Guesty calendar` : blocking > CLOSE_CAP ? `block ${blocking} more nights in Cloudbeds` : `release ${releasing} nights it was holding`
      await alert(`cap|${room}|${from}`, `Calendar link stopped: room ${room}`, `It was about to ${what} for room ${room}, more than the ${CLOSE_CAP} it may do by itself in one go. Nothing was written. If that is right (a newly linked room, a long hold), open Cloudbeds & feeds and press Refresh now; a person's Refresh has no ceiling.`)
      throw new Error(`Would ${what} (ceiling ${CLOSE_CAP}) — nothing was written.`)
    }
    const cbRoom = R.room.virtualId || R.room.physicalId!
    // Cloudbeds will not take two blocks on one night, so a block that has to shrink comes off first and what is still
    // held goes straight back on (about a second). If that second step fails the room is pending and retried.
    for (const b of p.removeCb) await attempt(`Cloudbeds unblock ${room} ${b.start}→${b.end}`, () => cbUnblock(b.id))
    for (const [a, b] of p.addCb) await attempt(`Cloudbeds block ${room} ${a}→${b}`, () => cbBlockRoom(cbRoom, a, b, `${MARK} · held in Guesty`))
    for (const [a, b] of p.close) await attempt(`Guesty close ${room} ${a}→${b}`, () => gyBlock(R.room.listingId, a, b, `${MARK} · held in Cloudbeds`))
    for (const [a, b] of p.open) await attempt(`Guesty open ${room} ${a}→${b}`, () => gyOpen(R.room.listingId, a, b))
    let nights = R.nights, verified = true
    if (did.length) {
      // READ IT BACK. What was written has to be there; if the rule would still do something, it did not take.
      const after = await readRoom(room, from, to, base), left = plan(after, from, to, opts.protect)
      nights = after.nights
      verified = !left.addCb.length && !left.removeCb.length && !left.close.length && !left.open.length
      await note(room, [...did, ...conflicts.map(c => 'DOUBLE BOOKING ' + c), verified ? '' : 'NOT CONFIRMED on read-back'].filter(Boolean).join(' · '), by)
      if (!verified) { await alert(`verify|${room}|${new Date().toISOString().slice(0, 13)}`, `Calendar link: room ${room} did not confirm`, `A change was written for room ${room} but reading it back did not show it. It is being retried; check the room in both systems.`); throw new Error('Written, but the read-back did not show it.') }
    } else if (conflicts.length) await note(room, conflicts.map(c => 'DOUBLE BOOKING ' + c).join(' · '), by)
    await setPendingIf(room)
    return { room, did, conflicts, nights, ms: Date.now() - t0, verified }
  } catch (e: any) {
    await setPending(room, String(e?.message || e))
    throw e
  } finally { await unlock(room) }
}
/** Clear a room's pending mark only if it has one (saves a write on every clean run). */
async function setPendingIf(room: string) { const st = await linkSettings(); if (st.pending[room]) await setPending(room, null) }
function describe(room: string, p: ReturnType<typeof plan>): string[] {
  return [
    ...p.addCb.map(([a, b]) => `Cloudbeds: blocked room ${room} ${a} → ${b} (held in Guesty)`), ...p.removeCb.map(b => `Cloudbeds: removed block ${b.start} → ${b.end}`),
    ...p.close.map(([a, b]) => `Guesty: closed ${a} → ${b} (held in Cloudbeds)`), ...p.open.map(([a, b]) => `Guesty: opened ${a} → ${b}`),
  ]
}

/**
 * Every linked room over [from, to] — the Refresh button, the half-hourly safety net and the Cloudbeds trigger.
 * Both systems are read ONCE for all the rooms; a room that read shows in step is done there and then. Only a room
 * with something to do takes its lock and reads again for itself.
 */
export async function reconcileLinked(by: string, days = HORIZON_DAYS, window?: { from: string; to: string }, opts: RunOpts = {}): Promise<{ rooms: number; did: string[]; conflicts: string[]; errors: string[] }> {
  const st = await linkSettings(), from = window?.from || todayET(), to = window?.to || iso(ms(from) + days * DAY)
  const did: string[] = [], conflicts: string[] = [], errors: string[] = []
  if (!st.rooms.length) return { rooms: 0, did, conflicts, errors }
  let map: Record<string, LinkedRoom>
  try { map = await roomMap() } catch (e: any) { return { rooms: st.rooms.length, did, conflicts, errors: [String(e?.message || e).slice(0, 200)] } }
  // If the shared read fails, each room still reads for itself (and fails safe by itself).
  const [cb, gy] = await Promise.all([readCloudbeds(from, to, opts.protect ? 35 : undefined).catch(() => undefined), readGuesty(st.rooms.map(r => map[r]?.listingId).filter(Boolean) as string[], from, to).catch(() => undefined)])
  for (let i = 0; i < st.rooms.length; i += 4) {
    await Promise.all(st.rooms.slice(i, i + 4).map(async room => {
      try { const r = await reconcileRoom(room, from, to, by, false, { map, st, cb, gy }, opts); did.push(...r.did.map(x => `${room}: ${x}`)); conflicts.push(...r.conflicts.map(x => `${room}: ${x}`)) }
      catch (e: any) { errors.push(`${room}: ${String(e?.message || e).slice(0, 160)}`) }
    }))
  }
  return { rooms: st.rooms.length, did, conflicts, errors }
}
/** Rooms a run failed on, tried again (every five minutes). After six failures a person is told. */
export async function retryPending(): Promise<{ tried: number; cleared: number }> {
  const st = await linkSettings(), rooms = Object.keys(st.pending).filter(r => st.rooms.includes(r))
  let cleared = 0
  const from = todayET(), to = iso(ms(from) + HORIZON_DAYS * DAY)
  for (const room of rooms) {
    try { await reconcileRoom(room, from, to, 'retry'); cleared++ }
    catch { const p = (await linkSettings()).pending[room]; if (p && p.tries >= 6) await alert(`stuck|${room}|${p.since}`, `Calendar link: room ${room} is not syncing`, `Room ${room} has failed ${p.tries} times since ${p.since}. Last error: ${p.error}. Until it clears, check the room's calendar in both Guesty and Cloudbeds by hand.`) }
  }
  return { tried: rooms.length, cleared }
}

/** The nights a message names, checked and padded a day each side. Anything odd → null, and the whole year is done instead. */
const hintWindow = (h?: { from?: string; to?: string } | null): { from: string; to: string } | null => {
  try {
    const t = todayET(), a = s(h?.from), b = s(h?.to)
    if (!D.test(a) || !D.test(b) || !Number.isFinite(ms(a)) || !Number.isFinite(ms(b)) || iso(ms(a)) !== a || iso(ms(b)) !== b) return null
    if (b < a || (ms(b) - ms(a)) / DAY > 370 || b < t) return null
    const from = iso(Math.max(ms(t), ms(a) - DAY)), to = iso(Math.min(ms(t) + HORIZON_DAYS * DAY, ms(b) + DAY))
    return to < from ? null : { from, to }
  } catch { return null }
}
/**
 * THE GUESTY TRIGGER. A booking or a calendar change on a listing: the nights named in the message are protected at
 * once (blocks added, never released), and `rest` (the whole year, which also releases what is no longer held) is
 * handed back for the caller to finish after it has answered Guesty. A message that does not say which listing it is
 * about is not dropped: every linked room is checked.
 */
export async function onGuestyEvent(listingId: string, hint?: { from?: string; to?: string } | null): Promise<{ room: string | null; fast?: string[]; rest?: () => Promise<unknown> }> {
  const st = await linkSettings(); if (!st.rooms.length) return { room: null }
  if (!listingId) return { room: 'all linked rooms', rest: () => reconcileLinked('guesty trigger').catch(() => null) }
  const map = await roomMap(), hit = Object.values(map).find(r => r.listingId === listingId)
  if (!hit || !st.rooms.includes(hit.room)) return { room: null }
  const from = todayET(), to = iso(ms(from) + HORIZON_DAYS * DAY), w = hintWindow(hint)
  const full = () => reconcileRoom(hit.room, from, to, 'guesty trigger', false, { map, st }).catch(() => null)
  if (!w) { await full(); return { room: hit.room } }
  let fast: string[] = []
  try { fast = (await reconcileRoom(hit.room, w.from, w.to, 'guesty trigger', false, { map, st }, { protect: true })).did } catch { /* marked pending; the full pass and the retry follow */ }
  return { room: hit.room, fast, rest: full }
}
/** THE CLOUDBEDS TRIGGER. Its messages do not name the room reliably, so every linked room is checked: the named nights first (protect only), then the year. */
export async function onCloudbedsEvent(hint?: { from?: string; to?: string } | null): Promise<number> {
  const st = await linkSettings(); if (!st.rooms.length) return 0
  const w = hintWindow(hint)
  if (w) await reconcileLinked('cloudbeds trigger', HORIZON_DAYS, w, { protect: true }).catch(() => null)
  await reconcileLinked('cloudbeds trigger')
  return st.rooms.length
}

/**
 * THE AUDIT (Jon: "have Adam audit this"). Every Botanica room, the next `days` nights, both systems read live and
 * NOTHING written: nights with a guest on both sides, nights one side has sold that the other still offers, and
 * linked rooms where the rule would still change something. Kept on the settings row for Adam and the page.
 */
export async function auditAll(days = 120): Promise<Audit> {
  const t0 = Date.now(), from = todayET(), to = iso(ms(from) + days * DAY)
  const items: AuditItem[] = [], errors: string[] = [], counts: Record<string, number> = { double: 0, guesty_open: 0, cloudbeds_open: 0, drift: 0 }
  let rooms = 0
  try {
    const [map, st] = await Promise.all([roomMap(), linkSettings()])
    const list = Object.values(map).filter(r => r.virtualId || r.physicalId)
    const [cb, gy] = await Promise.all([readCloudbeds(from, to), readGuesty(list.map(r => r.listingId), from, to)])
    for (const r of list) {
      try {
        const R = await readRoom(r.room, from, to, { cb, gy, map, st }); rooms++
        const linked = st.rooms.includes(r.room)
        const add = (kind: AuditItem['kind'], dates: string[], detail: string) => { for (const [a, b] of runs(dates)) { counts[kind] += (ms(b) - ms(a)) / DAY + 1; items.push({ room: r.room, from: a, to: b, kind, detail }) } }
        add('double', R.nights.filter(both).map(n => n.date), 'a guest on both sides')
        // Sold or held on one side, still on sale on the other. For a linked room that is drift; for an unlinked one it is the exposure the link exists to close.
        add(linked ? 'drift' : 'guesty_open', R.nights.filter(n => cHolds(n) && n.guesty === 'free').map(n => n.date), 'held in Cloudbeds, still open in Guesty')
        add(linked ? 'drift' : 'cloudbeds_open', R.nights.filter(n => gHolds(n) && n.cloudbeds === 'free').map(n => n.date), 'held in Guesty, nothing blocking it in Cloudbeds')
      } catch (e: any) { errors.push(`${r.room}: ${String(e?.message || e).slice(0, 120)}`) }
    }
    const linkedBad = items.filter(x => st.rooms.includes(x.room) && (x.kind === 'double' || x.kind === 'drift'))
    if (linkedBad.length) await alert(`audit|${linkedBad[0].room}|${linkedBad[0].from}|${linkedBad[0].kind}`, `Calendar link audit: ${linkedBad.length} problem${linkedBad.length === 1 ? '' : 's'} on linked rooms`, linkedBad.slice(0, 6).map(x => `Room ${x.room} ${x.from}${x.to !== x.from ? ' → ' + x.to : ''}: ${x.detail}`).join('. ') + '.')
  } catch (e: any) { errors.push(String(e?.message || e).slice(0, 200)) }
  const order = { double: 0, drift: 1, guesty_open: 2, cloudbeds_open: 3 } as Record<string, number>
  const audit: Audit = { at: new Date().toISOString(), rooms, nights: days, ok: !errors.length && !counts.double && !counts.drift, counts, items: items.sort((a, b) => order[a.kind] - order[b.kind] || a.from.localeCompare(b.from)).slice(0, 80), errors: errors.slice(0, 10), ms: Date.now() - t0 }
  await patch(() => ({ audit })).catch(() => null)
  return audit
}

const GY_EVENTS = ['reservation.new', 'reservation.updated', 'listing.calendar.updated']
/** Where the two "tell me at once" connections stand. */
export async function notificationState(): Promise<{ guesty: { connected: boolean; bookings: boolean; lastEventAt: string | null }; cloudbeds: { subscribed: boolean; lastEventAt: string | null } }> {
  const { getSetting } = await import('../app-settings')
  const [g, c] = await Promise.all([getSetting<any>('guesty_webhook', null).catch(() => null), getSetting<any>('garden_cb_webhook', null).catch(() => null)])
  return { guesty: { connected: !!g?.subscriptionId, bookings: !!g?.linkEvents, lastEventAt: g?.lastEventAt || null }, cloudbeds: { subscribed: !!c?.subscribedAt || !!c?.lastEventAt, lastEventAt: c?.lastEventAt || null } }
}
/** Add booking and calendar events to Lighthouse's existing Guesty subscription (it carries guest messages today). */
export async function enableGuestyEvents(by: string): Promise<{ events: string[] }> {
  const { listGuestyWebhooks } = await import('../guesty-webhooks')
  const cur = await getSettingFresh<any>('guesty_webhook', null)
  if (!cur?.subscriptionId || !cur?.url) throw new Error('Guesty notifications are not connected yet (Inbox → Connect sources).')
  const sub = (await listGuestyWebhooks()).find(w => w.id === cur.subscriptionId)
  if (!sub) throw new Error('Lighthouse\'s Guesty subscription was not found in Guesty.')
  const events = Array.from(new Set([...sub.events, ...GY_EVENTS]))
  await guestyWrite('/webhooks/' + encodeURIComponent(sub.id), { url: sub.url, events }, 'PUT')
  await setSetting('guesty_webhook', { ...cur, linkEvents: true, linkEventsAt: new Date().toISOString(), linkEventsBy: by }, by)
  return { events }
}
