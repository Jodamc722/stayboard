// GARDEN HOTEL SCHEDULER — the hotel's people and their shifts, and a suggestion for the day.
//
// Jon, 2026-09-28: "scheduler". A hotel day is simpler than a VR day: the work is in one building.
// So the scheduler is: who is on (garden_shifts), what the day holds (cleans, stayovers, arrivals,
// tasks), and a suggestion — how many housekeepers the cleans need at ROOMS_PER_HK a shift, one
// front desk per shift, maintenance when there are maintenance tasks — plus an even split of rooms
// across the housekeepers on. Suggestions are saved only when a person approves them.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { todayET } from './sync'

export const ROOMS_PER_HK = 12
export const STAYOVER_WEIGHT = 0.5
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export async function staffList(includeInactive = false) {
  let q = supabaseAdmin().from('garden_staff').select('*').order('role').order('name')
  if (!includeInactive) q = q.eq('active', true)
  return ((await q).data || []) as any[]
}

export async function weekSchedule(from: string, days = 7) {
  const db = supabaseAdmin()
  const to = addDays(from, days - 1)
  const [{ data: shifts }, staff, { data: tasks }, { data: res }] = await Promise.all([
    db.from('garden_shifts').select('*').gte('date', from).lte('date', to).order('date').order('start_time'),
    staffList(),
    db.from('garden_tasks').select('date,kind,status').gte('date', from).lte('date', to).neq('status', 'cancelled'),
    db.from('garden_reservations').select('check_in,check_out,status').in('status', ['confirmed', 'not_confirmed', 'checked_in', 'checked_out']).lte('check_in', to).gte('check_out', from),
  ])
  const byName: Record<string, any> = {}
  for (const s of staff) byName[s.id] = s
  const daysOut: any[] = []
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i)
    const T = ((tasks || []) as any[]).filter(t => t.date === d)
    const R = (res || []) as any[]
    const load = { cleans: T.filter(t => t.kind === 'clean').length, stayovers: T.filter(t => t.kind === 'stayover').length, maintenance: T.filter(t => t.kind === 'maintenance').length, other: T.filter(t => !['clean', 'stayover', 'maintenance'].includes(t.kind)).length, arrivals: R.filter(r => r.check_in === d).length, departures: R.filter(r => r.check_out === d).length, inHouse: R.filter(r => r.check_in < d && r.check_out > d).length }
    const S = ((shifts || []) as any[]).filter(x => x.date === d).map(x => ({ ...x, staff: byName[x.staff_id] || null }))
    daysOut.push({ date: d, load, shifts: S, suggest: suggestFor(load, S, staff) })
  }
  return { from, to, staff, days: daysOut }
}

/** How many of each role the day needs, and who is missing, from the load and the staff on. */
export function suggestFor(load: { cleans: number; stayovers: number; maintenance: number; arrivals: number }, shifts: any[], staff: any[]) {
  const hkNeeded = Math.max(load.cleans + load.stayovers > 0 ? 1 : 0, Math.ceil((load.cleans + load.stayovers * STAYOVER_WEIGHT) / ROOMS_PER_HK))
  const need = { housekeeping: hkNeeded, frontdesk: load.arrivals > 0 || shifts.length ? 1 : 0, maintenance: load.maintenance > 0 ? 1 : 0 }
  const on = (role: string) => shifts.filter(s => s.role === role).length
  const gaps = (Object.keys(need) as (keyof typeof need)[]).map(role => ({ role, need: need[role], on: on(role), short: Math.max(0, need[role] - on(role)) })).filter(g => g.need || g.on)
  const pool = (role: string) => staff.filter(s => s.role === role && !shifts.some(x => x.staff_id === s.id)).map(s => ({ id: s.id, name: s.name }))
  return { need, gaps, candidates: { housekeeping: pool('housekeeping'), frontdesk: pool('frontdesk'), maintenance: pool('maintenance') } }
}

/** Split today's rooms across the housekeepers on shift, evenly, keeping any rooms already set. */
export async function splitRooms(date: string): Promise<{ assigned: number; perPerson: Record<string, string[]> }> {
  const db = supabaseAdmin()
  const [{ data: shifts }, { data: tasks }] = await Promise.all([
    db.from('garden_shifts').select('id,staff_id,rooms,role').eq('date', date).eq('role', 'housekeeping'),
    db.from('garden_tasks').select('id,room_name,kind,status').eq('date', date).in('kind', ['clean', 'stayover']).neq('status', 'cancelled'),
  ])
  const S = (shifts || []) as any[]
  if (!S.length) return { assigned: 0, perPerson: {} }
  const rooms = Array.from(new Set(((tasks || []) as any[]).map(t => t.room_name).filter(Boolean) as string[]))
  const taken = new Set(S.flatMap(s => s.rooms || []))
  const free = rooms.filter(r => !taken.has(r))
  const buckets = S.map(s => [...(s.rooms || [])] as string[])
  for (const r of free) { let i = 0; for (let j = 1; j < buckets.length; j++) if (buckets[j].length < buckets[i].length) i = j; buckets[i].push(r) }
  const perPerson: Record<string, string[]> = {}
  for (let i = 0; i < S.length; i++) { await db.from('garden_shifts').update({ rooms: buckets[i] }).eq('id', S[i].id); perPerson[S[i].staff_id] = buckets[i] }
  // Tasks follow the room's housekeeper.
  const { data: staff } = await db.from('garden_staff').select('id,name').in('id', S.map(s => s.staff_id))
  const nameOf: Record<string, string> = {}; for (const s of ((staff || []) as any[])) nameOf[s.id] = s.name
  for (let i = 0; i < S.length; i++) for (const room of buckets[i]) await db.from('garden_tasks').update({ assigned_to: nameOf[S[i].staff_id] || null }).eq('date', date).eq('room_name', room).in('kind', ['clean', 'stayover']).is('assigned_to', null)
  return { assigned: free.length, perPerson }
}

export const weekStart = (ymd?: string) => { const d = ymd || todayET(0); const dow = new Date(d + 'T12:00:00Z').getUTCDay(); return addDays(d, -((dow + 6) % 7)) }
