// GARDEN HOTEL FRONT DESK — everything the Today page needs, in one read.
//
// Jon (GM): "Today page is more for front desk… view the day operations, tasks, completions, who is
// working, unpaid, id verifications, etc." and "should also show all tasks from Cloudbeds operation
// management". Cloudbeds has no task API; what IS readable per room is the housekeeping condition,
// the assigned housekeeper, room comments, DND / refused service and room blocks (out of service) —
// mirrored into garden_rooms / garden_room_blocks by lib/garden/sync — plus the hotel's own
// garden_tasks. People come from garden_shifts (the schedule) and garden_timecards (Homebase).
//
// Every secondary read is defensive: a table or column that is not in the database yet (migration
// 170 adds the housekeeping detail columns and garden_room_blocks) degrades to "not available"
// instead of failing the page.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { todayET } from './sync'
import { readNotes, type NoteTag } from './notes-read'

const ET = 'America/New_York'
const LIVE = ['confirmed', 'not_confirmed', 'checked_in']
// on_file: Cloudbeds holds an ID document / a card, or Operto verified it — the desk need not chase it.
const OK_VER = ['passed', 'waived', 'on_file']
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const money = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const nowHHMM = () => new Intl.DateTimeFormat('en-GB', { timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())

const ROOM_BASE = 'id,name,room_type,floor,status,hk_status,occupied,hk_updated_at'
const ROOM_EXT = 'housekeeper,hk_comments,dnd,refused_service,frontdesk_status,blocked'
const missing = (e: any) => !!e && /column|does not exist|schema cache|relation/i.test(String(e.message || e))

async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await run(ids.slice(i, i + 200))
    if (error) { if (missing(error)) return out; throw new Error(error.message) }
    out.push(...((data || []) as T[]))
  }
  return out
}

export type VerState = 'passed' | 'waived' | 'failed' | 'pending' | 'on_file'
export type FdGuest = {
  id: string; guest: string; phone: string | null; email: string | null; status: string
  checkIn: string; checkOut: string; nights: number | null; adults: number | null; children: number | null
  rooms: string[]; roomIds: string[]; source: string | null; total: number; balance: number
  id_status: VerState; card_status: VerState; call: 'reached' | 'tried' | 'none'; callAttempts: number; lastCallAt: string | null
  done: boolean                                   // arrival: checked in · departure: checked out
  notes: string[]; noteTags: NoteTag[]; vehicle: string | null
  idType: string | null
  operto: { code: string | null; codeUsedAt: string | null; checkin: 'done' | 'started' | 'not_started' | null; idVerified: boolean | null } | null
}
export type FdRoom = {
  id: string; name: string; type: string | null; floor: string | null; status: string
  condition: string | null; occupied: boolean | null; conditionAt: string | null
  housekeeper: string | null; comments: string | null; dnd: boolean; refused: boolean; frontdesk: string | null
  oos: { kind: string | null; reason: string | null; until: string | null } | null
  stay: { guest: string; out: string } | null; arriving: string | null; departing: boolean
  tasks: { id: string; kind: string; status: string; assigned_to: string | null }[]
}
export type FdTask = { id: string; room_id: string | null; room_name: string | null; kind: string; status: string; assigned_to: string | null; priority: string | null; note: string | null; source: string | null; started_at: string | null; finished_at: string | null; finished_by: string | null }
export type FdPerson = {
  key: string; name: string; department: string; phone: string | null
  shift: { start: string; end: string; role: string; rooms: string[] } | null
  clockIn: string | null; clockOut: string | null; hours: number | null
  state: 'on' | 'done' | 'due' | 'late' | 'unscheduled'
}

export async function gardenFrontDesk() {
  const db = supabaseAdmin()
  const t0 = todayET(0), t2 = addDays(t0, 2)

  // Rooms: try the 170 columns, fall back without them. Virtual rooms (Cloudbeds' linked/combined
  // listings — 155 of the 310) are not physical rooms, so they are left out of counts and lists.
  let detail = true
  let roomsQ = await db.from('garden_rooms').select(`${ROOM_BASE},${ROOM_EXT}`).or('raw->>isVirtual.is.null,raw->>isVirtual.eq.false').order('name')
  if (roomsQ.error && missing(roomsQ.error)) { detail = false; roomsQ = await db.from('garden_rooms').select(ROOM_BASE).or('raw->>isVirtual.is.null,raw->>isVirtual.eq.false').order('name') as any }
  if (roomsQ.error) throw new Error(roomsQ.error.message)

  const [resQ, tasksQ, blocksQ, shiftsQ, cardsQ, syncQ] = await Promise.all([
    db.from('garden_reservations').select('id,status,guest_name,guest_phone,guest_email,check_in,check_out,nights,adults,children,room_ids,room_names,source,total,balance')
      .in('status', [...LIVE, 'checked_out']).lte('check_in', t2).gte('check_out', t0).order('check_in'),
    db.from('garden_tasks').select('id,room_id,room_name,kind,status,assigned_to,priority,note,source,started_at,finished_at,finished_by').eq('date', t0).order('room_name'),
    db.from('garden_room_blocks').select('id,room_ids,room_names,kind,reason,start_date,end_date').lte('start_date', t0),
    db.from('garden_shifts').select('id,staff_id,role,start_time,end_time,rooms,note').eq('date', t0).order('start_time'),
    db.from('garden_timecards').select('id,staff_id,name,role,date,clock_in,clock_out,hours,open').eq('date', t0),
    db.from('garden_sync_status').select('entity,last_sync_at,last_error').in('entity', ['rooms', 'reservations', 'housekeeping', 'homebase_timecards']),
  ])
  if (resQ.error) throw new Error(resQ.error.message)
  const blocksOk = !blocksQ.error, shiftsOk = !shiftsQ.error, cardsOk = !cardsQ.error

  const R = (resQ.data || []) as any[]
  const ids = R.map(r => String(r.id))
  const since = new Date(Date.now() - 21 * 86400000).toISOString()
  const { resDetails } = await import('./res-detail')
  const { opertoStore } = await import('./operto')
  const [det, ops, noteRows] = await Promise.all([
    resDetails().catch(() => ({} as Record<string, any>)),
    opertoStore().catch(() => null),
    inChunks<any>(ids.map(i => 'note:' + i), c => db.from('garden_messages').select('thread_id,body,sent_at').in('thread_id', c).order('sent_at')),
  ])
  const notesBy: Record<string, string[]> = {}
  for (const m of noteRows) { const k = String(m.thread_id).slice(5); (notesBy[k] = notesBy[k] || []).push(String(m.body || '')) }
  const [vers, calls, queue] = await Promise.all([
    inChunks<any>(ids, c => db.from('garden_verifications').select('reservation_id,kind,status').in('reservation_id', c)),
    inChunks<any>(ids, c => db.from('garden_calls').select('reservation_id,kind,outcome,called_at').in('reservation_id', c).gte('called_at', since)),
    inChunks<any>(ids, c => db.from('garden_call_queue').select('reservation_id,kind,status').in('reservation_id', c)),
  ])

  // Per-reservation desk state: verifications and call status.
  const ver: Record<string, Record<string, VerState>> = {}
  for (const v of vers) (ver[v.reservation_id] = ver[v.reservation_id] || {})[v.kind] = (v.status || 'pending') as VerState
  const callBy: Record<string, { reached: boolean; n: number; last: string | null }> = {}
  for (const c of calls) {
    if (!['pre_arrival', 'welcome', 'verification'].includes(c.kind)) continue
    const b = callBy[c.reservation_id] = callBy[c.reservation_id] || { reached: false, n: 0, last: null }
    b.n++; if (c.outcome === 'reached') b.reached = true
    if (!b.last || c.called_at > b.last) b.last = c.called_at
  }
  for (const q of queue) if (q.kind === 'welcome' && q.status === 'done') (callBy[q.reservation_id] = callBy[q.reservation_id] || { reached: false, n: 0, last: null }).reached = true

  const guest = (r: any, done: boolean): FdGuest => {
    const v = ver[r.id] || {}, c = callBy[r.id]
    const d = (det as any)[r.id] || null, op = ops?.byRes?.[r.id] || null
    const nts = notesBy[r.id] || [], rd = readNotes(nts)
    // A person's decision (passed / failed / waived) wins; otherwise what Cloudbeds or Operto hold.
    const idSt: VerState = v.id && v.id !== 'pending' ? v.id : (d?.idOnFile || op?.idVerified) ? 'on_file' : 'pending'
    const cardSt: VerState = v.card && v.card !== 'pending' ? v.card : d?.cardOnFile || rd.tags.some(t => t.key === 'prepaid' || t.key === 'preauth') ? 'on_file' : 'pending'
    return {
      id: String(r.id), guest: r.guest_name || 'Guest', phone: r.guest_phone || null, email: r.guest_email || null, status: r.status || '',
      checkIn: r.check_in, checkOut: r.check_out, nights: r.nights ?? null, adults: r.adults ?? null, children: r.children ?? null,
      rooms: r.room_names || [], roomIds: r.room_ids || [], source: r.source || null, total: money(r.total), balance: money(r.balance),
      id_status: idSt, card_status: cardSt,
      notes: nts, noteTags: rd.tags, vehicle: rd.vehicle, idType: d?.idType || null,
      operto: op ? { code: op.code, codeUsedAt: op.codeUsedAt, checkin: op.checkin, idVerified: op.idVerified } : null,
      call: c?.reached ? 'reached' : c?.n ? 'tried' : 'none', callAttempts: c?.n || 0, lastCallAt: c?.last || null, done,
    }
  }

  const arrivals = R.filter(r => r.check_in === t0).map(r => guest(r, r.status === 'checked_in' || r.status === 'checked_out'))
  const departures = R.filter(r => r.check_out === t0).map(r => guest(r, r.status === 'checked_out'))
  const inHouse = R.filter(r => r.status === 'checked_in' || (r.check_in < t0 && r.check_out > t0 && LIVE.includes(r.status))).map(r => guest(r, false))
  const upcoming = R.filter(r => r.check_in >= t0 && r.check_in <= t2 && LIVE.includes(r.status))

  // Unpaid: arriving / in-house / departing with a balance, once each, biggest first.
  const seen = new Set<string>()
  const unpaid = [...arrivals.filter(g => g.status !== 'checked_out'), ...inHouse, ...departures]
    .filter(g => { if (g.balance <= 0 || seen.has(g.id)) return false; seen.add(g.id); return true })
    .map(g => ({ ...g, when: g.checkOut === t0 ? 'departing' : g.checkIn === t0 && g.status !== 'checked_in' ? 'arriving' : 'in house' }))
    .sort((a, b) => b.balance - a.balance)

  // Verifications due: ID or card not passed/waived, arriving today through +2.
  const verifications = upcoming.map(r => guest(r, false))
    .filter(g => !OK_VER.includes(g.id_status) || !OK_VER.includes(g.card_status))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.guest.localeCompare(b.guest))

  // Rooms with their day.
  const blocks = ((blocksOk ? blocksQ.data : []) || []) as any[]
  const blockOf: Record<string, any> = {}
  for (const b of blocks) {
    if (b.end_date && b.end_date < t0) continue
    for (const rid of (b.room_ids || [])) blockOf[String(rid)] = b
    for (const nm of (b.room_names || [])) blockOf['name:' + nm] = blockOf['name:' + nm] || b
  }
  const T = ((tasksQ.data || []) as any[]) as FdTask[]
  const tasksByRoom: Record<string, FdTask[]> = {}
  for (const t of T) { const k = t.room_id || (t.room_name ? 'name:' + t.room_name : ''); if (k) (tasksByRoom[k] = tasksByRoom[k] || []).push(t) }
  const roomStay: Record<string, { guest: string; out: string }> = {}, roomArr: Record<string, string> = {}, roomDep = new Set<string>()
  for (const r of R) for (const rid of (r.room_ids || [])) {
    if (r.check_in <= t0 && r.check_out > t0 && r.status !== 'checked_out') roomStay[rid] = { guest: r.guest_name || 'Guest', out: r.check_out }
    if (r.check_in === t0 && r.status !== 'checked_out') roomArr[rid] = r.guest_name || 'Guest'
    if (r.check_out === t0) roomDep.add(rid)
  }
  const rooms: FdRoom[] = ((roomsQ.data || []) as any[]).map(r => {
    const b = blockOf[r.id] || blockOf['name:' + r.name]
    const oos = b ? { kind: b.kind || 'blocked', reason: b.reason || null, until: b.end_date || null }
      : (r.status && r.status !== 'active') || r.blocked ? { kind: r.status && r.status !== 'active' ? r.status : 'blocked', reason: null, until: null } : null
    return {
      id: String(r.id), name: r.name, type: r.room_type || null, floor: r.floor || null, status: r.status || 'active',
      condition: r.hk_status || null, occupied: r.occupied ?? null, conditionAt: r.hk_updated_at || null,
      housekeeper: r.housekeeper || null, comments: r.hk_comments || null, dnd: !!r.dnd, refused: !!r.refused_service, frontdesk: r.frontdesk_status || null,
      oos, stay: roomStay[r.id] || null, arriving: roomArr[r.id] || null, departing: roomDep.has(r.id),
      tasks: [...(tasksByRoom[r.id] || []), ...(tasksByRoom['name:' + r.name] || [])].map(t => ({ id: t.id, kind: t.kind, status: t.status, assigned_to: t.assigned_to })),
    }
  })

  const live = T.filter(t => t.status !== 'cancelled')
  // dirtyVacant = rooms to turn. Cloudbeds marks every occupied room dirty by itself (check-in, 2 AM),
  // so the plain dirty count is mostly guests in their rooms, not work.
  const hk = { clean: 0, dirty: 0, inspected: 0, unknown: 0, oos: 0, dirtyVacant: 0, dirtyOccupied: 0 }
  for (const r of rooms) { if (r.oos) hk.oos++; const c = r.condition as keyof typeof hk; if (c === 'clean' || c === 'dirty' || c === 'inspected') hk[c]++; else hk.unknown++; if (c === 'dirty' && !r.oos) { if (r.stay && !r.departing) hk.dirtyOccupied++; else hk.dirtyVacant++ } }

  // Completions per housekeeper — from the room assignment (Cloudbeds) and the task assignee (ours).
  const perHk: Record<string, { name: string; rooms: number; clean: number; dirty: number; tasks: number; done: number }> = {}
  const hkRow = (n: string) => (perHk[n] = perHk[n] || { name: n, rooms: 0, clean: 0, dirty: 0, tasks: 0, done: 0 })
  for (const r of rooms) if (r.housekeeper) { const h = hkRow(r.housekeeper); h.rooms++; if (r.condition === 'dirty') h.dirty++; else if (r.condition === 'clean' || r.condition === 'inspected') h.clean++ }
  for (const t of live) if (t.assigned_to) { const h = hkRow(t.assigned_to); h.tasks++; if (t.status === 'done') h.done++ }
  const housekeepers = Object.values(perHk).sort((a, b) => a.name.localeCompare(b.name))

  // Occupancy tonight: distinct rooms held by a stay that covers tonight.
  const occRooms = new Set<string>()
  for (const r of R) if (r.check_in <= t0 && r.check_out > t0 && r.status !== 'checked_out') for (const rid of (r.room_ids || [])) occRooms.add(rid)

  // Team: shifts + timecards, one row per person.
  const S = ((shiftsOk ? shiftsQ.data : []) || []) as any[], C = ((cardsOk ? cardsQ.data : []) || []) as any[]
  const staffIds = Array.from(new Set([...S.map(s => s.staff_id), ...C.map(c => c.staff_id)].filter(Boolean))) as string[]
  const staff = staffIds.length ? await inChunks<any>(staffIds, c => db.from('garden_staff').select('id,name,role,department,phone').in('id', c)) : []
  const staffBy: Record<string, any> = {}; for (const s of staff) staffBy[s.id] = s
  const now = nowHHMM()
  const people: Record<string, FdPerson> = {}
  const onNow = new Set<string>()
  const dept = (s: any, role: string | null) => String(s?.department || s?.role || role || 'other').replace('frontdesk', 'front_desk')
  for (const s of S) {
    const st = staffBy[s.staff_id], key = s.staff_id || `shift:${s.id}`
    people[key] = { key, name: st?.name || 'Unknown', department: dept(st, s.role), phone: st?.phone || null, shift: { start: s.start_time, end: s.end_time, role: s.role, rooms: s.rooms || [] }, clockIn: null, clockOut: null, hours: null, state: 'due' }
  }
  for (const c of C) {
    const st = c.staff_id ? staffBy[c.staff_id] : null
    const key = c.staff_id || Object.keys(people).find(k => people[k].name.toLowerCase() === String(c.name || '').toLowerCase()) || `card:${c.id}`
    const p = people[key] = people[key] || { key, name: st?.name || c.name || 'Unknown', department: dept(st, c.role), phone: st?.phone || null, shift: null, clockIn: null, clockOut: null, hours: null, state: 'unscheduled' }
    if (c.clock_in && (!p.clockIn || c.clock_in < p.clockIn)) p.clockIn = c.clock_in
    if (c.clock_out && (!p.clockOut || c.clock_out > p.clockOut)) p.clockOut = c.clock_out
    if (c.open || (c.clock_in && !c.clock_out)) onNow.add(key)
    p.hours = (p.hours || 0) + (Number(c.hours) || 0)
  }
  const team = Object.values(people).map(p => {
    const on = onNow.has(p.key)
    const state: FdPerson['state'] = on ? 'on' : p.clockIn ? 'done' : !p.shift ? 'unscheduled' : p.shift.start && p.shift.start < now ? 'late' : 'due'
    return { ...p, clockOut: on ? null : p.clockOut, state, hours: p.hours != null ? Math.round(p.hours * 10) / 10 : null }
  }).sort((a, b) => a.department.localeCompare(b.department) || (a.shift?.start || '99').localeCompare(b.shift?.start || '99') || a.name.localeCompare(b.name))

  const syncs: Record<string, { at: string | null; error: string | null }> = {}
  for (const s of ((syncQ.data || []) as any[])) syncs[s.entity] = { at: s.last_sync_at || null, error: s.last_error || null }

  const unpaidTotal = Math.round(unpaid.reduce((s, g) => s + g.balance, 0) * 100) / 100
  return {
    date: t0, generatedAt: new Date().toISOString(),
    summary: {
      rooms: rooms.length,
      arrivals: { total: arrivals.length, done: arrivals.filter(g => g.done).length },
      departures: { total: departures.length, done: departures.filter(g => g.done).length },
      inHouse: inHouse.length,
      occupancy: rooms.length ? Math.round((occRooms.size / rooms.length) * 100) : null, occupiedRooms: occRooms.size,
      unpaid: { total: unpaidTotal, count: unpaid.length },
      verificationsDue: verifications.length,
      verificationsDueToday: verifications.filter(g => g.checkIn === t0).length,
      hk,
      tasks: { total: live.length, done: live.filter(t => t.status === 'done').length, inProgress: live.filter(t => t.status === 'in_progress').length },
      team: { scheduled: team.filter(p => p.shift).length, on: team.filter(p => p.state === 'on').length, late: team.filter(p => p.state === 'late').length },
    },
    arrivals, departures, inHouse, unpaid, verifications,
    rooms, tasks: T, housekeepers, team,
    available: { roomDetail: detail, roomBlocks: blocksOk, shifts: shiftsOk, timecards: cardsOk, operto: !!ops?.ok, details: Object.keys(det || {}).length > 0 },
    operto: ops ? { ok: ops.ok, error: ops.error, at: ops.at, matched: ops.matched, reservations: ops.reservations, fields: ops.fields } : null,
    syncs,
  }
}

export type GardenFrontDesk = Awaited<ReturnType<typeof gardenFrontDesk>>
