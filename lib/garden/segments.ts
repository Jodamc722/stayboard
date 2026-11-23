// GARDEN vs BOTANICA vs THE WHOLE PROPERTY (Jon, 2026-11-23: "make sure we can separate Botanica units
// vs Garden and whole data").
//
// One property, two businesses on it:
//   Botanica   the rooms Stay Hospitality sells as "Botanica" through Guesty — today the 1000s, the
//              2000s and the 6000s (53 rooms). The list is not typed in here: a room is Botanica when a
//              live Guesty listing named Botanica carries its room number, so it follows Guesty.
//   Garden     every other physical room (the hotel's own, sold through Cloudbeds).
//   Whole      both.
// The SAME rooms exist in Cloudbeds (most Botanica rooms are blocked there, because Guesty sells them),
// and some Botanica rooms do take Cloudbeds bookings — so a stay is placed by the ROOM it is in, not
// by the system it was booked in. A stay across rooms in both is split by room.
//
// loadStays() is the one reader for reporting: Cloudbeds reservations + the Guesty Botanica stays
// Cloudbeds does not hold, each cut into per-room parts with a segment. Guesty units are matched to
// Cloudbeds rooms by number, so a room is never counted twice (it was, 2026-11-11 → 11-23: the Guesty
// units were added on top of the 155 and occupancy read low).
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { pageRows } from '../db-page'
import { botanicaListings } from './guesty-bridge'

export type Segment = 'garden' | 'botanica'
export type Scope = 'all' | Segment
export type SegRoom = { id: string; name: string; type: string; segment: Segment; blocked: boolean; wing: string }
// RENT AND FEE INCOME (the revenue team, 2026-11-23: "can we get fee income added to this report … fees
// accounted for an additional +26.1% of revenue on top of rent"). Every stay carries both:
//   rent   Cloudbeds: the room subtotal before taxes and fees · Guesty: accommodation as the guest paid it
//   fees   the CLEANING fee (Guesty fareCleaning). Cloudbeds does not itemise one: its rate already carries it.
//   other  PARKING (Guesty invoice lines titled Parking) and, in Cloudbeds, what is on the reservation beyond
//          rooms and taxes (add-on items).
// Jon, 2026-11-23: "parking and cleaning is rev but cleaning is part of ADR … parking separate … rev fee
// leave out". So `total` — what revenue, ADR and RevPAR add up — is rent + cleaning (or rent alone on "rent
// only"); parking and add-ons are revenue shown on their own line, never in ADR; Guesty's revenue fee,
// service, marketing and the other pass-through lines are not counted anywhere.
export type StayPart = { room: string; segment: Segment; total: number; rent: number; fees: number; other: number }
export type SegStay = {
  id: string; origin: 'cloudbeds' | 'guesty'; status: string; guest: string | null; checkIn: string; checkOut: string; nights: number
  source: string | null; bookedAt: string | null; balance: number | null; total: number; rent: number; fees: number; other: number; parts: StayPart[]
  /** What `total` is: 'room' = room revenue before taxes and fees, 'gross' = Cloudbeds' reservation total (taxes and fees in it). */
  basis: 'room' | 'gross'
}
/** FILTERS (Jon, 2026-11-23: "make sure we have filter options always, for any report"). Every field
 *  optional; an empty filter changes nothing. Channel names are the grouped ones (lib/garden/revenue
 *  channelName). los = nights of the whole stay; lead = days between booking and arrival. */
export type StayFilter = { rentOnly?: boolean; channels?: string[]; types?: string[]; wings?: string[]; losMin?: number; losMax?: number; leadMin?: number; leadMax?: number; origin?: 'cloudbeds' | 'guesty' }
export const filterActive = (f?: StayFilter | null) => !!f && !!(f.rentOnly || (f.channels && f.channels.length) || (f.types && f.types.length) || (f.wings && f.wings.length) || f.losMin != null || f.losMax != null || f.leadMin != null || f.leadMax != null || f.origin)
const D = /^\d{1,4}$/
/** Read a filter from a query string: ch, rt, wing (| separated), los and lead ("min-max", either side blank), origin. */
export function parseFilter(sp: { get(k: string): string | null }): StayFilter {
  const list = (k: string) => (sp.get(k) || '').split('|').map(x => x.trim()).filter(Boolean).slice(0, 60)
  const range = (k: string): [number | undefined, number | undefined] => { const m = (sp.get(k) || '').split('-'); const a = D.test(m[0] || '') ? Number(m[0]) : undefined, b = D.test(m[1] || '') ? Number(m[1]) : undefined; return [a, b] }
  const [losMin, losMax] = range('los'), [leadMin, leadMax] = range('lead')
  const o = sp.get('origin')
  const f: StayFilter = {}
  if (list('ch').length) f.channels = list('ch'); if (list('rt').length) f.types = list('rt'); if (list('wing').length) f.wings = list('wing')
  if (losMin != null) f.losMin = losMin; if (losMax != null) f.losMax = losMax; if (leadMin != null) f.leadMin = leadMin; if (leadMax != null) f.leadMax = leadMax
  if (o === 'cloudbeds' || o === 'guesty') f.origin = o
  if (sp.get('rev') === 'rent') f.rentOnly = true
  return f
}
export const leadDays = (st: { checkIn: string; bookedAt: string | null }): number | null => { if (!st.bookedAt) return null; const d = Math.round((Date.parse(st.checkIn + 'T00:00:00Z') - Date.parse(String(st.bookedAt).slice(0, 10) + 'T00:00:00Z')) / 86400000); return Number.isFinite(d) && d >= 0 ? d : null }
const s = (v: any) => (v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export const roomNumber = (name: string) => (s(name).match(/\b(\d{3,4})\b/) || [])[1] || ''
export const wingOf = (name: string) => { const d = s(name).replace(/\D/g, ''); return d.length >= 4 ? d[0] + '000s' : d.length === 3 ? d[0] + '00s' : 'Other' }
export const SEGMENT_LABEL: Record<Scope, string> = { all: 'Whole property', garden: 'Garden', botanica: 'Botanica' }

/** Every physical room with its segment. */
export async function segmentRooms(): Promise<{ rooms: SegRoom[]; botanica: Set<string>; listingRoom: Record<string, string> }> {
  const db = supabaseAdmin()
  const [{ data }, units] = await Promise.all([
    db.from('garden_rooms').select('id,name,room_type,blocked,status,rt:raw->>roomTypeName').or('raw->>isVirtual.is.null,raw->>isVirtual.eq.false').order('name'),
    botanicaListings().catch(() => []),
  ])
  const botanica = new Set<string>(), listingRoom: Record<string, string> = {}
  for (const u of units) { const n = roomNumber(u.name); if (n) { botanica.add(n); listingRoom[u.id] = n } }
  const rooms = ((data || []) as any[]).map(r => ({ id: s(r.id), name: s(r.name), type: s(r.rt || r.room_type) || 'Room', segment: (botanica.has(s(r.name)) ? 'botanica' : 'garden') as Segment, blocked: !!r.blocked || (r.status && r.status !== 'active'), wing: wingOf(r.name) }))
  // A Botanica unit Guesty has that Cloudbeds does not list is still a room of the property.
  const have = new Set(rooms.map(r => r.name))
  for (const n of Array.from(botanica)) if (!have.has(n)) rooms.push({ id: 'gy:' + n, name: n, type: 'Botanica unit', segment: 'botanica', blocked: false, wing: wingOf(n) })
  return { rooms, botanica, listingRoom }
}

/** Stays touching [from, to] (cancelled included, by status), each split into rooms with a segment. */
const nightsOf = (ci: string, co: string, n: any) => Math.max(1, num(n) || Math.round((Date.parse(co) - Date.parse(ci)) / 86400000))
const CB_COLS = 'id,status,guest_name,check_in,check_out,nights,total,balance,source,room_names,booked_at'
const GY_COLS = 'id,listing_id,status,check_in,check_out,nights,source,guest_name,created_at,accom:raw->money->>fareAccommodationAdjusted,clean:raw->money->>fareCleaning,items:raw->money->invoiceItems,balance:raw->money->>balanceDue'
/** One Cloudbeds reservation as a stay, cut by room. */
function fromCb(r: any, botanica: Set<string>): SegStay | null {
  const ci = s(r.check_in).slice(0, 10), co = s(r.check_out).slice(0, 10)
  if (!ci || !co) return null
  const names: string[] = Array.isArray(r.room_names) ? r.room_names.map(s).filter(Boolean) : []
  const net = r.room_revenue != null && Number.isFinite(Number(r.room_revenue)) ? Number(r.room_revenue) : null
  const rent = net != null ? net : num(r.total)
  // Beyond rooms and taxes: only knowable once Cloudbeds' breakdown has been read for the reservation.
  const other = net != null && r.taxes_fees != null ? Math.max(0, Math.round((num(r.total) - net - num(r.taxes_fees)) * 100) / 100) : 0
  const fees = 0, total = rent
  // No room yet: it is the hotel's own booking until a room says otherwise.
  const k = Math.max(1, names.length)
  const parts: StayPart[] = names.length ? names.map(nm => ({ room: nm, segment: botanica.has(nm) ? 'botanica' : 'garden', total: total / k, rent: rent / k, fees: 0, other: other / k })) : [{ room: '', segment: 'garden', total, rent, fees, other }]
  return { id: s(r.id), origin: 'cloudbeds', status: s(r.status), guest: r.guest_name || null, checkIn: ci, checkOut: co, nights: nightsOf(ci, co, r.nights), source: r.source || null, bookedAt: r.booked_at || null, balance: r.balance != null ? num(r.balance) : null, total, rent, fees, other, parts, basis: net != null ? 'room' : 'gross' }
}
/** One Guesty Botanica reservation as a stay; null when Cloudbeds already holds it or it is not a booking. */
function fromGy(r: any, listingRoom: Record<string, string>, inCb: Set<string>): SegStay | null {
  const ci = s(r.check_in).slice(0, 10), co = s(r.check_out).slice(0, 10)
  if (!ci || !co) return null
  if (inCb.has(s(r.guest_name).trim().toLowerCase() + '|' + ci)) return null   // Cloudbeds already holds it
  const st = s(r.status).toLowerCase()
  const status = /cancel|declin|expired|closed/.test(st) ? 'canceled' : st === 'checked_in' || st === 'checked_out' ? st : /confirm|reserv/.test(st) ? 'confirmed' : 'other'
  if (status === 'other') return null   // inquiries and unconfirmed holds are not bookings
  // The Botanica deal: the owner keeps cleaning, so a stay's revenue is accommodation + cleaning.
  const rent = Math.round(num(r.accom) * 100) / 100, fees = Math.round(num(r.clean) * 100) / 100
  const other = Math.round((Array.isArray(r.items) ? r.items : []).reduce((a: number, it: any) => a + (/park/i.test(s(it?.title)) ? num(it?.amount) : 0), 0) * 100) / 100
  const total = Math.round((rent + fees) * 100) / 100
  return { id: 'gy:' + s(r.id), origin: 'guesty', status, guest: r.guest_name || null, checkIn: ci, checkOut: co, nights: nightsOf(ci, co, r.nights), source: r.source || null, bookedAt: r.created_at || null, balance: r.balance != null ? num(r.balance) : null, total, rent, fees, other, basis: 'room', parts: [{ room: listingRoom[s(r.listing_id)] || '', segment: 'botanica', total, rent, fees, other }] }
}

let _netCol: { at: number; has: boolean } | null = null
/** Is garden_reservations.room_revenue there yet (migration 181)? Asked once every ten minutes. */
export async function hasRoomRevenue(): Promise<boolean> {
  if (_netCol && Date.now() - _netCol.at < 600000) return _netCol.has
  let has = false
  try { const { error } = await supabaseAdmin().from('garden_reservations').select('room_revenue').limit(1); has = !error } catch { has = false }
  _netCol = { at: Date.now(), has }
  return has
}

export async function loadStays(from: string, to: string): Promise<{ rooms: SegRoom[]; stays: SegStay[]; partial: boolean }> {
  const db = supabaseAdmin()
  const { rooms, botanica, listingRoom } = await segmentRooms()
  const ids = Object.keys(listingRoom)
  // room_revenue (migration 181) is Cloudbeds' own figure before taxes and fees. Until the column exists
  // the read falls back to the reservation total, and every stay says which one it carries (basis).
  const cols = CB_COLS + ((await hasRoomRevenue()) ? ',room_revenue,taxes_fees' : '')
  const [cb, gy] = await Promise.all([
    pageRows<any>((a, b) => db.from('garden_reservations').select(cols).lte('check_in', to).gte('check_out', from).order('id').range(a, b), 20),
    ids.length ? pageRows<any>((a, b) => db.from('guesty_reservations')
      .select(GY_COLS)
      .in('listing_id', ids).lte('check_in', to).gt('check_out', from).order('id').range(a, b), 20) : Promise.resolve({ rows: [] as any[], truncated: false }),
  ])
  const inCb = new Set<string>()
  const stays: SegStay[] = []
  for (const r of (cb.rows as any[])) { const st = fromCb(r, botanica); if (st) { inCb.add(s(r.guest_name).trim().toLowerCase() + '|' + st.checkIn); stays.push(st) } }
  for (const r of (gy.rows as any[])) { const st = fromGy(r, listingRoom, inCb); if (st) stays.push(st) }
  // partial = a read stopped early (an error or the page ceiling): the numbers would be short, so say so.
  return { rooms, stays, partial: !!(cb as any).truncated || !!(gy as any).truncated }
}

/** Bookings MADE in [from, to], for any stay date (Cloudbeds by its created date, Guesty Botanica by
 *  its own), cancelled ones included by status — the same stay shape, so scope and filters apply. */
export async function loadBooked(from: string, to: string): Promise<{ stays: SegStay[]; partial: boolean }> {
  const db = supabaseAdmin()
  const { botanica, listingRoom } = await segmentRooms()
  const ids = Object.keys(listingRoom)
  const end = new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  const cols = CB_COLS + ((await hasRoomRevenue()) ? ',room_revenue,taxes_fees' : '')
  const [cb, gy] = await Promise.all([
    pageRows<any>((a, b) => db.from('garden_reservations').select(cols).gte('booked_at', from).lt('booked_at', end).order('id').range(a, b), 20),
    ids.length ? pageRows<any>((a, b) => db.from('guesty_reservations').select(GY_COLS).in('listing_id', ids).gte('created_at', from).lt('created_at', end).order('id').range(a, b), 20) : Promise.resolve({ rows: [] as any[], truncated: false }),
  ])
  const inCb = new Set<string>(), stays: SegStay[] = []
  for (const r of (cb.rows as any[])) { const st = fromCb(r, botanica); if (st) { inCb.add(s(r.guest_name).trim().toLowerCase() + '|' + st.checkIn); stays.push(st) } }
  // A Guesty stay Cloudbeds holds may have been created outside this window there: check by guest + arrival.
  const gyRows = gy.rows as any[]
  if (gyRows.length) {
    const cis = Array.from(new Set(gyRows.map(r => s(r.check_in).slice(0, 10)).filter(Boolean)))
    for (let i = 0; i < cis.length; i += 150) { const { data } = await db.from('garden_reservations').select('guest_name,check_in').in('check_in', cis.slice(i, i + 150)).limit(1000); for (const r of ((data || []) as any[])) inCb.add(s(r.guest_name).trim().toLowerCase() + '|' + s(r.check_in).slice(0, 10)) }
  }
  for (const r of gyRows) { const st = fromGy(r, listingRoom, inCb); if (st) stays.push(st) }
  return { stays, partial: !!(cb as any).truncated || !!(gy as any).truncated }
}

/** A stay as one scope sees it: only its rooms in the scope, with their share of the money. null = not in scope. */
export function inScope(st: SegStay, scope: Scope): (SegStay & { rooms: string[] }) | null {
  const parts = scope === 'all' ? st.parts : st.parts.filter(p => p.segment === scope)
  if (!parts.length) return null
  return { ...st, parts, total: parts.reduce((a, p) => a + p.total, 0), rent: parts.reduce((a, p) => a + p.rent, 0), fees: parts.reduce((a, p) => a + p.fees, 0), other: parts.reduce((a, p) => a + p.other, 0), rooms: parts.map(p => p.room).filter(Boolean) }
}


/** The rooms and stays a scope + filter leaves. Room type and wing narrow the ROOMS too (so occupancy
 *  divides by the rooms being looked at); channel, length of stay, booking window and system narrow
 *  only the stays. `chan` is lib/garden/revenue channelName, passed in to keep this file free of it. */
export function narrow(all: { rooms: SegRoom[]; stays: SegStay[] }, scope: Scope, f: StayFilter | null | undefined, chan: (src: string | null) => string): { rooms: SegRoom[]; stays: (SegStay & { rooms: string[] })[] } {
  const types = f?.types?.length ? new Set(f.types) : null, wings = f?.wings?.length ? new Set(f.wings) : null, chans = f?.channels?.length ? new Set(f.channels) : null
  const rooms = all.rooms.filter(r => (scope === 'all' || r.segment === scope) && (!types || types.has(r.type)) && (!wings || wings.has(r.wing)))
  const roomOk = types || wings ? new Set(rooms.map(r => r.name)) : null
  const stays: (SegStay & { rooms: string[] })[] = []
  // Rent only: the same stays with the fee income left out of what is added up (it is still carried, to show).
  const src = f?.rentOnly ? all.stays.map(st => ({ ...st, total: st.rent, parts: st.parts.map(p => ({ ...p, total: p.rent })) })) : all.stays
  for (const st of src) {
    if (f?.origin && st.origin !== f.origin) continue
    if (chans && !chans.has(chan(st.source))) continue
    if (f?.losMin != null && st.nights < f.losMin) continue
    if (f?.losMax != null && st.nights > f.losMax) continue
    if (f?.leadMin != null || f?.leadMax != null) { const d = leadDays(st); if (d == null || (f.leadMin != null && d < f.leadMin) || (f.leadMax != null && d > f.leadMax)) continue }
    const x = inScope(st, scope); if (!x) continue
    if (roomOk) { const parts = x.parts.filter(p => roomOk.has(p.room)); if (!parts.length) continue; stays.push({ ...x, parts, total: parts.reduce((a, p) => a + p.total, 0), rent: parts.reduce((a, p) => a + p.rent, 0), fees: parts.reduce((a, p) => a + p.fees, 0), other: parts.reduce((a, p) => a + p.other, 0), rooms: parts.map(p => p.room).filter(Boolean) }) }
    else stays.push(x)
  }
  return { rooms, stays }
}
