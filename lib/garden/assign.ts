// ASSIGNING CLEANERS (Jon, 2026-11-11: "be able to assign cleaners, show board, stayovers vs
// checkouts"). One day's housekeeping work — every checkout clean and stayover — handed to people.
//
//   assignRooms   these rooms → this housekeeper (or back to unassigned). The day's clean / stayover
//                 tasks for the rooms take the name; Cloudbeds gets the assignment too when it knows
//                 the person (their housekeeperID, learned from its own room assignments). A Cloudbeds
//                 refusal never undoes the Lighthouse assignment — it comes back as a warning.
//   autoAssign    the unassigned rooms split across the people working, by workload (a checkout
//                 counts 45 minutes, a stayover 20), floor by floor so nobody zig-zags the building.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { assignHousekeeper, cloudbedsConfigured } from './cloudbeds'

export const MINUTES = { clean: 45, stayover: 20 } as const
const floorOf = (name: string) => { const d = String(name || '').replace(/\D/g, ''); return d.length >= 3 ? Number(d.slice(0, -2)) : 0 }

async function cloudbedsIds(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin().from('garden_rooms').select('housekeeper,housekeeper_id').not('housekeeper_id', 'is', null)
  const m: Record<string, string> = {}
  for (const r of ((data || []) as any[])) if (r.housekeeper && r.housekeeper_id) m[String(r.housekeeper).trim().toLowerCase()] = String(r.housekeeper_id)
  return m
}

export async function assignRooms(date: string, roomIds: string[], to: string | null): Promise<{ ok: true; tasks: number; cloudbeds: 'sent' | 'not known to Cloudbeds' | 'skipped' | string }> {
  const db = supabaseAdmin()
  const ids = Array.from(new Set(roomIds.map(String))).slice(0, 200)
  const { data: tasks, error } = await db.from('garden_tasks').update({ assigned_to: to }).eq('date', date).in('room_id', ids).in('kind', ['clean', 'stayover']).neq('status', 'cancelled').select('id')
  if (error) throw new Error(error.message)
  let cloudbeds: string = 'skipped'
  if (to && cloudbedsConfigured()) {
    const hk = (await cloudbedsIds())[to.trim().toLowerCase()]
    if (!hk) cloudbeds = 'not known to Cloudbeds'
    else {
      try { await assignHousekeeper(hk, ids); cloudbeds = 'sent'; await db.from('garden_rooms').update({ housekeeper: to, housekeeper_id: hk }).in('id', ids) }
      catch (e: any) { cloudbeds = 'Cloudbeds refused: ' + String(e?.message || e).slice(0, 160) }
    }
  }
  return { ok: true, tasks: (tasks || []).length, cloudbeds }
}

export async function autoAssign(date: string, people: string[]): Promise<{ ok: true; assigned: number; perPerson: Record<string, { rooms: string[]; minutes: number }>; warnings: string[] }> {
  const db = supabaseAdmin()
  const { data } = await db.from('garden_tasks').select('room_id,room_name,kind,assigned_to,status').eq('date', date).in('kind', ['clean', 'stayover']).neq('status', 'cancelled')
  const T = (data || []) as any[]
  const names = Array.from(new Set(people.map(p => p.trim()).filter(Boolean)))
  if (!names.length) throw new Error('Nobody to assign to — put housekeepers on the schedule for the day, or pick them.')
  // Each room once; a room with a checkout counts as a checkout.
  const rooms = new Map<string, { id: string; name: string; min: number; who: string | null }>()
  for (const t of T) {
    const cur = rooms.get(t.room_id), min = MINUTES[t.kind as 'clean' | 'stayover'] || 30
    if (!cur) rooms.set(t.room_id, { id: t.room_id, name: t.room_name, min, who: t.assigned_to || null })
    else { cur.min = Math.max(cur.min, min); cur.who = cur.who || t.assigned_to || null }
  }
  const load: Record<string, number> = Object.fromEntries(names.map(n => [n, 0]))
  for (const r of Array.from(rooms.values())) if (r.who && load[r.who] != null) load[r.who] += r.min
  const free = Array.from(rooms.values()).filter(r => !r.who || load[r.who] == null).sort((a, b) => floorOf(a.name) - floorOf(b.name) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  // Floor by floor: keep a floor with one person while they are the lightest or near it.
  const plan: Record<string, string[]> = Object.fromEntries(names.map(n => [n, []]))
  let last: string | null = null, lastFloor = -1
  const total = free.reduce((a, r) => a + r.min, 0) + Object.values(load).reduce((a, b) => a + b, 0)
  const target = total / names.length
  for (const r of free) {
    const lightest = names.reduce((a, b) => (load[a] <= load[b] ? a : b))
    const who: string = last && floorOf(r.name) === lastFloor && load[last] + r.min <= target + 30 ? last : lightest
    plan[who].push(r.id); load[who] += r.min; last = who; lastFloor = floorOf(r.name)
  }
  const warnings: string[] = []
  const perPerson: Record<string, { rooms: string[]; minutes: number }> = {}
  for (const n of names) {
    if (plan[n].length) { const r = await assignRooms(date, plan[n], n); if (r.cloudbeds !== 'sent' && r.cloudbeds !== 'skipped') warnings.push(`${n}: ${r.cloudbeds}`) }
    perPerson[n] = { rooms: plan[n].map(id => rooms.get(id)!.name), minutes: load[n] }
  }
  return { ok: true, assigned: free.length, perPerson, warnings }
}
