// HOUSEKEEPING PERFORMANCE (migration 180) — Jon, 2026-11-20: "see performance, track KPI and make
// sure clear visibility on how we are scheduling".
//
// Cloudbeds holds a room's condition now, not when it changed or who changed it. So:
//   logHk          the first time a room goes dirty → clean (cleaned) or → inspected on a day, one line
//                  is kept: the kind of clean (from the housekeeping plan), who had the room, the time.
//                  Seen at the sync, so a time is right to within one sync (~30 min); a room marked
//                  from Lighthouse is logged at the click. Cloudbeds' own automatic "dirty" (check-in,
//                  2 AM) is never logged.
//   snapshotHkDay  each sync overwrites today's row with the day so far; the last one is how it ended.
//   hkPerformance  the KPIs over a range: rooms and credited hours per housekeeper, rooms per person
//                  per day, arrival rooms ready by check-in time, stayovers serviced, and for each day
//                  housekeepers needed vs scheduled vs who actually cleaned.
// History starts the day this shipped; nothing is back-filled, because nothing was recorded.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { todayET } from './sync'
import { HK_MINUTES, SHIFT_MINUTES } from './hk-plan'

const s = (v: any) => (v == null ? '' : String(v))
const missing = (e: any) => /does not exist|schema cache|relation/i.test(s(e?.message))

export type HkChange = { roomId: string; roomName: string; from: string | null; to: string; housekeeper: string | null }

/** Record completions for today. `changes` are condition moves; kinds come from the plan. */
export async function logHk(changes: HkChange[], source: 'cloudbeds' | 'lighthouse', by: string | null = null): Promise<number> {
  const done = changes.filter(c => (c.to === 'clean' || c.to === 'inspected') && c.from !== c.to)
  if (!done.length) return 0
  const db = supabaseAdmin()
  const date = todayET(0)
  const { hkPlan } = await import('./hk-plan')
  const plan = await hkPlan(date).catch(() => null)
  const row: Record<string, any> = {}
  for (const r of (plan?.rows || [])) row[r.roomId] = r
  const now = new Date().toISOString()
  const lines: any[] = []
  for (const c of done) {
    const p = row[c.roomId]
    const kind = p?.type || 'dirty'
    const who = c.housekeeper || p?.assignedTo || null
    const mins = (HK_MINUTES as any)[kind] || 30
    if (c.from !== 'clean') lines.push({ date, room_id: c.roomId, room_name: c.roomName, kind, event: 'cleaned', housekeeper: who, at: now, minutes: mins, source, by_email: by })
    if (c.to === 'inspected') lines.push({ date, room_id: c.roomId, room_name: c.roomName, kind, event: 'inspected', housekeeper: who, at: now, minutes: HK_MINUTES.inspect, source, by_email: by })
  }
  const { error } = await db.from('garden_hk_log').upsert(lines, { onConflict: 'date,room_id,event', ignoreDuplicates: true })
  if (error && !missing(error)) throw new Error(error.message)
  return error ? 0 : lines.length
}

/** Today so far → garden_hk_daily (the last write of the day is the day's result). */
export async function snapshotHkDay(): Promise<void> {
  const { hkPlan } = await import('./hk-plan')
  const p = await hkPlan()
  const worked = p.people.filter(x => x.rooms > 0)
  const data = {
    turn: p.summary.turn, checkout: p.summary.checkout, stayover: p.summary.stayover, arrival: p.summary.arrival, dirty: p.summary.dirty,
    arrivals: p.summary.arrivals, arrivalsReady: p.summary.arrivalsReady, minutesLeft: p.summary.minutes, unassigned: p.summary.unassigned,
    plannedMinutes: (p.summary.turn.total + p.summary.checkout.total) * HK_MINUTES.checkout + p.summary.stayover.total * HK_MINUTES.stayover,
    scheduled: p.people.filter(x => x.onShift).length, assignedPeople: worked.length, mismatches: p.mismatches.length,
  }
  const { error } = await supabaseAdmin().from('garden_hk_daily').upsert({ date: p.date, data, updated_at: new Date().toISOString() }, { onConflict: 'date' })
  if (error && !missing(error)) throw new Error(error.message)
}

const etHM = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

export async function hkPerformance(days = 14) {
  const db = supabaseAdmin()
  const t0 = todayET(0), from = todayET(-(Math.min(90, Math.max(1, days)) - 1))
  const [logQ, dayQ, shiftQ, staffQ, { getHotel }] = await Promise.all([
    db.from('garden_hk_log').select('date,room_id,room_name,kind,event,housekeeper,at,minutes,source').gte('date', from).lte('date', t0).order('at').limit(20000),
    db.from('garden_hk_daily').select('date,data').gte('date', from).lte('date', t0).order('date'),
    db.from('garden_shifts').select('date,staff_id,role').gte('date', from).lte('date', t0).eq('role', 'housekeeping').then(r => r, () => ({ data: [] as any[] })),
    db.from('garden_staff').select('id,name').then(r => r, () => ({ data: [] as any[] })),
    import('./settings'),
  ])
  if (logQ.error && missing(logQ.error)) return { ready: false as const, from, to: t0 }
  if (logQ.error) throw new Error(logQ.error.message)
  const hotel = await getHotel().catch(() => null)
  const checkIn = hotel?.checkInTime || '15:00'
  const L = (logQ.data || []) as any[]
  const D = ((dayQ.data || []) as any[])
  const cleaned = L.filter(l => l.event === 'cleaned')
  const nameOf: Record<string, string> = {}; for (const p of ((staffQ.data || []) as any[])) nameOf[s(p.id)] = s(p.name)
  const schedBy: Record<string, Set<string>> = {}
  for (const x of ((shiftQ.data || []) as any[])) (schedBy[x.date] = schedBy[x.date] || new Set()).add(nameOf[s(x.staff_id)] || s(x.staff_id))

  // Per housekeeper.
  type P = { name: string; days: Set<string>; turns: number; checkouts: number; stayovers: number; other: number; minutes: number; first: Record<string, string>; last: Record<string, string> }
  const by: Record<string, P> = {}
  for (const l of cleaned) {
    const k = l.housekeeper || 'Not assigned to anyone'
    const p = by[k] = by[k] || { name: k, days: new Set(), turns: 0, checkouts: 0, stayovers: 0, other: 0, minutes: 0, first: {}, last: {} }
    p.days.add(l.date); p.minutes += Number(l.minutes) || 0
    if (l.kind === 'turn') p.turns++; else if (l.kind === 'checkout') p.checkouts++; else if (l.kind === 'stayover') p.stayovers++; else p.other++
    if (!p.first[l.date] || l.at < p.first[l.date]) p.first[l.date] = l.at
    if (!p.last[l.date] || l.at > p.last[l.date]) p.last[l.date] = l.at
  }
  const people = Object.values(by).map(p => {
    const rooms = p.turns + p.checkouts + p.stayovers + p.other, nd = p.days.size || 1
    return { name: p.name, days: p.days.size, rooms, turns: p.turns, checkouts: p.checkouts, stayovers: p.stayovers, other: p.other, hours: Math.round((p.minutes / 60) * 10) / 10, roomsPerDay: Math.round((rooms / nd) * 10) / 10, load: Math.round((p.minutes / nd / SHIFT_MINUTES) * 100) }
  }).sort((a, b) => b.rooms - a.rooms)

  // Per day.
  const dates = Array.from(new Set([...D.map(d => d.date), ...L.map(l => l.date)])).sort().reverse()
  const dayRows = dates.map(date => {
    const d = D.find(x => x.date === date)?.data || null
    const C = cleaned.filter(l => l.date === date)
    const arr = L.filter(l => l.date === date && (l.kind === 'turn' || l.kind === 'arrival'))
    const readyAt: Record<string, string> = {}
    for (const l of arr) if (!readyAt[l.room_id] || l.at > readyAt[l.room_id]) readyAt[l.room_id] = l.at
    const onTime = Object.values(readyAt).filter(at => etHM(at) <= checkIn).length
    const workers = new Set(C.map(l => l.housekeeper).filter(Boolean))
    const planned = d ? d.plannedMinutes : null
    const need = planned != null ? (planned ? Math.max(1, Math.ceil(planned / SHIFT_MINUTES)) : 0) : null
    const lastTurn = L.filter(l => l.date === date && l.kind === 'turn').map(l => l.at).sort().pop() || null
    return {
      date, turns: d?.turn || null, checkouts: d?.checkout || null, stayovers: d?.stayover || null,
      cleaned: C.length, minutes: C.reduce((a, l) => a + (Number(l.minutes) || 0), 0),
      need, scheduled: (schedBy[date] || new Set()).size, worked: workers.size, unassigned: d?.unassigned ?? null,
      arrivals: d?.arrivals ?? null, arrivalsReady: d?.arrivalsReady ?? null, turnsReadyLogged: Object.keys(readyAt).length, turnsOnTime: onTime,
      lastTurnReady: lastTurn ? etHM(lastTurn) : null, mismatches: d?.mismatches ?? null, inProgress: date === t0,
    }
  })
  const closedDays = dayRows.filter(d => !d.inProgress)
  const sum = (f: (d: any) => number) => closedDays.reduce((a, d) => a + (f(d) || 0), 0)
  const soTot = sum(d => d.stayovers?.total), soDone = sum(d => (d.stayovers?.done || 0)), soSkip = sum(d => d.stayovers?.skip || 0)
  const coTot = sum(d => (d.checkouts?.total || 0) + (d.turns?.total || 0)), coDone = sum(d => (d.checkouts?.done || 0) + (d.turns?.done || 0))
  const rl = dayRows.reduce((a, d) => a + d.turnsReadyLogged, 0), ot = dayRows.reduce((a, d) => a + d.turnsOnTime, 0)
  const personDays = people.reduce((a, p) => a + p.days, 0)
  return {
    ready: true as const, from, to: t0, checkIn, since: dates.length ? dates[dates.length - 1] : null, daysTracked: dates.length,
    kpi: {
      roomsCleaned: cleaned.length, hours: Math.round(cleaned.reduce((a, l) => a + (Number(l.minutes) || 0), 0) / 6) / 10,
      roomsPerPersonDay: personDays ? Math.round((cleaned.filter(l => l.housekeeper).length / personDays) * 10) / 10 : null,
      arrivalOnTimePct: rl ? Math.round((ot / rl) * 100) : null, arrivalRoomsLogged: rl,
      stayoverPct: soTot - soSkip > 0 ? Math.round((soDone / (soTot - soSkip)) * 100) : null, stayoverSkipped: soSkip,
      checkoutPct: coTot ? Math.round((coDone / coTot) * 100) : null,
      daysShort: closedDays.filter(d => d.need != null && d.scheduled < d.need).length, daysOver: closedDays.filter(d => d.need != null && d.scheduled > d.need + 1).length, daysNoSchedule: closedDays.filter(d => d.scheduled === 0 && (d.need || 0) > 0).length,
      unattributed: cleaned.filter(l => !l.housekeeper).length,
    },
    people, days: dayRows,
  }
}
