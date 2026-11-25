// WHICH BOTANICA UNITS ARE ACTUALLY BOTANICA'S (Jon, 2026-11-25: "whatever is active units — they kept some. Look at
// Cloudbeds to see if the calendar is open on the physical room for those units. If they are, don't use that as a
// dividing factor").
//
// Guesty lists 53 Botanica units, but the hotel kept a few and sells them itself: their Guesty calendar is closed
// for every night ahead, and the same room is open and taking bookings in Cloudbeds. Those are the hotel's rooms.
// They are not Botanica inventory, so occupancy does not divide by them, on the Botanica report or anywhere else.
//
// THE TEST, for the next 60 nights:   Guesty   every night closed, with no guest booked on any of them
//                                     Cloudbeds a booking in that room number that has not checked out yet
// Both true → hotel-kept. Read from both systems at most every 12 hours and kept on a settings row; if a read fails
// or comes back short, the last answer stands (first time ever: the three known on 2026-11-25).
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getSettingFresh, setSetting } from '../app-settings'
import { pageRows } from '../db-page'
import { botanicaListings } from './guesty-bridge'
import { getMultiCalendar } from '../guesty'

const KEY = 'garden_botanica_kept'
const SEED = ['2107', '2203', '2207']
const DAY = 86400000, NIGHTS = 60
const s = (v: any) => (v == null ? '' : String(v))
const num = (name: string) => (s(name).match(/\b(\d{3,4})\b/) || [])[1] || ''
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

type Saved = { at: string; rooms: string[]; checked: number }
let running: Promise<string[]> | null = null

async function work(prev: string[]): Promise<string[]> {
  const units = await botanicaListings()
  if (!units.length) return prev
  const today = todayET(), to = new Date(Date.parse(today + 'T00:00:00Z') + (NIGHTS - 1) * DAY).toISOString().slice(0, 10)
  const db = supabaseAdmin()
  const [cal, cb] = await Promise.all([
    getMultiCalendar(units.map(u => u.id), today, to),
    pageRows<any>((a, b) => db.from('garden_reservations').select('id,room_names').gte('check_out', today).not('status', 'in', '(canceled,no_show)').order('id').range(a, b), 20),
  ])
  if ((cb as any).truncated) return prev   // a short read of Cloudbeds' bookings is not an answer
  const sold = new Set<string>(); for (const r of (cb.rows as any[])) for (const n of (Array.isArray(r.room_names) ? r.room_names : [])) sold.add(s(n))
  const by: Record<string, { n: number; open: number }> = {}
  for (const d of cal) { const b = (by[d.listingId] = by[d.listingId] || { n: 0, open: 0 }); b.n++; if (d.status === 'available' || d.status === 'booked' || d.status === 'reserved' || d.reservationId) b.open++ }
  const kept: string[] = []; let checked = 0
  for (const u of units) {
    const room = num(u.name), b = by[u.id]
    // A unit whose calendar did not come back whole keeps whatever it was before.
    if (!room || !b || b.n < NIGHTS) { if (room && prev.includes(room)) kept.push(room); continue }
    checked++
    if (b.open === 0 && sold.has(room)) kept.push(room)
  }
  // Fewer than half the units read is a failed read, not news.
  if (checked < units.length / 2) return prev
  kept.sort()
  await setSetting(KEY, { at: new Date().toISOString(), rooms: kept, checked } as Saved, 'botanica-active').catch(() => null)
  return kept
}

/** Room numbers Guesty lists under Botanica that the hotel keeps and sells itself. Never throws. */
export async function hotelKeptRooms(): Promise<Set<string>> {
  let prev = SEED
  try {
    const v = await getSettingFresh<Saved | null>(KEY, null)
    if (v && Array.isArray(v.rooms)) { prev = v.rooms.map(String); if (Date.now() - Date.parse(v.at) < 12 * 3600_000) return new Set(prev) }
    running = running || work(prev).finally(() => { running = null })
    return new Set(await running)
  } catch { return new Set(prev) }
}
