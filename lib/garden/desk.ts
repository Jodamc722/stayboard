// GARDEN HOTEL DESK — the reads behind the five /garden tabs. Every function returns plain JSON
// the page draws with the lean kit; nothing here talks to Cloudbeds directly (that is sync.ts).
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { cloudbedsConfig } from './cloudbeds'
import { todayET } from './sync'

const LIVE = ['confirmed', 'not_confirmed', 'checked_in']
const s = (v: any) => (v == null ? '' : String(v))
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export type GardenStatus = { mode: 'api_key' | 'oauth' | 'none'; propertyId: string | null; feeds: { entity: string; lastSyncAt: string | null; error: string | null; count: number | null; ageMin: number | null }[]; rooms: number; reservations: number }
export async function gardenStatus(): Promise<GardenStatus> {
  const db = supabaseAdmin(), cfg = cloudbedsConfig()
  const [{ data: st }, rooms, res] = await Promise.all([
    db.from('garden_sync_status').select('*'),
    db.from('garden_rooms').select('id', { count: 'exact', head: true }),
    db.from('garden_reservations').select('id', { count: 'exact', head: true }),
  ])
  const byE: Record<string, any> = {}
  for (const r of ((st || []) as any[])) byE[r.entity] = r
  const feeds = ['rooms', 'reservations', 'housekeeping', 'calendar', 'channels', 'payments', 'messages', 'homebase_staff', 'homebase_timecards'].map(entity => {
    const r = byE[entity]
    return { entity, lastSyncAt: r?.last_sync_at || null, error: r?.last_error || null, count: r?.count ?? null, ageMin: r?.last_sync_at ? Math.round((Date.now() - Date.parse(r.last_sync_at)) / 60000) : null }
  })
  return { mode: cfg.mode, propertyId: cfg.propertyId, feeds, rooms: rooms.count || 0, reservations: res.count || 0 }
}

export async function gardenToday() {
  const db = supabaseAdmin()
  const t0 = todayET(0), t2 = addDays(t0, 2)
  const [{ data: res }, { data: rooms }, { data: tasks }, { data: calls }, { data: vers }] = await Promise.all([
    db.from('garden_reservations').select('id,status,guest_name,guest_phone,check_in,check_out,nights,adults,children,room_names,source,balance').in('status', [...LIVE, 'checked_out']).or(`check_in.eq.${t0},check_out.eq.${t0},and(check_in.lt.${t0},check_out.gt.${t0}),and(check_in.gt.${t0},check_in.lte.${t2})`),
    db.from('garden_rooms').select('id,name,room_type,status,hk_status,occupied').order('name'),
    db.from('garden_tasks').select('*').eq('date', t0).order('kind'),
    db.from('garden_calls').select('reservation_id,kind,outcome,called_at').gte('called_at', new Date(Date.now() - 14 * 86400000).toISOString()),
    db.from('garden_verifications').select('reservation_id,kind,status'),
  ])
  const R = (res || []) as any[]
  const arrivals = R.filter(r => r.check_in === t0 && r.status !== 'checked_out')
  const departures = R.filter(r => r.check_out === t0)
  const inHouse = R.filter(r => r.check_in < t0 && r.check_out > t0 && r.status !== 'checked_out')
  const soon = R.filter(r => r.check_in >= t0 && r.check_in <= t2 && LIVE.includes(r.status))
  const reached = new Set(((calls || []) as any[]).filter(c => c.outcome === 'reached' && c.kind === 'pre_arrival').map(c => c.reservation_id))
  const attempted = new Set(((calls || []) as any[]).filter(c => c.kind === 'pre_arrival').map(c => c.reservation_id))
  const verOk: Record<string, string[]> = {}
  for (const v of ((vers || []) as any[])) if (v.status === 'passed' || v.status === 'waived') (verOk[v.reservation_id] = verOk[v.reservation_id] || []).push(v.kind)
  const callsDue = soon.filter(r => !reached.has(r.id)).map(r => ({ ...r, attempted: attempted.has(r.id) }))
  const verifyDue = soon.filter(r => !(verOk[r.id] || []).includes('id') || !(verOk[r.id] || []).includes('card')).map(r => ({ ...r, have: verOk[r.id] || [] }))
  const RM = (rooms || []) as any[]
  const hk = { clean: 0, dirty: 0, inspected: 0, unknown: 0 } as Record<string, number>
  for (const r of RM) hk[r.hk_status && hk[r.hk_status] != null ? r.hk_status : 'unknown']++
  const T = (tasks || []) as any[]
  return {
    date: t0, arrivals, departures, inHouse: inHouse.length, occupancy: RM.length ? Math.round(((inHouse.length + departures.length) / RM.length) * 100) : null,
    rooms: RM.length, hk, tasks: T, tasksOpen: T.filter(t => t.status === 'open' || t.status === 'in_progress').length, tasksDone: T.filter(t => t.status === 'done').length,
    callsDue, verifyDue,
  }
}

export async function gardenRooms() {
  const db = supabaseAdmin()
  const t0 = todayET(0), t1 = addDays(t0, 1)
  const [{ data: rooms }, { data: res }, { data: tasks }] = await Promise.all([
    db.from('garden_rooms').select('*').order('name'),
    db.from('garden_reservations').select('id,status,guest_name,check_in,check_out,room_ids').in('status', LIVE).lte('check_in', addDays(t0, 7)).gte('check_out', t0),
    db.from('garden_tasks').select('*').in('date', [t0, t1]).neq('status', 'cancelled').order('date'),
  ])
  const byRoom: Record<string, any> = {}
  for (const r of ((rooms || []) as any[])) byRoom[r.id] = { ...r, stay: null, next: null, tasks: [] as any[] }
  for (const r of ((res || []) as any[])) for (const rid of (r.room_ids || [])) {
    const room = byRoom[rid]; if (!room) continue
    if (r.check_in <= t0 && r.check_out > t0) room.stay = { id: r.id, guest: r.guest_name, out: r.check_out, status: r.status }
    else if (r.check_in > t0 && (!room.next || r.check_in < room.next.in)) room.next = { id: r.id, guest: r.guest_name, in: r.check_in }
  }
  const orphans: any[] = []
  for (const t of ((tasks || []) as any[])) { const room = t.room_id ? byRoom[t.room_id] : null; if (room) room.tasks.push(t); else orphans.push(t) }
  return { date: t0, rooms: Object.values(byRoom), orphanTasks: orphans }
}

export async function gardenCalls() {
  const db = supabaseAdmin()
  const t0 = todayET(0), t7 = addDays(t0, 7)
  const [{ data: res }, { data: calls }, { data: vers }] = await Promise.all([
    db.from('garden_reservations').select('id,status,guest_name,guest_phone,guest_email,check_in,check_out,nights,room_names,source,total,balance').in('status', LIVE).gte('check_in', addDays(t0, -1)).lte('check_in', t7).order('check_in'),
    db.from('garden_calls').select('*').order('called_at', { ascending: false }).limit(300),
    db.from('garden_verifications').select('*'),
  ])
  const C = (calls || []) as any[], V = (vers || []) as any[]
  const byRes: Record<string, { calls: any[]; verifications: any[] }> = {}
  const bucket = (id: string) => (byRes[id] = byRes[id] || { calls: [], verifications: [] })
  for (const c of C) if (c.reservation_id) bucket(c.reservation_id).calls.push(c)
  for (const v of V) if (v.reservation_id) bucket(v.reservation_id).verifications.push(v)
  const upcoming = ((res || []) as any[]).map(r => {
    const b = byRes[r.id] || { calls: [], verifications: [] }
    const reached = b.calls.some(c => c.kind === 'pre_arrival' && c.outcome === 'reached')
    const ver = (k: string) => b.verifications.find(v => v.kind === k)?.status || 'pending'
    return { ...r, calls: b.calls, verifications: b.verifications, reached, attempts: b.calls.filter(c => c.kind === 'pre_arrival').length, idStatus: ver('id'), cardStatus: ver('card') }
  })
  return { date: t0, upcoming, recent: C.slice(0, 60) }
}

export async function gardenReport(from: string, to: string) {
  const db = supabaseAdmin()
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1)
  const [roomsQ, { data: res }, { data: tasks }, { data: calls }, { data: vers }] = await Promise.all([
    db.from('garden_rooms').select('id', { count: 'exact', head: true }),
    db.from('garden_reservations').select('id,status,check_in,check_out,nights,total,source,room_ids').neq('status', 'canceled').lte('check_in', to).gte('check_out', from),
    db.from('garden_tasks').select('kind,status,date,finished_at').gte('date', from).lte('date', to),
    db.from('garden_calls').select('kind,outcome,called_at').gte('called_at', from + 'T00:00:00Z').lte('called_at', to + 'T23:59:59Z'),
    db.from('garden_verifications').select('kind,status,checked_at').gte('checked_at', from + 'T00:00:00Z').lte('checked_at', to + 'T23:59:59Z'),
  ])
  const roomCount = roomsQ.count || 0
  let roomNights = 0, revenue = 0, arrivals = 0
  const bySource: Record<string, number> = {}
  for (const r of ((res || []) as any[])) {
    const a = Math.max(Date.parse(r.check_in), Date.parse(from)), b = Math.min(Date.parse(r.check_out), Date.parse(to) + 86400000)
    const n = Math.max(0, Math.round((b - a) / 86400000)) * Math.max(1, (r.room_ids || []).length)
    roomNights += n
    if (r.check_in >= from && r.check_in <= to) { arrivals++; revenue += Number(r.total) || 0; bySource[r.source || 'Direct'] = (bySource[r.source || 'Direct'] || 0) + 1 }
  }
  const T = (tasks || []) as any[], C = (calls || []) as any[], V = (vers || []) as any[]
  const kinds: Record<string, { total: number; done: number }> = {}
  for (const t of T) { const k = kinds[t.kind] = kinds[t.kind] || { total: 0, done: 0 }; k.total++; if (t.status === 'done') k.done++ }
  return {
    from, to, days, rooms: roomCount,
    occupancy: roomCount ? Math.round((roomNights / (roomCount * days)) * 100) : null, roomNights, arrivals,
    revenueBooked: Math.round(revenue), adr: roomNights ? Math.round(revenue / roomNights) : null, bySource,
    cleans: kinds, calls: { total: C.length, reached: C.filter(c => c.outcome === 'reached').length, byKind: C.reduce((m: Record<string, number>, c) => (m[c.kind] = (m[c.kind] || 0) + 1, m), {}) },
    verifications: { total: V.length, passed: V.filter(v => v.status === 'passed').length, failed: V.filter(v => v.status === 'failed').length },
  }
}

export const gardenRange = (sp: URLSearchParams) => {
  const t0 = todayET(0)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(s(sp.get('from'))) ? s(sp.get('from')) : addDays(t0, -29)
  const to = /^\d{4}-\d{2}-\d{2}$/.test(s(sp.get('to'))) ? s(sp.get('to')) : t0
  return { from, to }
}
