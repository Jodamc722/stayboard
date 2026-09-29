// GARDEN HOTEL SYNC — Cloudbeds → garden_* mirror tables, and the cleans that fall out of it.
//
// Three entities, each with its own row in garden_sync_status so the Setup tab can say which one
// is stale and why:
//   rooms         the inventory (rarely changes; full replace each run)
//   reservations  a rolling window, 14 days back → 60 days ahead, plus everything modified since
//                 the last run so a cancellation outside the window still lands
//   housekeeping  room condition from the front desk, stamped onto garden_rooms
// Then AUTO CLEANS: every departure today/tomorrow gets an open 'clean' task, every in-house stay
// gets a 'stayover' — created once (room + date + kind), never duplicated, never re-opened.
//
// Not connected = not an error: the run records 'not connected' and returns, so the pages stay up
// and honest while the key is still being set. Riding the breezeway-tasks cron every 30 minutes.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { cloudbedsConfigured, getRooms, getReservations, getHousekeeping } from './cloudbeds'
import { emitGardenEvent } from './triggers'

const ET = 'America/New_York'
export const todayET = (offsetDays = 0): string => {
  const t = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function mark(entity: string, ok: { count?: number } | { error: string }) {
  const db = supabaseAdmin()
  const row: any = { entity, last_sync_at: new Date().toISOString() }
  if ('error' in ok) row.last_error = ok.error.slice(0, 500); else { row.last_error = null; row.count = ok.count ?? null }
  await db.from('garden_sync_status').upsert(row, { onConflict: 'entity' })
}

export type GardenSyncResult = { ok: boolean; connected: boolean; rooms?: number; reservations?: number; housekeeping?: number; cleans?: number; events?: number; queue?: any; triggers?: any; phone?: any; hub?: any; homebase?: any; errors: string[] }

export async function syncGarden(opts: { full?: boolean } = {}): Promise<GardenSyncResult> {
  const out: GardenSyncResult = { ok: true, connected: cloudbedsConfigured(), errors: [] }
  if (!out.connected) {
    await Promise.all(['rooms', 'reservations', 'housekeeping'].map(e => mark(e, { error: 'not connected — set CLOUDBEDS_API_KEY (or the OAuth trio) and CLOUDBEDS_PROPERTY_ID in Vercel' }).catch(() => {})))
    await runGardenDesks(out)
    return out
  }
  const db = supabaseAdmin()

  // 1) Rooms
  try {
    const rooms = await getRooms()
    if (rooms.length) {
      const rows = rooms.map(r => ({ id: r.id, name: r.name, room_type_id: r.roomTypeId, room_type: r.roomType, floor: r.floor, max_guests: r.maxGuests, status: r.status, raw: r.raw, synced_at: new Date().toISOString() }))
      const { error } = await db.from('garden_rooms').upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    out.rooms = rooms.length
    await mark('rooms', { count: rooms.length })
  } catch (e: any) { out.ok = false; out.errors.push(`rooms: ${e?.message || e}`); await mark('rooms', { error: String(e?.message || e) }) }

  // 2) Reservations — window plus modified-since on incremental runs
  try {
    const from = ymd(new Date(Date.now() - 14 * 86400000)), to = ymd(new Date(Date.now() + 60 * 86400000))
    let since: string | undefined
    if (!opts.full) {
      const { data } = await db.from('garden_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()
      if (data?.last_sync_at) since = new Date(new Date(data.last_sync_at).getTime() - 10 * 60000).toISOString().slice(0, 19).replace('T', ' ')
    }
    const list = since ? [...await getReservations({ from, to, modifiedSince: since }), ...await getReservations({ from, to })] : await getReservations({ from, to })
    const byId = new Map(list.map(r => [r.id, r]))
    // What changed, for the triggers (garden_events): new bookings, cancellations, check-in/out.
    const ids = Array.from(byId.keys())
    const before: Record<string, any> = {}
    for (let i = 0; i < ids.length; i += 300) { const { data } = await db.from('garden_reservations').select('id,status,check_in,check_out,room_ids').in('id', ids.slice(i, i + 300)); for (const b of ((data || []) as any[])) before[b.id] = b }
    let events = 0
    for (const r of Array.from(byId.values())) {
      const b = before[r.id]
      const pl = { guest_name: r.guestName, check_in: r.checkIn, check_out: r.checkOut, source: r.source, status: r.status }
      if (!b) { if (r.status !== 'canceled') { await emitGardenEvent('reservation_created', r.id, pl); events++ } continue }
      if (b.status !== r.status) {
        if (r.status === 'canceled' || r.status === 'no_show') await emitGardenEvent('reservation_cancelled', r.id, pl)
        else if (r.status === 'checked_in') await emitGardenEvent('checked_in', r.id, pl)
        else if (r.status === 'checked_out') await emitGardenEvent('checked_out', r.id, pl)
        else await emitGardenEvent('reservation_changed', r.id, pl)
        events++
      } else if (b.check_in !== r.checkIn || b.check_out !== r.checkOut || JSON.stringify(b.room_ids || []) !== JSON.stringify(r.roomIds)) { await emitGardenEvent('reservation_changed', r.id, pl); events++ }
    }
    out.events = events
    const rows = Array.from(byId.values()).map(r => ({
      id: r.id, status: r.status, guest_name: r.guestName, guest_email: r.guestEmail, guest_phone: r.guestPhone,
      check_in: r.checkIn, check_out: r.checkOut,
      nights: r.checkIn && r.checkOut ? Math.max(0, Math.round((Date.parse(r.checkOut) - Date.parse(r.checkIn)) / 86400000)) : null,
      adults: r.adults, children: r.children, room_ids: r.roomIds, room_names: r.roomNames, source: r.source,
      total: r.total, balance: r.balance, booked_at: r.bookedAt || null, modified_at: r.modifiedAt || null, raw: r.raw, synced_at: new Date().toISOString(),
    }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('garden_reservations').upsert(rows.slice(i, i + 200), { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    out.reservations = rows.length
    await mark('reservations', { count: rows.length })
  } catch (e: any) { out.ok = false; out.errors.push(`reservations: ${e?.message || e}`); await mark('reservations', { error: String(e?.message || e) }) }

  // 3) Housekeeping status → garden_rooms
  try {
    const hk = await getHousekeeping()
    const { data: cur } = await db.from('garden_rooms').select('id,hk_status,name')
    const curBy: Record<string, any> = {}; for (const c of ((cur || []) as any[])) curBy[c.id] = c
    for (const h of hk) {
      await db.from('garden_rooms').update({ hk_status: h.condition, occupied: h.occupied, hk_updated_at: new Date().toISOString() }).eq('id', h.roomId)
      if (h.condition === 'dirty' && curBy[h.roomId] && curBy[h.roomId].hk_status !== 'dirty') await emitGardenEvent('room_dirty', h.roomId, { room_name: curBy[h.roomId].name })
    }
    out.housekeeping = hk.length
    await mark('housekeeping', { count: hk.length })
  } catch (e: any) { out.ok = false; out.errors.push(`housekeeping: ${e?.message || e}`); await mark('housekeeping', { error: String(e?.message || e) }) }

  // 4) Auto cleans from the mirror
  try { out.cleans = await ensureCleans() } catch (e: any) { out.errors.push(`cleans: ${e?.message || e}`) }
  // 5) The Cloudbeds hub: multi-calendar, channels, payments, messaging (lib/garden/hub).
  try { const { syncHub } = await import('./hub'); out.hub = await syncHub() } catch (e: any) { out.errors.push(`hub: ${e?.message || e}`) }
  // 6) The desks that ride the sync: the day's events, the call queue, the triggers, the phone.
  await runGardenDesks(out)
  return out
}

/**
 * Everything that follows a fresh mirror — and runs even when Cloudbeds is not connected, so a
 * manually entered reservation or an imported review still moves the desks.
 */
export async function runGardenDesks(out: GardenSyncResult): Promise<void> {
  try { await emitDayEvents() } catch (e: any) { out.errors.push(`day events: ${e?.message || e}`) }
  try { const { buildCallQueue } = await import('./call-desk'); out.queue = await buildCallQueue() } catch (e: any) { out.errors.push(`call queue: ${e?.message || e}`) }
  try { const { runTriggers } = await import('./triggers'); out.triggers = await runTriggers({ by: 'sync' }) } catch (e: any) { out.errors.push(`triggers: ${e?.message || e}`) }
  try { const { syncPhone } = await import('./phone'); out.phone = await syncPhone() } catch (e: any) { out.errors.push(`phone: ${e?.message || e}`) }
  // Homebase: the hotel's contract labor — people and punches (lib/garden/homebase). Quiet until set up.
  try { const { syncGardenHomebase } = await import('./homebase'); out.homebase = await syncGardenHomebase() } catch (e: any) { out.errors.push(`homebase: ${e?.message || e}`) }
}

/** arrival_tomorrow / departure_today, once per reservation per day (stamped in evidence-free form on app_settings). */
async function emitDayEvents(): Promise<void> {
  const db = supabaseAdmin()
  const { getSetting, setSetting } = await import('../app-settings')
  const t0 = todayET(0), t1 = todayET(1)
  const st = await getSetting<any>('garden_day_events', null).catch(() => null)
  if (st?.day === t0) return
  const { data: arr } = await db.from('garden_reservations').select('id,guest_name,room_names,check_in,check_out,source').eq('check_in', t1).in('status', ['confirmed', 'not_confirmed'])
  const { data: dep } = await db.from('garden_reservations').select('id,guest_name,room_names,check_in,check_out,source').eq('check_out', t0).in('status', ['confirmed', 'checked_in'])
  for (const r of ((arr || []) as any[])) await emitGardenEvent('arrival_tomorrow', r.id, r)
  for (const r of ((dep || []) as any[])) await emitGardenEvent('departure_today', r.id, r)
  await setSetting('garden_day_events', { day: t0, arrivals: (arr || []).length, departures: (dep || []).length }, 'garden-sync')
}

/**
 * Departure cleans for today and tomorrow, stayovers for in-house guests today. Idempotent on
 * (room, date, kind): a task that exists — open, done or cancelled — is left alone.
 */
export async function ensureCleans(): Promise<number> {
  const db = supabaseAdmin()
  const t0 = todayET(0), t1 = todayET(1)
  const { data: res } = await db.from('garden_reservations').select('id,status,check_in,check_out,room_ids,room_names,guest_name')
    .in('status', ['confirmed', 'checked_in', 'not_confirmed', 'checked_out']).or(`check_out.in.(${t0},${t1}),and(check_in.lte.${t0},check_out.gt.${t0})`)
  const { data: existing } = await db.from('garden_tasks').select('room_id,date,kind').in('date', [t0, t1])
  const have = new Set(((existing || []) as any[]).map(t => `${t.room_id}|${t.date}|${t.kind}`))
  const inserts: any[] = []
  for (const r of ((res || []) as any[])) {
    const ids: string[] = Array.isArray(r.room_ids) ? r.room_ids : []
    const names: string[] = Array.isArray(r.room_names) ? r.room_names : []
    ids.forEach((rid, i) => {
      const nm = names[i] || rid
      if ((r.check_out === t0 || r.check_out === t1) && r.status !== 'canceled') {
        const k = `${rid}|${r.check_out}|clean`
        if (!have.has(k)) { have.add(k); inserts.push({ room_id: rid, room_name: nm, date: r.check_out, kind: 'clean', reservation_id: r.id, source: 'auto', note: `Departure · ${r.guest_name || ''}`.trim() }) }
      }
      if (r.status === 'checked_in' && r.check_in < t0 && r.check_out > t0) {
        const k = `${rid}|${t0}|stayover`
        if (!have.has(k)) { have.add(k); inserts.push({ room_id: rid, room_name: nm, date: t0, kind: 'stayover', reservation_id: r.id, source: 'auto', note: `In house · ${r.guest_name || ''}`.trim() }) }
      }
    })
  }
  if (inserts.length) {
    // A room id Cloudbeds has not told us about yet must not break the insert (FK on garden_rooms).
    const { data: rooms } = await db.from('garden_rooms').select('id')
    const known = new Set(((rooms || []) as any[]).map(r => String(r.id)))
    const safe = inserts.map(i => known.has(i.room_id) ? i : { ...i, room_id: null })
    const { error } = await db.from('garden_tasks').insert(safe)
    if (error) throw new Error(error.message)
  }
  return inserts.length
}
