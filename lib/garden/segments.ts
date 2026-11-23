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
export type StayPart = { room: string; segment: Segment; total: number }
export type SegStay = {
  id: string; origin: 'cloudbeds' | 'guesty'; status: string; guest: string | null; checkIn: string; checkOut: string; nights: number
  source: string | null; bookedAt: string | null; balance: number | null; total: number; parts: StayPart[]
}
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
export async function loadStays(from: string, to: string): Promise<{ rooms: SegRoom[]; stays: SegStay[] }> {
  const db = supabaseAdmin()
  const { rooms, botanica, listingRoom } = await segmentRooms()
  const ids = Object.keys(listingRoom)
  const [cb, gy] = await Promise.all([
    pageRows<any>((a, b) => db.from('garden_reservations').select('id,status,guest_name,check_in,check_out,nights,total,balance,source,room_names,booked_at').lte('check_in', to).gte('check_out', from).order('id').range(a, b), 10),
    ids.length ? pageRows<any>((a, b) => db.from('guesty_reservations')
      .select('id,listing_id,status,check_in,check_out,nights,source,guest_name,created_at,accom:raw->money->>fareAccommodationAdjusted,clean:raw->money->>fareCleaning,balance:raw->money->>balanceDue')
      .in('listing_id', ids).lte('check_in', to).gt('check_out', from).order('id').range(a, b), 10) : Promise.resolve({ rows: [] as any[] }),
  ])
  const nightsOf = (ci: string, co: string, n: any) => Math.max(1, num(n) || Math.round((Date.parse(co) - Date.parse(ci)) / 86400000))
  const stays: SegStay[] = []
  const inCb = new Set<string>()
  for (const r of (cb.rows as any[])) {
    const ci = s(r.check_in).slice(0, 10), co = s(r.check_out).slice(0, 10)
    if (!ci || !co) continue
    inCb.add(s(r.guest_name).trim().toLowerCase() + '|' + ci)
    const names: string[] = Array.isArray(r.room_names) ? r.room_names.map(s).filter(Boolean) : []
    const total = num(r.total)
    // No room yet: it is the hotel's own booking until a room says otherwise.
    const parts: StayPart[] = names.length ? names.map(nm => ({ room: nm, segment: botanica.has(nm) ? 'botanica' : 'garden', total: total / names.length })) : [{ room: '', segment: 'garden', total }]
    stays.push({ id: s(r.id), origin: 'cloudbeds', status: s(r.status), guest: r.guest_name || null, checkIn: ci, checkOut: co, nights: nightsOf(ci, co, r.nights), source: r.source || null, bookedAt: r.booked_at || null, balance: r.balance != null ? num(r.balance) : null, total, parts })
  }
  for (const r of (gy.rows as any[])) {
    const ci = s(r.check_in).slice(0, 10), co = s(r.check_out).slice(0, 10)
    if (!ci || !co) continue
    if (inCb.has(s(r.guest_name).trim().toLowerCase() + '|' + ci)) continue   // Cloudbeds already holds it
    const st = s(r.status).toLowerCase()
    const status = /cancel|declin|expired|closed/.test(st) ? 'canceled' : st === 'checked_in' || st === 'checked_out' ? st : /confirm|reserv/.test(st) ? 'confirmed' : 'other'
    if (status === 'other') continue   // inquiries and unconfirmed holds are not bookings
    // The Botanica deal: the owner keeps cleaning, so a stay's revenue is accommodation + cleaning.
    const total = Math.round((num(r.accom) + num(r.clean)) * 100) / 100
    stays.push({ id: 'gy:' + s(r.id), origin: 'guesty', status, guest: r.guest_name || null, checkIn: ci, checkOut: co, nights: nightsOf(ci, co, r.nights), source: r.source || null, bookedAt: r.created_at || null, balance: r.balance != null ? num(r.balance) : null, total, parts: [{ room: listingRoom[s(r.listing_id)] || '', segment: 'botanica', total }] })
  }
  return { rooms, stays }
}

/** A stay as one scope sees it: only its rooms in the scope, with their share of the money. null = not in scope. */
export function inScope(st: SegStay, scope: Scope): (SegStay & { rooms: string[] }) | null {
  const parts = scope === 'all' ? st.parts : st.parts.filter(p => p.segment === scope)
  if (!parts.length) return null
  return { ...st, parts, total: parts.reduce((a, p) => a + p.total, 0), rooms: parts.map(p => p.room).filter(Boolean) }
}
