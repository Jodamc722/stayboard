// THE HOUSEKEEPING DAY PLAN (Jon, 2026-11-20: "a world class stayover, check-in and checkouts for
// schedule … need this for HK and needs to be accurate — checkouts, stayovers, same day turns … be
// able to assign and push to Cloudbeds").
//
// One row per room that has work on a date, built from the bookings and the room itself — never from
// the task list alone (a task made yesterday for a booking cancelled this morning is how a cleaner
// gets sent to a room nobody left):
//
//   turn       a guest leaves AND another arrives the same day — first, always
//   checkout   a guest leaves, nobody arrives today
//   stayover   a guest is staying through (in the room last night and tonight)
//   arrival    a guest arrives into a room nobody left today — only work when the room is not ready
//   dirty      vacant, dirty, no booking today — to be turned when there is time
//
// WHERE EACH ROOM STANDS comes from Cloudbeds, which is where this hotel's team marks rooms (no task
// has ever been ticked in Lighthouse): the guest's status (still in / gone / arrived) and the room's
// condition (dirty → clean → inspected). Cloudbeds turns an occupied room dirty at check-in and again
// around 2 AM, so "dirty" means "to do" only when it can: a checkout the guest has left, a stayover
// not yet serviced today, a vacant room.
//
// THE CHECK: Cloudbeds publishes its own label per room (check-out / check-in / stayover / turnover).
// Every row is compared with it; a room where the two disagree is returned in `mismatches`, so the
// page can say "matches Cloudbeds" or show exactly which rooms to look at.
//
// A future date is a forecast from the bookings (no conditions yet); today is live.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { todayET } from './sync'
import { readNotes } from './notes-read'

export const HK_MINUTES = { turn: 45, checkout: 45, stayover: 20, arrival: 30, dirty: 45, inspect: 8 } as const
export const SHIFT_MINUTES = 420   // a 7-hour working shift once breaks are out
export type HkType = 'turn' | 'checkout' | 'stayover' | 'arrival' | 'dirty'
// waiting = the guest has not left yet · todo · cleaning · inspect = clean, to be inspected · ready ·
// done = serviced / the new guest is in · skip = do not disturb, refused or no-housekeeping · planned = a future day
export type HkState = 'waiting' | 'todo' | 'cleaning' | 'inspect' | 'ready' | 'done' | 'skip' | 'planned'
export type HkGuest = { id: string; name: string; status: string; nights: number | null; checkIn: string; checkOut: string; people: string; tags: { key: string; label: string; tone: string }[] }
export type HkRow = {
  roomId: string; room: string; area: string; roomType: string | null; type: HkType; state: HkState; minutes: number
  out: HkGuest | null; in: HkGuest | null; stay: (HkGuest & { night: number }) | null
  condition: string | null; occupied: boolean | null; dnd: boolean; refused: boolean; comments: string | null
  assignedTo: string | null; assignedFrom: 'lighthouse' | 'cloudbeds' | null; taskIds: string[]; skipWhy: string | null; flag: string | null
  /** Inspections (Jon, 2026-11-20: "for schedule also have inspections / inspected rooms"): who is to inspect it, and when it was inspected today and by whom. */
  inspector: string | null; inspectedAt: string | null; inspectedBy: string | null
}

const s = (v: any) => (v == null ? '' : String(v))
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const LIVE = ['confirmed', 'not_confirmed', 'checked_in', 'checked_out']
/** 216 → "200s", 2207 → "2000s": the hotel's room numbers lead with the wing / building. */
export const areaOf = (name: string) => { const d = s(name).replace(/\D/g, ''); return d.length >= 4 ? d[0] + '000s' : d.length === 3 ? d[0] + '00s' : 'Other' }
const KEEP_TAGS = ['eci', 'lco', 'vip', 'nohk', 'pet', 'nomove', 'access', 'connecting', 'topfloor']

function classify(date: string, t0: string, R: any[]) {
  const out = R.find(r => r.check_out === date && r.check_in < date) || R.find(r => r.check_out === date) || null
  const inn = R.find(r => r.check_in === date && r.id !== out?.id) || null
  const stay = R.find(r => r.check_in < date && r.check_out > date) || null
  void t0
  return { out, inn, stay }
}

export async function hkPlan(dateIn?: string) {
  const db = supabaseAdmin()
  const t0 = todayET(0)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(s(dateIn)) ? s(dateIn) : t0
  const live = date === t0
  const wkTo = addDays(t0, 6)
  const lo = date < t0 ? date : t0, hi = date > wkTo ? date : wkTo

  const [roomsQ, resQ, tasksQ, blocksQ, staffQ, shiftsQ] = await Promise.all([
    db.from('garden_rooms').select('id,name,room_type,status,hk_status,occupied,housekeeper,hk_comments,dnd,refused_service,frontdesk_status,blocked,hk_updated_at').or('raw->>isVirtual.is.null,raw->>isVirtual.eq.false').order('name'),
    db.from('garden_reservations').select('id,status,guest_name,check_in,check_out,nights,adults,children,room_ids,source').in('status', LIVE).lte('check_in', hi).gte('check_out', lo).limit(5000),
    db.from('garden_tasks').select('id,room_id,kind,status,assigned_to,started_at,finished_at').eq('date', date).in('kind', ['clean', 'stayover', 'inspection']).neq('status', 'cancelled'),
    db.from('garden_room_blocks').select('room_ids,kind,reason,start_date,end_date').lte('start_date', date).then(r => r, () => ({ data: [] as any[] })),
    db.from('garden_staff').select('id,name,role,active').eq('active', true).in('role', ['housekeeping', 'manager']).order('name'),
    db.from('garden_shifts').select('id,date,staff_id,role,start_time,end_time,source').gte('date', lo).lte('date', hi).eq('role', 'housekeeping').then(r => r, () => ({ data: [] as any[] })),
  ])
  if (roomsQ.error) throw new Error(roomsQ.error.message)
  if (resQ.error) throw new Error(resQ.error.message)
  const rooms = (roomsQ.data || []) as any[]
  const RES = (resQ.data || []) as any[]
  const oos = new Set<string>()
  for (const b of ((blocksQ.data || []) as any[])) if (!b.end_date || b.end_date >= date) for (const id of (b.room_ids || [])) oos.add(s(id))

  // Notes → the few tags housekeeping acts on (late checkout, early check-in, no housekeeping, VIP, pet).
  const dayRes = RES.filter(r => r.check_in <= date && r.check_out >= date)
  const tagsBy: Record<string, HkGuest['tags']> = {}
  if (dayRes.length) {
    const ids = dayRes.map(r => 'note:' + r.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('garden_messages').select('thread_id,body').in('thread_id', ids.slice(i, i + 200))
      const by: Record<string, string[]> = {}
      for (const m of ((data || []) as any[])) (by[s(m.thread_id).slice(5)] = by[s(m.thread_id).slice(5)] || []).push(s(m.body))
      for (const [k, v] of Object.entries(by)) tagsBy[k] = readNotes(v).tags.filter(t => KEEP_TAGS.includes(t.key)).map(t => ({ key: t.key, label: t.label, tone: t.tone }))
    }
  }
  const guest = (r: any): HkGuest => ({ id: s(r.id), name: s(r.guest_name) || 'Guest', status: s(r.status), nights: r.nights ?? null, checkIn: r.check_in, checkOut: r.check_out, people: `${r.adults || 0}${r.children ? '+' + r.children : ''}`, tags: tagsBy[s(r.id)] || [] })

  const resByRoom: Record<string, any[]> = {}
  for (const r of dayRes) for (const id of (r.room_ids || [])) (resByRoom[s(id)] = resByRoom[s(id)] || []).push(r)
  const tasksByRoom: Record<string, any[]> = {}
  for (const t of ((tasksQ.data || []) as any[])) if (t.room_id) (tasksByRoom[s(t.room_id)] = tasksByRoom[s(t.room_id)] || []).push(t)

  // Today's inspections as they were logged (lib/garden/hk-perf): when, and who pressed it here.
  const inspLog: Record<string, { at: string; by: string | null }> = {}
  if (live) { try { const { data } = await db.from('garden_hk_log').select('room_id,at,by_email').eq('date', date).eq('event', 'inspected'); for (const l of ((data || []) as any[])) inspLog[s(l.room_id)] = { at: s(l.at), by: l.by_email ? s(l.by_email).split('@')[0] : null } } catch { /* table not there yet */ } }
  const rows: HkRow[] = [], mismatches: { room: string; ours: string; cloudbeds: string }[] = [], notArrived: { room: string; guest: string }[] = []
  for (const rm of rooms) {
    const id = s(rm.id), R = resByRoom[id] || [], T = tasksByRoom[id] || []
    const { out, inn, stay } = classify(date, t0, R)
    const cond = rm.hk_status ? s(rm.hk_status) : null
    const occ = rm.occupied == null ? null : !!rm.occupied
    const blocked = oos.has(id) || !!rm.blocked || (rm.status && rm.status !== 'active')
    let type: HkType | null = out && inn ? 'turn' : out ? 'checkout' : stay ? 'stayover' : inn ? 'arrival' : null
    let flag: string | null = null

    // A stay through today only counts when someone is actually in the room. A booking left
    // "confirmed" that never arrived is not a stayover clean; a checked-in room Cloudbeds shows empty
    // (a second room of a booking nobody took) is not one either.
    if (live && type === 'stayover') {
      if (stay.status === 'checked_out') type = cond === 'dirty' ? 'dirty' : null     // left early
      else if (stay.status !== 'checked_in' && occ !== true) { notArrived.push({ room: rm.name, guest: s(stay.guest_name) || 'Guest' }); type = null }
      else if (stay.status === 'checked_in' && occ === false) { flag = 'Cloudbeds shows this room empty'; type = null }
    }
    if (!type && live && cond === 'dirty' && occ !== true && !blocked) type = 'dirty'
    if (!type) {
      if (live && rm.frontdesk_status && !['unused', ''].includes(s(rm.frontdesk_status)) && !flag) mismatches.push({ room: rm.name, ours: 'no work', cloudbeds: s(rm.frontdesk_status) })
      continue
    }

    // Where it stands.
    let state: HkState = 'planned', skipWhy: string | null = null
    const inProgress = T.some(t => t.status === 'in_progress' && t.kind !== 'inspection')
    const noHk = (stay && (tagsBy[s(stay.id)] || []).some(t => t.key === 'nohk')) || false
    if (live) {
      const byCond: HkState = cond === 'inspected' ? 'ready' : cond === 'clean' ? 'inspect' : inProgress ? 'cleaning' : 'todo'
      if (type === 'turn' || type === 'checkout') {
        if (inn && inn.status === 'checked_in') state = 'done'                    // the next guest is already in
        else if (out.status === 'checked_in') state = 'waiting'                    // not left yet
        else { state = byCond; if (out.status !== 'checked_out') flag = 'Not checked out in Cloudbeds' }
      } else if (type === 'stayover') {
        if (rm.dnd) { state = 'skip'; skipWhy = 'Do not disturb' }
        else if (rm.refused_service) { state = 'skip'; skipWhy = 'Refused service' }
        else if (noHk) { state = 'skip'; skipWhy = 'No housekeeping (note)' }
        else state = cond === 'clean' || cond === 'inspected' ? 'done' : inProgress ? 'cleaning' : 'todo'
      } else if (type === 'arrival') state = inn.status === 'checked_in' ? 'done' : byCond
      else state = inProgress ? 'cleaning' : 'todo'
    }
    const minutes = state === 'inspect' ? HK_MINUTES.inspect : ['ready', 'done', 'skip'].includes(state) ? 0 : HK_MINUTES[type]
    const tAssigned = T.find(t => t.assigned_to && t.kind !== 'inspection')?.assigned_to || null
    const insp = T.find(t => t.kind === 'inspection') || null, il = inspLog[id] || null
    const cbAssigned = live && rm.housekeeper ? s(rm.housekeeper) : null
    rows.push({
      roomId: id, room: s(rm.name), area: areaOf(rm.name), roomType: rm.room_type || null, type, state, minutes,
      out: out ? guest(out) : null, in: inn ? guest(inn) : null, stay: stay && type === 'stayover' ? { ...guest(stay), night: Math.max(1, Math.round((Date.parse(date) - Date.parse(stay.check_in)) / 86400000)) } : null,
      condition: live ? cond : null, occupied: live ? occ : null, dnd: !!rm.dnd, refused: !!rm.refused_service, comments: rm.hk_comments || null,
      assignedTo: tAssigned || cbAssigned, assignedFrom: tAssigned ? 'lighthouse' : cbAssigned ? 'cloudbeds' : null, taskIds: T.map(t => s(t.id)), inspector: insp?.assigned_to || null, inspectedAt: il?.at || null, inspectedBy: il?.by || (il ? insp?.assigned_to || null : null), skipWhy, flag: blocked ? 'Blocked / out of service in Cloudbeds' : flag,
    })
    if (live && rm.frontdesk_status) {
      const cb = s(rm.frontdesk_status), ours = type === 'turn' ? 'turnover' : type === 'checkout' ? 'check-out' : type === 'stayover' ? 'stayover' : type === 'arrival' ? 'check-in' : 'unused'
      if (cb !== ours) mismatches.push({ room: rm.name, ours, cloudbeds: cb })
    }
  }

  const ORDER: Record<HkType, number> = { turn: 0, arrival: 1, checkout: 2, stayover: 3, dirty: 4 }
  const SORDER: Record<HkState, number> = { todo: 0, cleaning: 1, waiting: 2, inspect: 3, planned: 4, ready: 5, skip: 6, done: 7 }
  rows.sort((a, b) => ORDER[a.type] - ORDER[b.type] || SORDER[a.state] - SORDER[b.state] || a.room.localeCompare(b.room, undefined, { numeric: true }))

  const n = (f: (r: HkRow) => boolean) => rows.filter(f).length
  const open = (r: HkRow) => !['ready', 'done', 'skip'].includes(r.state)
  const finished = (r: HkRow) => ['ready', 'done'].includes(r.state)
  const byType = (t: HkType) => ({ total: n(r => r.type === t), done: n(r => r.type === t && finished(r)), open: n(r => r.type === t && open(r)), waiting: n(r => r.type === t && r.state === 'waiting'), skip: n(r => r.type === t && r.state === 'skip') })
  const minutes = rows.reduce((a, r) => a + r.minutes, 0)
  // Needed = the whole day's work (not what is left), so it does not shrink as rooms get done.
  const plannedAll = rows.reduce((a, r) => a + (r.type === 'stayover' ? (r.state === 'skip' ? 0 : HK_MINUTES.stayover) : r.type === 'turn' || r.type === 'checkout' ? HK_MINUTES.checkout : 0), 0)

  // People: the hotel's housekeepers, who is on the schedule that day, and each one's load.
  const allStaff = ((staffQ.data || []) as any[])
  const staff = allStaff.filter(p => p.role === 'housekeeping')
  // Anyone on the housekeeping or management roster can be given inspections.
  const inspBy: Record<string, { todo: number; done: number }> = {}
  for (const r of rows) if (r.inspector) { const x = inspBy[r.inspector] = inspBy[r.inspector] || { todo: 0, done: 0 }; if (r.state === 'inspect' || (!r.inspectedAt && r.condition !== 'inspected')) x.todo++; else x.done++ }
  const inspectors = allStaff.map(p => ({ name: s(p.name), role: s(p.role), ...(inspBy[s(p.name)] || { todo: 0, done: 0 }) }))
  const SH = ((shiftsQ.data || []) as any[])
  const shiftOf: Record<string, string> = {}, shiftSrc: Record<string, { source: string; hours: string }> = {}
  for (const x of SH) if (x.date === date) { shiftOf[s(x.staff_id)] = s(x.id); shiftSrc[s(x.staff_id)] = { source: s(x.source) || 'manual', hours: `${s(x.start_time).slice(0, 5)}–${s(x.end_time).slice(0, 5)}` } }
  const onIds = new Set(Object.keys(shiftOf))
  const loadBy: Record<string, { rooms: number; minutes: number; done: number }> = {}
  for (const r of rows) if (r.assignedTo) { const l = loadBy[r.assignedTo] = loadBy[r.assignedTo] || { rooms: 0, minutes: 0, done: 0 }; l.rooms++; l.minutes += r.minutes; if (finished(r)) l.done++ }
  const people: { id: string; name: string; onShift: boolean; shiftId: string | null; shiftFrom: string | null; hours: string | null; rooms: number; minutes: number; done: number }[] = staff.map(p => ({ id: s(p.id), name: s(p.name), onShift: onIds.has(s(p.id)), shiftId: shiftOf[s(p.id)] || null, shiftFrom: shiftSrc[s(p.id)]?.source || null, hours: shiftSrc[s(p.id)]?.hours || null, ...(loadBy[p.name] || { rooms: 0, minutes: 0, done: 0 }) }))
  for (const nm of Object.keys(loadBy)) if (!people.some(p => p.name === nm)) people.push({ id: 'cb:' + nm, name: nm, onShift: false, shiftId: null, shiftFrom: null, hours: null, ...loadBy[nm] })

  // The week ahead, from the bookings: what each day holds, in rooms.
  const week: { date: string; turns: number; checkouts: number; stayovers: number; arrivals: number; rooms: number; minutes: number; need: number; scheduled: number }[] = []
  const phys = new Set(rooms.map(r => s(r.id)))
  for (let i = 0; i < 7; i++) {
    const d = addDays(t0, i)
    const by: Record<string, any[]> = {}
    for (const r of RES) if (r.check_in <= d && r.check_out >= d) for (const id of (r.room_ids || [])) if (phys.has(s(id))) (by[s(id)] = by[s(id)] || []).push(r)
    let turns = 0, checkouts = 0, stayovers = 0, arrivals = 0
    for (const R of Object.values(by)) { const c = classify(d, t0, R); if (c.out && c.inn) turns++; else if (c.out) checkouts++; else if (c.stay) { if (c.stay.status !== 'checked_out') stayovers++ } else if (c.inn) arrivals++ }
    const m = (turns + checkouts) * HK_MINUTES.checkout + stayovers * HK_MINUTES.stayover
    week.push({ date: d, turns, checkouts, stayovers, arrivals: arrivals + turns, rooms: turns + checkouts + stayovers, minutes: m, need: m ? Math.max(1, Math.ceil(m / SHIFT_MINUTES)) : 0, scheduled: new Set(SH.filter(x => x.date === d).map(x => s(x.staff_id))).size })
  }

  // Homebase: is the hotel's schedule coming from it?
  let homebase: { connected: boolean; mode: string; at: string | null; error: string | null } = { connected: false, mode: 'none', at: null, error: null }
  try {
    const hb = await import('./homebase')
    const mode = hb.hbMode().mode
    const locs = mode === 'none' ? [] : await hb.gardenHbSettings().then(x => x.locationUuids)
    const { data: st } = await db.from('garden_sync_status').select('last_sync_at,last_error').eq('entity', 'homebase_shifts').maybeSingle()
    homebase = { connected: mode === 'own' || locs.length > 0, mode, at: (st as any)?.last_sync_at || null, error: (st as any)?.last_error || null }
  } catch { /* not set up */ }
  const { data: sync } = await db.from('garden_sync_status').select('entity,last_sync_at,last_error').in('entity', ['reservations', 'housekeeping'])
  const syncAt = ((sync || []) as any[]).map(x => x.last_sync_at).filter(Boolean).sort()[0] || null
  return {
    date, today: t0, live, rows,
    summary: {
      turn: byType('turn'), checkout: byType('checkout'), stayover: byType('stayover'), arrival: byType('arrival'), dirty: byType('dirty'),
      arrivalsReady: n(r => !!r.in && (r.state === 'ready' || r.state === 'done')), arrivals: n(r => !!r.in),
      toInspect: n(r => r.state === 'inspect'), inspected: n(r => r.condition === 'inspected' || !!r.inspectedAt), inspectorless: n(r => r.state === 'inspect' && !r.inspector), minutes, working: people.filter(p => p.onShift).length,
      plannedMinutes: rows.reduce((a, r) => a + (r.type === 'stayover' ? HK_MINUTES.stayover : r.type === 'turn' || r.type === 'checkout' ? HK_MINUTES.checkout : 0), 0),
      need: plannedAll ? Math.max(1, Math.ceil(plannedAll / SHIFT_MINUTES)) : 0,
      unassigned: n(r => open(r) && r.state !== 'inspect' && !r.assignedTo), rooms: rooms.length, outOfService: rooms.filter(r => oos.has(s(r.id)) || r.blocked).length,
    },
    people, inspectors, week, homebase, mismatches: live ? mismatches : [], notArrived, syncAt,
    syncError: ((sync || []) as any[]).map(x => x.last_error).filter(Boolean)[0] || null,
  }
}
