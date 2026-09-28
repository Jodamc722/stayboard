// GARDEN HOTEL REPORT DATASETS — the numbers an owner report is built from, each a named dataset
// with a description, so a template can pick them and a person can see them before generating.
//
// Jon, 2026-09-28: "we'll create the datasets." Every dataset reads garden_* only, for one period
// (from → to inclusive), and returns plain rows. Money is BOOKED revenue as Cloudbeds totals it
// (the statement basis lives in the hotel's books); it is labelled so in every template.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { reviewStats } from './reviews'

export type Dataset<T = any> = { key: string; label: string; what: string; rows: T[]; summary?: Record<string, any> }
const LIVE = ['confirmed', 'not_confirmed', 'checked_in', 'checked_out']
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s + 'T12:00:00Z') + n * 86400000))
export const monthLabel = (iso: string) => new Date(iso.slice(0, 7) + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const monthShort = (iso: string) => new Date(iso.slice(0, 7) + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
const daysBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1)

type Res = { id: string; status: string; check_in: string; check_out: string; nights: number | null; total: number | null; source: string | null; room_ids: string[]; room_names: string[]; guest_name: string | null }

/** Room-nights and revenue a set of reservations puts inside [from, to]. */
function stayMetrics(res: Res[], from: string, to: string, rooms: number) {
  let roomNights = 0, revenue = 0, arrivals = 0, stays = 0
  const a0 = Date.parse(from), b0 = Date.parse(to) + 86400000
  for (const r of res) {
    if (!r.check_in || !r.check_out || r.status === 'canceled' || r.status === 'no_show') continue
    const a = Math.max(Date.parse(r.check_in), a0), b = Math.min(Date.parse(r.check_out), b0)
    const n = Math.max(0, Math.round((b - a) / 86400000))
    if (n <= 0) continue
    const roomsOn = Math.max(1, (r.room_ids || []).length)
    roomNights += n * roomsOn; stays++
    const total = Number(r.total) || 0
    const wholeNights = Math.max(1, Math.round((Date.parse(r.check_out) - Date.parse(r.check_in)) / 86400000))
    revenue += total * (n / wholeNights)   // revenue prorated by the nights inside the window
    if (r.check_in >= from && r.check_in <= to) arrivals++
  }
  const days = daysBetween(from, to)
  const available = rooms * days
  return { roomNights, revenue: Math.round(revenue), arrivals, stays, available, occPct: available ? Math.round((roomNights / available) * 1000) / 10 : 0, adr: roomNights ? Math.round(revenue / roomNights) : 0, revpar: available ? Math.round(revenue / available) : 0 }
}

async function pull(from: string, to: string): Promise<{ res: Res[]; rooms: any[] }> {
  const db = supabaseAdmin()
  const [{ data: res }, { data: rooms }] = await Promise.all([
    db.from('garden_reservations').select('id,status,check_in,check_out,nights,total,source,room_ids,room_names,guest_name').in('status', LIVE).lte('check_in', to).gte('check_out', from).limit(5000),
    db.from('garden_rooms').select('id,name,room_type,status'),
  ])
  return { res: (res || []) as Res[], rooms: (rooms || []) as any[] }
}

export async function datasetsFor(from: string, to: string): Promise<Record<string, Dataset>> {
  const db = supabaseAdmin()
  const { res, rooms } = await pull(from, to)
  const roomCount = rooms.filter(r => r.status === 'active').length || rooms.length
  const out: Record<string, Dataset> = {}

  // 1) The period as one line.
  const period = stayMetrics(res, from, to, roomCount)
  out.period = { key: 'period', label: 'The period', what: 'Occupancy, ADR, RevPAR, room-nights, booked revenue and arrivals for the whole period.', rows: [period], summary: { ...period, rooms: roomCount, days: daysBetween(from, to) } }

  // 2) By calendar month inside the period (and the same months last year, for a delta).
  const months: any[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = ymd(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1))).slice(0, 7)) {
    const mf = m + '-01', mt = ymd(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)))
    const f = mf < from ? from : mf, t = mt > to ? to : mt
    const cur = stayMetrics(res, f, t, roomCount)
    const ly = { from: addDays(f, -365), to: addDays(t, -365) }
    const { res: lyRes } = await pull(ly.from, ly.to)
    const last = stayMetrics(lyRes, ly.from, ly.to, roomCount)
    months.push({ monthIso: mf, label: monthLabel(mf), short: monthShort(mf), ...cur, lastYear: last, occDelta: Math.round((cur.occPct - last.occPct) * 10) / 10, revDelta: cur.revenue - last.revenue })
  }
  out.byMonth = { key: 'byMonth', label: 'By month', what: 'Each calendar month in the period, with the same month last year for the delta.', rows: months }

  // 3) By room type — the hotel's version of "by listing".
  const typeOf: Record<string, string> = {}
  for (const r of rooms) typeOf[r.id] = r.room_type || 'Rooms'
  const byType: Record<string, { type: string; rooms: Set<string>; res: Res[] }> = {}
  for (const r of rooms) { const t = r.room_type || 'Rooms'; (byType[t] = byType[t] || { type: t, rooms: new Set(), res: [] }).rooms.add(r.id) }
  for (const r of res) for (const rid of (r.room_ids || [])) { const t = typeOf[rid]; if (t && byType[t]) byType[t].res.push({ ...r, room_ids: [rid] }) }
  out.byRoomType = { key: 'byRoomType', label: 'By room type', what: 'Occupancy, ADR, RevPAR and booked revenue per room type — the hotel\'s "by listing".', rows: Object.values(byType).map(t => ({ type: t.type, rooms: t.rooms.size, ...stayMetrics(t.res, from, to, t.rooms.size) })).sort((a, b) => b.revenue - a.revenue) }

  // 4) By source / channel.
  const bySrc: Record<string, { source: string; arrivals: number; revenue: number; nights: number }> = {}
  for (const r of res) { if (r.check_in < from || r.check_in > to || r.status === 'canceled') continue; const k = r.source || 'Direct'; const s = bySrc[k] = bySrc[k] || { source: k, arrivals: 0, revenue: 0, nights: 0 }; s.arrivals++; s.revenue += Number(r.total) || 0; s.nights += Number(r.nights) || 0 }
  out.bySource = { key: 'bySource', label: 'By booking source', what: 'Arrivals, nights and booked revenue by channel, for bookings arriving in the period.', rows: Object.values(bySrc).map(s => ({ ...s, revenue: Math.round(s.revenue), share: 0 })).sort((a, b) => b.revenue - a.revenue) }
  const totalRev = out.bySource.rows.reduce((a, s) => a + s.revenue, 0)
  for (const s of out.bySource.rows) s.share = totalRev ? Math.round((s.revenue / totalRev) * 100) : 0

  // 5) On the books ahead — the next three months from the period end.
  const ahead: any[] = []
  for (let i = 1; i <= 3; i++) {
    const base = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1 + i, 1))
    const mf = ymd(base), mt = ymd(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)))
    const { res: aRes } = await pull(mf, mt)
    ahead.push({ monthIso: mf, label: monthLabel(mf), short: monthShort(mf), ...stayMetrics(aRes, mf, mt, roomCount) })
  }
  out.ahead = { key: 'ahead', label: 'On the books', what: 'The next three months as they stand today: occupancy, ADR and revenue already booked.', rows: ahead }

  // 6) Operations — cleans, calls, verifications, welcome calls.
  const [{ data: tasks }, { data: calls }, { data: vers }, { data: queue }, { data: missed }] = await Promise.all([
    db.from('garden_tasks').select('kind,status').gte('date', from).lte('date', to),
    db.from('garden_calls').select('kind,outcome').gte('called_at', from + 'T00:00:00Z').lte('called_at', to + 'T23:59:59Z'),
    db.from('garden_verifications').select('kind,status').gte('checked_at', from + 'T00:00:00Z').lte('checked_at', to + 'T23:59:59Z'),
    db.from('garden_call_queue').select('kind,status').gte('created_at', from + 'T00:00:00Z').lte('created_at', to + 'T23:59:59Z'),
    db.from('garden_phone_calls').select('id').eq('direction', 'inbound').eq('result', 'missed').gte('started_at', from + 'T00:00:00Z').lte('started_at', to + 'T23:59:59Z'),
  ])
  const T = (tasks || []) as any[], C = (calls || []) as any[], V = (vers || []) as any[], Q = (queue || []) as any[]
  const kinds: Record<string, { total: number; done: number }> = {}
  for (const t of T) { const k = kinds[t.kind] = kinds[t.kind] || { total: 0, done: 0 }; k.total++; if (t.status === 'done') k.done++ }
  out.operations = { key: 'operations', label: 'Operations', what: 'Cleans and tasks done, welcome calls completed of due, calls reached, verifications, missed inbound calls.', rows: [], summary: { cleans: kinds, calls: { total: C.length, reached: C.filter(c => c.outcome === 'reached').length }, welcome: { due: Q.filter(q => q.kind === 'welcome').length, done: Q.filter(q => q.kind === 'welcome' && q.status === 'done').length, expired: Q.filter(q => q.kind === 'welcome' && q.status === 'expired').length }, verifications: { total: V.length, passed: V.filter(v => v.status === 'passed').length, failed: V.filter(v => v.status === 'failed').length }, missedInbound: (missed || []).length } }

  // 7) Reviews — quotes, themes, the average.
  const { data: revs } = await db.from('garden_reviews').select('source,guest_name,rating,max_rating,title,body,received_at,sentiment,themes,reply_status').gte('received_at', from + 'T00:00:00Z').lte('received_at', to + 'T23:59:59Z').order('received_at', { ascending: false }).limit(200)
  const R = (revs || []) as any[]
  const stats = await reviewStats(Math.max(30, daysBetween(from, to)))
  out.reviews = { key: 'reviews', label: 'Guest reviews', what: 'Every review in the period, with the average, five-star share, themes, and the best and worst words.', rows: R, summary: { count: R.length, avg: R.length ? Math.round((R.reduce((a, r) => a + (Number(r.rating) / (Number(r.max_rating) || 5)) * 5, 0) / R.length) * 100) / 100 : null, negative: R.filter(r => r.sentiment === 'negative').length, themes: stats.themes, unanswered: R.filter(r => r.reply_status === 'none' || r.reply_status === 'drafted').length } }

  // 8) Work done — the month's tasks by week, for the "what we did" section.
  const { data: done } = await db.from('garden_tasks').select('date,kind,room_name,note,status,finished_at').gte('date', from).lte('date', to).neq('status', 'cancelled').order('date')
  out.work = { key: 'work', label: 'Work done', what: 'Every clean, inspection, deep clean and maintenance task in the period, by week.', rows: (done || []) as any[] }

  return out
}
