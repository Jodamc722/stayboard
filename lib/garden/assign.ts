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
import { assignHousekeeper, cloudbedsConfigured, cbGet, cbPost } from './cloudbeds'

export const MINUTES = { clean: 45, stayover: 20 } as const

const norm = (n: string) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ')
let hkCache: { at: number; map: Record<string, string> } | null = null
/** Cloudbeds' own housekeeper list (name → housekeeperID), plus whoever its room assignments name. Cached 10 minutes. */
async function cloudbedsIds(): Promise<Record<string, string>> {
  if (hkCache && Date.now() - hkCache.at < 600_000) return hkCache.map
  const m: Record<string, string> = {}
  const { data } = await supabaseAdmin().from('garden_rooms').select('housekeeper,housekeeper_id').not('housekeeper_id', 'is', null)
  for (const r of ((data || []) as any[])) if (r.housekeeper && r.housekeeper_id) m[norm(r.housekeeper)] = String(r.housekeeper_id)
  if (cloudbedsConfigured()) {
    try {
      const { data: hk } = await cbGet<any>('getHousekeepers', { pageSize: 100 })
      const flat: any[] = (Array.isArray(hk) ? hk : [hk]).flatMap((x: any) => Array.isArray(x?.housekeepers) ? x.housekeepers : x && typeof x === 'object' && !x.housekeeperID ? Object.values(x) : [x])
      for (const h of flat) if (h?.housekeeperID && (h.name || h.housekeeperName)) m[norm(h.name || h.housekeeperName)] = String(h.housekeeperID)
    } catch { /* the room assignments still give the people Cloudbeds has used */ }
  }
  hkCache = { at: Date.now(), map: m }
  return m
}
const todayNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const PUSHED = 'garden_hk_pushed'

/**
 * Rooms → a housekeeper for a date (to: null = unassigned).
 *   Lighthouse   the date's clean / stayover tasks for the rooms take the name; a room with work but no
 *                task yet (an arrival room that is not ready, a vacant dirty room) gets a clean task.
 *   Cloudbeds    holds one housekeeper per room, with no date — so it is written only for TODAY. A
 *                later day is kept here and sent on the morning of the day (pushDayAssignments).
 */
export async function assignRooms(date: string, roomIds: string[], to: string | null): Promise<{ ok: true; tasks: number; cloudbeds: 'sent' | 'not known to Cloudbeds' | 'skipped' | string }> {
  const db = supabaseAdmin()
  const ids = Array.from(new Set(roomIds.map(String))).slice(0, 200)
  if (!ids.length) return { ok: true, tasks: 0, cloudbeds: 'skipped' }
  const { data: tasks, error } = await db.from('garden_tasks').update({ assigned_to: to, updated_at: new Date().toISOString() }).eq('date', date).in('room_id', ids).in('kind', ['clean', 'stayover']).neq('status', 'cancelled').select('id,room_id')
  if (error) throw new Error(error.message)
  let n = (tasks || []).length
  if (to) {
    const got = new Set(((tasks || []) as any[]).map(t => String(t.room_id)))
    const missing = ids.filter(id => !got.has(id))
    if (missing.length) {
      const { data: rm } = await db.from('garden_rooms').select('id,name').in('id', missing)
      const rows = ((rm || []) as any[]).map(r => ({ room_id: r.id, room_name: r.name, date, kind: 'clean', assigned_to: to, source: 'lighthouse', note: 'Assigned from the housekeeping plan' }))
      if (rows.length) { const ins = await db.from('garden_tasks').insert(rows); if (!ins.error) n += rows.length }
    }
  }
  let cloudbeds: string = 'skipped'
  if (!cloudbedsConfigured()) cloudbeds = 'Cloudbeds is not connected'
  else if (date !== todayNY()) cloudbeds = 'saved — goes to Cloudbeds on the day'
  else if (!to) {
    // No housekeeperID = unassign in Cloudbeds.
    try { await cbPost('postHousekeepingAssignment', { roomIDs: ids.join(',') }); cloudbeds = 'sent'; await db.from('garden_rooms').update({ housekeeper: null, housekeeper_id: null }).in('id', ids) }
    catch (e: any) { cloudbeds = 'Unassigned here; Cloudbeds kept its own: ' + String(e?.message || e).slice(0, 120) }
  } else {
    const hk = (await cloudbedsIds())[norm(to)]
    if (!hk) cloudbeds = 'not known to Cloudbeds'
    else {
      try { await assignHousekeeper(hk, ids); cloudbeds = 'sent'; await db.from('garden_rooms').update({ housekeeper: to, housekeeper_id: hk }).in('id', ids); await markPushed(ids, to) }
      catch (e: any) { cloudbeds = 'Cloudbeds refused: ' + String(e?.message || e).slice(0, 160) }
    }
  }
  return { ok: true, tasks: n, cloudbeds }
}

async function markPushed(ids: string[], to: string) {
  const { getSettingFresh, setSetting } = await import('../app-settings')
  const day = todayNY()
  const cur = await getSettingFresh<any>(PUSHED, null).catch(() => null)
  const rooms: Record<string, string> = cur?.day === day ? { ...(cur.rooms || {}) } : {}
  for (const id of ids) rooms[id] = to
  await setSetting(PUSHED, { day, rooms }, 'hk-plan').catch(() => {})
}

/**
 * Runs with the sync. Today's assignments that Cloudbeds does not have yet (made yesterday for today,
 * or refused earlier) are sent once each. Once sent, a change made in Cloudbeds itself is left alone.
 */
export async function pushDayAssignments(): Promise<number> {
  if (!cloudbedsConfigured()) return 0
  const db = supabaseAdmin()
  const day = todayNY()
  const { getSettingFresh } = await import('../app-settings')
  const cur = await getSettingFresh<any>(PUSHED, null).catch(() => null)
  const sent: Record<string, string> = cur?.day === day ? (cur.rooms || {}) : {}
  const [{ data: tasks }, { data: rooms }] = await Promise.all([
    db.from('garden_tasks').select('room_id,assigned_to').eq('date', day).in('kind', ['clean', 'stayover']).neq('status', 'cancelled').not('assigned_to', 'is', null),
    db.from('garden_rooms').select('id,housekeeper'),
  ])
  const cb: Record<string, string> = {}; for (const r of ((rooms || []) as any[])) cb[String(r.id)] = norm(r.housekeeper || '')
  const by: Record<string, Set<string>> = {}
  for (const t of ((tasks || []) as any[])) { const id = String(t.room_id || ''), to = String(t.assigned_to); if (!id || sent[id] === to || cb[id] === norm(to)) continue; (by[to] = by[to] || new Set()).add(id) }
  const ids = await cloudbedsIds()
  let n = 0
  for (const [to, set] of Object.entries(by)) {
    const hk = ids[norm(to)]; if (!hk) continue
    const list = Array.from(set)
    try { await assignHousekeeper(hk, list); await db.from('garden_rooms').update({ housekeeper: to, housekeeper_id: hk }).in('id', list); await markPushed(list, to); n += list.length } catch { /* next sync tries again */ }
  }
  return n
}

/**
 * Split the day's unassigned work across these people, from the housekeeping plan (lib/garden/hk-plan) —
 * so it is the same rooms the page shows: turns, checkouts, stayovers, arrival rooms not ready. Balanced
 * by minutes; a wing stays with one person while they are near the lightest, so nobody zig-zags.
 */
export async function autoAssign(date: string, people: string[]): Promise<{ ok: true; assigned: number; perPerson: Record<string, { rooms: string[]; minutes: number }>; warnings: string[]; cloudbeds: string }> {
  const { hkPlan } = await import('./hk-plan')
  const plan = await hkPlan(date)
  const names = Array.from(new Set(people.map(p => p.trim()).filter(Boolean)))
  if (!names.length) throw new Error('Nobody to assign to — pick the housekeepers working that day.')
  const work = plan.rows.filter(r => !['ready', 'done', 'skip', 'inspect'].includes(r.state) && !(r.type === 'dirty' && r.flag))
  const load: Record<string, number> = Object.fromEntries(names.map(n => [n, 0]))
  for (const r of work) if (r.assignedTo && load[r.assignedTo] != null) load[r.assignedTo] += r.minutes
  const free = work.filter(r => !r.assignedTo || load[r.assignedTo] == null).sort((a, b) => a.area.localeCompare(b.area, undefined, { numeric: true }) || a.room.localeCompare(b.room, undefined, { numeric: true }))
  const target = work.reduce((a, r) => a + r.minutes, 0) / names.length
  const picks: Record<string, typeof free> = Object.fromEntries(names.map(n => [n, []]))
  let last: string | null = null, lastArea = ''
  for (const r of free) {
    const lightest = names.reduce((a, b) => (load[a] <= load[b] ? a : b))
    const who: string = last && r.area === lastArea && load[last] + r.minutes <= target + 30 ? last : lightest
    picks[who].push(r); load[who] += r.minutes; last = who; lastArea = r.area
  }
  const warnings: string[] = []; let cloudbeds = 'skipped'
  const perPerson: Record<string, { rooms: string[]; minutes: number }> = {}
  for (const n of names) {
    if (picks[n].length) { const r = await assignRooms(date, picks[n].map(x => x.roomId), n); cloudbeds = r.cloudbeds === 'sent' || cloudbeds === 'skipped' ? r.cloudbeds : cloudbeds; if (!['sent', 'skipped'].includes(r.cloudbeds) && !/on the day/.test(r.cloudbeds)) warnings.push(`${n}: ${r.cloudbeds}`) }
    perPerson[n] = { rooms: picks[n].map(x => x.room), minutes: load[n] }
  }
  return { ok: true, assigned: free.length, perPerson, warnings, cloudbeds }
}
