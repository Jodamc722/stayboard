// THE CALENDAR LINK — Guesty ⇄ Cloudbeds, room by room (Jon, 2026-11-24: "would it be possible to sync
// Guesty calendar with Cloudbeds? … if those virtual rooms get booked, block that virtual room in
// Cloudbeds; if there's a block in Cloudbeds for that virtual room, block the calendar in Guesty … this
// would have to be instant").
//
// THE CONNECTIONS
//   a Botanica unit        one Guesty listing whose name carries a room number ("Botanica 1001")
//   the same room          in Cloudbeds twice: the physical room "1001" (inside a shared room type) and a
//                          VIRTUAL room, a room type of its own named "1001" — the one sold on the channels.
//                          Cloudbeds links the pair: blocking one blocks the other.
//   so                     room number → { Guesty listing id, Cloudbeds virtual room id, physical room id }
//
// ONE RULE, RUN FOR ONE ROOM OVER A STRETCH OF NIGHTS (reconcile):
//   a night Guesty holds (a booking, or a block somebody made there)        → a block on the room in Cloudbeds
//   a night Cloudbeds holds (a booking in the room, or a block made there)   → the night closed in Guesty
//   a block THIS FILE made whose reason has gone                             → removed
// What this file makes is marked ("Lighthouse link" in the Cloudbeds reason and the Guesty note), so it
// never mistakes its own block for the other side's booking — that is what stops the two from locking
// each other shut. A night BOTH sides hold is a double booking: reported, nothing written.
//
// INSTANT: Guesty and Cloudbeds each call a webhook when something changes; the webhook runs reconcile
// for that room (onGuestyEvent / onCloudbedsEvent). The Refresh button and the scheduled sync run the
// same reconcile, so a missed call is caught.
//
// SAFE BY DEFAULT: it only ever touches rooms switched on in the list (app_settings garden_calendar_link),
// and it ignores Cloudbeds blocks whose reason is on the ignore list — today the hotel's blanket "AIRBNB"
// blocks, which exist precisely because there was no link. Without that, linking a room would close its
// whole Guesty calendar.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getSettingFresh, setSetting } from '../app-settings'
import { cbGet, cbPostV, cbDeleteV, getReservations } from './cloudbeds'
import { botanicaListings } from './guesty-bridge'
import { getMultiCalendar, guestyWrite, isOpsBlock, type MultiCalDay } from '../guesty'

export const MARK = 'Lighthouse link'
const KEY = 'garden_calendar_link'
const DAY = 86400000
const D = /^\d{4}-\d{2}-\d{2}$/
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const ms = (ymd: string) => Date.parse(ymd + 'T00:00:00Z')
const s = (v: any) => (v == null ? '' : String(v))
const num = (name: string) => (s(name).match(/\b(\d{3,4})\b/) || [])[1] || ''
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export type LinkSettings = { rooms: string[]; ignore: string[]; log: { at: string; room: string; what: string; by: string }[]; alertTo: string[]; alerted: string[] }
/** How far ahead the link looks: a year covers every booking Guesty can hold. */
export const HORIZON_DAYS = 365
export type LinkedRoom = { room: string; listingId: string; listingName: string; virtualId: string | null; physicalId: string | null }
export type Night = { date: string; guesty: 'free' | 'booked' | 'blocked' | 'ours'; cloudbeds: 'free' | 'booked' | 'blocked' | 'ours' | 'ignored'; detail?: string }

export async function linkSettings(): Promise<LinkSettings> {
  const v = await getSettingFresh<Partial<LinkSettings> | null>(KEY, null).catch(() => null)
  return { rooms: Array.isArray(v?.rooms) ? v!.rooms!.map(String) : [], ignore: Array.isArray(v?.ignore) ? v!.ignore!.map(String) : ['AIRBNB'], log: Array.isArray(v?.log) ? v!.log! : [], alertTo: Array.isArray(v?.alertTo) ? v!.alertTo!.map(String) : [], alerted: Array.isArray(v?.alerted) ? v!.alerted!.map(String) : [] }
}
async function note(room: string, what: string, by: string) {
  const cur = await linkSettings()
  await setSetting(KEY, { ...cur, log: [{ at: new Date().toISOString(), room, what, by }, ...cur.log].slice(0, 80) }, 'calendar-link').catch(() => {})
}
export async function setLinkedRooms(rooms: string[], by: string): Promise<LinkSettings> {
  const cur = await linkSettings()
  const all = await roomMap()
  const ok = Array.from(new Set(rooms.map(String))).filter(r => all[r]?.virtualId || all[r]?.physicalId)
  const next = { ...cur, rooms: ok, log: [{ at: new Date().toISOString(), room: ok.join(', ') || '—', what: 'linked rooms set', by }, ...cur.log].slice(0, 80) }
  await setSetting(KEY, next, 'calendar-link')
  return next
}

/** room number → the Guesty listing and the two Cloudbeds rooms. Only rooms that have a Botanica listing. */
export async function roomMap(): Promise<Record<string, LinkedRoom>> {
  const [units, { data }] = await Promise.all([botanicaListings(), supabaseAdmin().from('garden_rooms').select('id,name,virtual:raw->>isVirtual')])
  const out: Record<string, LinkedRoom> = {}
  for (const u of units) { const n = num(u.name); if (n) out[n] = { room: n, listingId: u.id, listingName: u.name, virtualId: null, physicalId: null } }
  for (const r of ((data || []) as any[])) { const o = out[s(r.name)]; if (!o) continue; if (r.virtual === 'true' || r.virtual === true) o.virtualId = s(r.id); else o.physicalId = s(r.id) }
  return out
}

type CbBlock = { id: string; reason: string; type: string; start: string; end: string; roomIds: string[] }
/** Cloudbeds blocks touching [from, to], read live (35 days a call is Cloudbeds' limit). */
async function cbBlocks(from: string, to: string): Promise<CbBlock[]> {
  const seen = new Map<string, CbBlock>()
  const wins: [string, string][] = []
  for (let a = ms(from); a <= ms(to); a += 34 * DAY) wins.push([iso(a), iso(Math.min(ms(to), a + 33 * DAY))])
  // Four windows at a time: a year is eleven calls, and one after another would be too slow to be "instant".
  for (let i = 0; i < wins.length; i += 4) {
    const got = await Promise.all(wins.slice(i, i + 4).map(([x, y]) => cbGet<any>('getRoomBlocks', { startDate: x, endDate: y })))
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
const gyPath = (listingId: string) => `/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}`
/** Close nights in Guesty (endDate is the last night closed). */
export async function gyBlock(listingId: string, from: string, to: string, text: string): Promise<void> { await guestyWrite(gyPath(listingId), { startDate: from, endDate: to, status: 'unavailable', blockReason: 'Other', note: text.slice(0, 300) }, 'PUT') }
export async function gyOpen(listingId: string, from: string, to: string): Promise<void> { await guestyWrite(gyPath(listingId), { startDate: from, endDate: to, status: 'available' }, 'PUT') }

const isOurs = (t: string | null | undefined) => s(t).startsWith(MARK)
/** Runs of consecutive dates → [first, last] pairs. */
function runs(dates: string[]): [string, string][] {
  const out: [string, string][] = []
  for (const d of dates.slice().sort()) { const last = out[out.length - 1]; if (last && ms(d) - ms(last[1]) === DAY) last[1] = d; else out.push([d, d]) }
  return out
}

/** Cloudbeds' side for the whole property, read once and shared by every room in a run. */
export type CbSide = { blocks: CbBlock[]; res: Awaited<ReturnType<typeof getReservations>> }
export async function readCloudbeds(from: string, to: string): Promise<CbSide> {
  const [blocks, res] = await Promise.all([cbBlocks(from, to), getReservations({ from, to: iso(ms(to) + DAY) })])
  return { blocks, res }
}

/** Both calendars for one room, night by night, read live from both systems. */
export async function readRoom(room: string, from: string, to: string, pre?: { cb?: CbSide; map?: Record<string, LinkedRoom>; st?: LinkSettings }): Promise<{ room: LinkedRoom; nights: Night[]; blocks: CbBlock[]; ours: CbBlock[]; days: Record<string, MultiCalDay> }> {
  if (!D.test(from) || !D.test(to) || to < from) throw new Error('from and to (YYYY-MM-DD) are needed')
  if ((ms(to) - ms(from)) / DAY > 400) throw new Error('400 nights at most at a time')
  const map = pre?.map || await roomMap(), r = map[room]
  if (!r) throw new Error(`Room ${room} has no Botanica listing in Guesty.`)
  const cbIds = [r.virtualId, r.physicalId].filter(Boolean) as string[]
  if (!cbIds.length) throw new Error(`Room ${room} was not found in Cloudbeds.`)
  const st = pre?.st || await linkSettings()
  const [cb, cal] = await Promise.all([pre?.cb ? Promise.resolve(pre.cb) : readCloudbeds(from, to), getMultiCalendar([r.listingId], from, to)])
  const blocksAll = cb.blocks, res = cb.res
  const blocks = blocksAll.filter(b => b.roomIds.some(id => cbIds.includes(id)))
  const stays = res.filter(x => x.status !== 'canceled' && x.status !== 'no_show' && (x.roomNames || []).map(String).includes(room) && x.checkIn && x.checkOut)
  const days: Record<string, MultiCalDay> = {}; for (const d of cal) if (d.listingId === r.listingId) days[d.date] = d
  const ignored = (b: CbBlock) => st.ignore.some(x => x && b.reason.toLowerCase().includes(x.toLowerCase()))
  const nights: Night[] = []
  for (let t = ms(from); t <= ms(to); t += DAY) {
    const date = iso(t), g = days[date]
    const gOurs = !!g && (isOurs(g.note) || g.refs.some(x => isOurs(x.note)))
    const guesty: Night['guesty'] = !g ? 'free' : g.reservationId ? 'booked' : gOurs ? 'ours' : isOpsBlock(g) ? 'blocked' : 'free'
    const stay = stays.find(x => x.checkIn! <= date && x.checkOut! > date)
    const on = blocks.filter(b => b.start <= date && b.end >= date)
    const cloudbeds: Night['cloudbeds'] = stay ? 'booked' : on.some(b => !isOurs(b.reason) && !ignored(b)) ? 'blocked' : on.some(b => isOurs(b.reason)) ? 'ours' : on.length ? 'ignored' : 'free'
    nights.push({ date, guesty, cloudbeds, detail: [stay ? `Cloudbeds booking ${stay.id}` : '', on.map(b => `Cloudbeds block "${b.reason || b.type}"`).join(', '), g?.reservationId ? 'Guesty booking' : g && guesty === 'blocked' ? `Guesty block${g.refs[0]?.reason ? ' "' + g.refs[0].reason + '"' : ''}` : ''].filter(Boolean).join(' · ') || undefined })
  }
  return { room: r, nights, blocks, ours: blocks.filter(b => isOurs(b.reason)), days }
}

/** Make each side show what the other holds, for one room. `dry` only says what it would do. */
export async function reconcileRoom(room: string, from: string, to: string, by: string, dry = false, pre?: { cb?: CbSide; map?: Record<string, LinkedRoom>; st?: LinkSettings }): Promise<{ room: string; did: string[]; conflicts: string[]; nights: Night[]; ms: number }> {
  const t0 = Date.now()
  const R = await readRoom(room, from, to, pre)
  const did: string[] = [], conflicts: string[] = []
  const gHolds = (n: Night) => n.guesty === 'booked' || n.guesty === 'blocked', cHolds = (n: Night) => n.cloudbeds === 'booked' || n.cloudbeds === 'blocked'
  // A DOUBLE BOOKING is a guest on each side for the same night. A booking on one side and a block made by
  // hand on the other is the opposite: somebody already closed it, which is what the link would have done.
  const both = (n: Night) => n.guesty === 'booked' && n.cloudbeds === 'booked'
  for (const n of R.nights) if (both(n)) conflicts.push(`${n.date}: a booking on both sides (${n.detail || 'see both calendars'})`)
  const cbRoom = R.room.virtualId || R.room.physicalId!

  // Guesty holds → Cloudbeds blocked. Our old blocks in the window are replaced only when they no longer fit.
  const wantCb = R.nights.filter(n => gHolds(n) && !cHolds(n)).map(n => n.date)
  const want = runs(wantCb)
  const have = R.ours.map(b => [b.start < from ? from : b.start, b.end > to ? to : b.end] as [string, string])
  const same = want.length === R.ours.length && want.every(w => R.ours.some(b => b.start === w[0] && b.end === w[1]))
  void have
  if (!same) {
    for (const b of R.ours) { did.push(`Cloudbeds: removed block ${b.start} → ${b.end}`); if (!dry) await cbUnblock(b.id) }
    for (const [a, b] of want) { did.push(`Cloudbeds: blocked room ${room} ${a} → ${b} (held in Guesty)`); if (!dry) await cbBlockRoom(cbRoom, a, b, `${MARK} · held in Guesty`) }
  }
  // Cloudbeds holds → Guesty closed; a night we closed that Cloudbeds no longer holds → opened again.
  const close = runs(R.nights.filter(n => cHolds(n) && n.guesty === 'free').map(n => n.date))
  const open = runs(R.nights.filter(n => !cHolds(n) && n.guesty === 'ours').map(n => n.date))
  for (const [a, b] of close) { did.push(`Guesty: closed ${a} → ${b} (held in Cloudbeds)`); if (!dry) await gyBlock(R.room.listingId, a, b, `${MARK} · held in Cloudbeds`) }
  for (const [a, b] of open) { did.push(`Guesty: opened ${a} → ${b}`); if (!dry) await gyOpen(R.room.listingId, a, b) }
  if (!dry && conflicts.length) await alertConflicts(room, R.nights.filter(both)).catch(() => {})
  if (!dry && (did.length || conflicts.length)) await note(room, [...did, ...conflicts.map(c => 'DOUBLE BOOKING ' + c)].join(' · ').slice(0, 600), by)
  const after = dry || !did.length ? R.nights : (await readRoom(room, from, to)).nights
  return { room, did, conflicts, nights: after, ms: Date.now() - t0 }
}

/** A night held on both sides is a double booking: tell someone once per room and night (an in-app notice). */
async function alertConflicts(room: string, nights: Night[]): Promise<void> {
  const st = await linkSettings()
  const fresh = nights.filter(n => !st.alerted.includes(`${room}|${n.date}`))
  if (!fresh.length) return
  await setSetting(KEY, { ...st, alerted: [...fresh.map(n => `${room}|${n.date}`), ...st.alerted].slice(0, 300) }, 'calendar-link')
  const { notify } = await import('../notify')
  const to = st.alertTo.length ? st.alertTo : ['jon@stay-hospitality.com']
  await notify(to, { kind: 'calendar_link', title: `Double booking: room ${room}, ${fresh.map(n => n.date).join(', ')}`, body: `Guesty and Cloudbeds both hold ${fresh.length === 1 ? 'this night' : 'these nights'}. ${fresh[0].detail || ''} Nothing was changed; one of the two has to be moved.`.trim(), link: '/garden/users?tab=settings&panel=feeds', entity: { type: 'calendar_link', id: `${room}|${fresh[0].date}` } })
}

/** Every linked room, today through `days` ahead — the Refresh button and the half-hourly safety net. */
export async function reconcileLinked(by: string, days = HORIZON_DAYS): Promise<{ rooms: number; did: string[]; conflicts: string[]; errors: string[] }> {
  const st = await linkSettings(), from = todayET(), to = iso(ms(from) + days * DAY)
  const did: string[] = [], conflicts: string[] = [], errors: string[] = []
  if (!st.rooms.length) return { rooms: 0, did, conflicts, errors }
  // Cloudbeds is read once for the whole run; each room then needs only its own Guesty calendar.
  let pre: { cb: CbSide; map: Record<string, LinkedRoom>; st: LinkSettings }
  try { const [cb, map] = await Promise.all([readCloudbeds(from, to), roomMap()]); pre = { cb, map, st } } catch (e: any) { return { rooms: st.rooms.length, did, conflicts, errors: [String(e?.message || e).slice(0, 200)] } }
  for (const room of st.rooms) {
    try { const r = await reconcileRoom(room, from, to, by, false, pre); did.push(...r.did.map(x => `${room}: ${x}`)); conflicts.push(...r.conflicts.map(x => `${room}: ${x}`)); if (r.did.length) pre.cb = await readCloudbeds(from, to) }
    catch (e: any) { errors.push(`${room}: ${String(e?.message || e).slice(0, 160)}`) }
  }
  return { rooms: st.rooms.length, did, conflicts, errors }
}

/** Guesty said a booking or a calendar changed: reconcile that listing's room, if it is linked. */
export async function onGuestyEvent(listingId: string): Promise<string | null> {
  if (!listingId) return null
  const st = await linkSettings(); if (!st.rooms.length) return null
  const map = await roomMap(), hit = Object.values(map).find(r => r.listingId === listingId)
  if (!hit || !st.rooms.includes(hit.room)) return null
  const from = todayET()
  await reconcileRoom(hit.room, from, iso(ms(from) + HORIZON_DAYS * DAY), 'guesty webhook')
  return hit.room
}
/** Cloudbeds said a booking or a block changed: its events do not name the room reliably, so every linked room is checked. */
export async function onCloudbedsEvent(): Promise<number> {
  const st = await linkSettings(); if (!st.rooms.length) return 0
  await reconcileLinked('cloudbeds webhook')
  return st.rooms.length
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
  const { getSettingFresh: fresh } = await import('../app-settings')
  const { listGuestyWebhooks } = await import('../guesty-webhooks')
  const cur = await fresh<any>('guesty_webhook', null)
  if (!cur?.subscriptionId || !cur?.url) throw new Error('Guesty notifications are not connected yet (Inbox → Connect sources).')
  const sub = (await listGuestyWebhooks()).find(w => w.id === cur.subscriptionId)
  if (!sub) throw new Error('Lighthouse\'s Guesty subscription was not found in Guesty.')
  const events = Array.from(new Set([...sub.events, ...GY_EVENTS]))
  await guestyWrite('/webhooks/' + encodeURIComponent(sub.id), { url: sub.url, events }, 'PUT')
  await setSetting('guesty_webhook', { ...cur, linkEvents: true, linkEventsAt: new Date().toISOString(), linkEventsBy: by }, by)
  return { events }
}
