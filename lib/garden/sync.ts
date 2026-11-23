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

/**
 * FAST AND IN ORDER (Jon, 2026-11-23: "make sure the sync is organized — meaning fast"). A run was ~2
 * minutes, mostly waiting on things one after another. Now:
 *   together   rooms, reservations and room conditions are read from Cloudbeds at the same time
 *   lighter    between full reads (every 3 hours) reservations ask Cloudbeds only for what CHANGED
 *              since the last run, plus everyone in house — not the whole 74-day window again
 *   then       cleans + the housekeeping day (they need the three above)
 *   after      the slower feeds (rates, channels, payments, notes, totals…), three at a time, and
 *              the desks (call queue, triggers, phone, Homebase)
 * `quick: true` (the Sync button on the boards) stops after the housekeeping day — seconds, not minutes.
 */
export async function syncGarden(opts: { full?: boolean; quick?: boolean } = {}): Promise<GardenSyncResult> {
  const out: GardenSyncResult = { ok: true, connected: cloudbedsConfigured(), errors: [] }
  if (!out.connected) {
    await Promise.all(['rooms', 'reservations', 'housekeeping'].map(e => mark(e, { error: 'not connected — set CLOUDBEDS_API_KEY (or the OAuth trio) and CLOUDBEDS_PROPERTY_ID in Vercel' }).catch(() => {})))
    await runGardenDesks(out)
    return out
  }
  const db = supabaseAdmin()

  // 1) Rooms
  const stepRooms = async () => { try {
    const rooms = await getRooms()
    if (rooms.length) {
      const rows = rooms.map(r => ({ id: r.id, name: r.name, room_type_id: r.roomTypeId, room_type: r.roomType, floor: r.floor, max_guests: r.maxGuests, status: r.status, raw: r.raw, synced_at: new Date().toISOString() }))
      const { error } = await db.from('garden_rooms').upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    out.rooms = rooms.length
    await mark('rooms', { count: rooms.length })
  } catch (e: any) { out.ok = false; out.errors.push(`rooms: ${e?.message || e}`); await mark('rooms', { error: String(e?.message || e) }) } }

  // 2) Reservations — what changed since the last run; the whole window every 3 hours
  const stepRes = async () => { try {
    const from = ymd(new Date(Date.now() - 14 * 86400000)), to = ymd(new Date(Date.now() + 60 * 86400000))
    let since: string | undefined
    if (!opts.full) {
      const { data } = await db.from('garden_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()
      if (data?.last_sync_at) since = new Date(new Date(data.last_sync_at).getTime() - 10 * 60000).toISOString().slice(0, 19).replace('T', ' ')
    }
    const { getSettingFresh, setSetting } = await import('../app-settings')
    const lastFull = await getSettingFresh<string | null>('garden_res_full_at', null).catch(() => null)
    const wantFull = !since || !!opts.full || !lastFull || Date.now() - Date.parse(lastFull) > 3 * 3600e3
    const list = wantFull ? [...(since ? await getReservations({ from, to, modifiedSince: since }) : []), ...await getReservations({ from, to })] : await getReservations({ from, to, modifiedSince: since })
    if (wantFull) await setSetting('garden_res_full_at', new Date().toISOString(), 'garden-sync').catch(() => {})
    // EVERYONE IN HOUSE, WHATEVER THE DATES (audit 2026-11-13): the two date windows miss a long stay
    // that arrived more than 14 days ago and leaves more than 60 days out, so its room read vacant
    // and it got no stayover cleans. Cloudbeds can be asked for the in-house list directly.
    try { list.push(...await getReservations({ from, to, status: 'checked_in' })) } catch { /* the windows still stand */ }
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
      // The list call carries no total (2026-11-10: revenue read $0); never write a blank over the one
      // lib/garden/res-detail fills in from getReservationsWithRateDetails.
      ...(r.total != null ? { total: r.total } : {}), balance: r.balance, booked_at: r.bookedAt || null, modified_at: r.modifiedAt || null, raw: r.raw, synced_at: new Date().toISOString(),
    }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('garden_reservations').upsert(rows.slice(i, i + 200), { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    out.reservations = rows.length
    await mark('reservations', { count: rows.length })
  } catch (e: any) { out.ok = false; out.errors.push(`reservations: ${e?.message || e}`); await mark('reservations', { error: String(e?.message || e) }) } }

  // 3) Housekeeping status → garden_rooms
  const stepHk = async () => { try {
    const hk = await getHousekeeping()
    let { data: cur } = await db.from('garden_rooms').select('id,hk_status,name,occupied,housekeeper,hk_comments,dnd,refused_service,frontdesk_status,blocked') as any
    if (!cur) cur = (await db.from('garden_rooms').select('id,hk_status,name')).data as any
    const curBy: Record<string, any> = {}; for (const c of ((cur || []) as any[])) curBy[c.id] = c
    let detail = true   // migration 170's columns; until it is run, only the base fields are written
    // CLOUDBEDS TURNS EVERY OCCUPIED ROOM DIRTY BY ITSELF — at check-in and again around 2 AM (its
    // housekeeping guide). That is a reminder, not a room to turn, so "a room turns dirty" fires only
    // for a vacant room; and a room whose row did not change is not written again (310 writes a run).
    const same = (c: any, h: any) => c && 'housekeeper' in c && c.hk_status === h.condition && (c.occupied ?? null) === (h.occupied ?? null) && (c.housekeeper ?? null) === (h.housekeeper ?? null) && (c.hk_comments ?? null) === (h.comments ?? null) && !!c.dnd === !!h.dnd && !!c.refused_service === !!h.refused && (c.frontdesk_status ?? null) === (h.frontdeskStatus ?? null) && !!c.blocked === !!h.blocked
    const turnedDirty = (h: any) => h.condition === 'dirty' && h.occupied !== true && curBy[h.roomId] && curBy[h.roomId].hk_status !== 'dirty'
    const moved: { roomId: string; roomName: string; from: string | null; to: string; housekeeper: string | null }[] = []
    for (const h of hk) {
      if (same(curBy[h.roomId], h)) continue
      if (curBy[h.roomId] && h.condition && curBy[h.roomId].hk_status !== h.condition) moved.push({ roomId: h.roomId, roomName: curBy[h.roomId].name || h.roomName, from: curBy[h.roomId].hk_status || null, to: h.condition, housekeeper: h.housekeeper || curBy[h.roomId].housekeeper || null })
      const base = { hk_status: h.condition, occupied: h.occupied, hk_updated_at: new Date().toISOString() }
      if (detail) {
        const { error } = await db.from('garden_rooms').update({ ...base, housekeeper: h.housekeeper, housekeeper_id: h.housekeeperId, hk_comments: h.comments, dnd: h.dnd, refused_service: h.refused, frontdesk_status: h.frontdeskStatus, blocked: h.blocked }).eq('id', h.roomId)
        if (error && /column|schema cache/i.test(error.message)) detail = false
        else if (!error) { if (turnedDirty(h)) await emitGardenEvent('room_dirty', h.roomId, { room_name: curBy[h.roomId].name }); continue }
      }
      await db.from('garden_rooms').update(base).eq('id', h.roomId)
      if (turnedDirty(h)) await emitGardenEvent('room_dirty', h.roomId, { room_name: curBy[h.roomId].name })
    }
    // Performance: every room that went clean / inspected since the last sync (lib/garden/hk-perf).
    try { const { logHk } = await import('./hk-perf'); await logHk(moved, 'cloudbeds') } catch (e: any) { out.errors.push(`hk log: ${e?.message || e}`) }
    out.housekeeping = hk.length
    await mark('housekeeping', { count: hk.length })
  } catch (e: any) { out.ok = false; out.errors.push(`housekeeping: ${e?.message || e}`); await mark('housekeeping', { error: String(e?.message || e) }) } }
  const t0 = Date.now()
  await Promise.all([stepRooms(), stepRes(), stepHk()])

  // 4) Auto cleans from the mirror
  try { out.cleans = await ensureCleans() } catch (e: any) { out.errors.push(`cleans: ${e?.message || e}`) }
  try { const { snapshotHkDay } = await import('./hk-perf'); await snapshotHkDay() } catch (e: any) { out.errors.push(`hk day: ${e?.message || e}`) }
  ;(out as any).coreMs = Date.now() - t0
  if (opts.quick) return out
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
  const [{ data: res }, { data: existing }, { data: rooms }] = await Promise.all([
    db.from('garden_reservations').select('id,status,check_in,check_out,room_ids,room_names,guest_name')
      .in('status', ['confirmed', 'checked_in', 'not_confirmed', 'checked_out']).or(`check_out.in.(${t0},${t1}),and(check_in.lte.${t0},check_out.gt.${t0})`),
    db.from('garden_tasks').select('id,room_id,date,kind,status,source,note').in('date', [t0, t1]).in('kind', ['clean', 'stayover']),
    db.from('garden_rooms').select('id,occupied'),
  ])
  const occ: Record<string, boolean | null> = {}
  for (const r of ((rooms || []) as any[])) occ[String(r.id)] = r.occupied == null ? null : !!r.occupied
  const known = new Set(Object.keys(occ))
  const E = (existing || []) as any[]
  const have = new Map<string, any>(E.map(t => [`${t.room_id}|${t.date}|${t.kind}`, t]))
  const wanted = new Map<string, any>()
  for (const r of ((res || []) as any[])) {
    const ids: string[] = Array.isArray(r.room_ids) ? r.room_ids : []
    const names: string[] = Array.isArray(r.room_names) ? r.room_names : []
    ids.forEach((rid, i) => {
      const nm = names[i] || rid
      if ((r.check_out === t0 || r.check_out === t1) && r.status !== 'canceled') {
        const k = `${rid}|${r.check_out}|clean`
        if (!wanted.has(k)) wanted.set(k, { room_id: rid, room_name: nm, date: r.check_out, kind: 'clean', reservation_id: r.id, source: 'auto', note: `Departure · ${r.guest_name || ''}`.trim() })
      }
      // A STAYOVER NEEDS SOMEONE IN THE ROOM (audit 2026-11-20, against the live hotel). Checked in is
      // in house — unless Cloudbeds shows that room empty (a second room nobody took). A booking the
      // desk left "confirmed" counts only when Cloudbeds shows the room occupied (the 106-night guest
      // of 2026-11-10 does; a guest who never arrived does not).
      const inHouse = r.status === 'checked_in' ? occ[rid] !== false : ['confirmed', 'not_confirmed'].includes(r.status) && occ[rid] === true
      if (inHouse && r.check_in < t0 && r.check_out > t0) {
        const k = `${rid}|${t0}|stayover`
        if (!wanted.has(k)) wanted.set(k, { room_id: rid, room_name: nm, date: t0, kind: 'stayover', reservation_id: r.id, source: 'auto', note: `In house · ${r.guest_name || ''}`.trim() })
      }
    })
  }
  // THE LIST FOLLOWS THE BOOKINGS (2026-11-20: 4 of 27 checkout cleans were for bookings since
  // cancelled or moved). An automatic clean nobody has started, whose booking no longer calls for it,
  // is withdrawn; if the booking comes back, so does the clean. A clean someone started, finished or
  // added by hand is never touched.
  const GONE = 'Withdrawn — the booking changed'
  const withdraw = E.filter(t => t.source === 'auto' && t.status === 'open' && !wanted.has(`${t.room_id}|${t.date}|${t.kind}`)).map(t => t.id)
  for (let i = 0; i < withdraw.length; i += 100) await db.from('garden_tasks').update({ status: 'cancelled', note: GONE, updated_at: new Date().toISOString() }).in('id', withdraw.slice(i, i + 100))
  const inserts: any[] = []
  for (const [k, w] of Array.from(wanted.entries())) {
    const e = have.get(k)
    if (!e) inserts.push(known.has(w.room_id) ? w : { ...w, room_id: null })   // an unknown room id must not break the insert (FK)
    else if (e.status === 'cancelled' && e.source === 'auto' && e.note === GONE) await db.from('garden_tasks').update({ status: 'open', note: w.note, reservation_id: w.reservation_id, updated_at: new Date().toISOString() }).eq('id', e.id)
  }
  if (inserts.length) { const { error } = await db.from('garden_tasks').insert(inserts); if (error) throw new Error(error.message) }
  // Assignments made ahead of the day reach Cloudbeds on the day (lib/garden/assign).
  try { const { pushDayAssignments } = await import('./assign'); await pushDayAssignments() } catch { /* the plan still shows them */ }
  return inserts.length
}


/**
 * HISTORY ON DEMAND (Jon, 2026-11-20: "select dates and time periods" on Revenue). The mirror holds a
 * rolling window from the day the hotel was connected; a period before that has to be read from
 * Cloudbeds once. This pulls the reservations checking in or out inside [from, to] (keep it to about
 * ten days a call) with their totals, and writes them to the mirror — quietly: no events, no triggers,
 * no cleans, because nothing about a past stay is news.
 */
export async function backfillReservations(from: string, to: string): Promise<{ reservations: number; totals: number }> {
  if (!cloudbedsConfigured()) throw new Error('Cloudbeds is not connected.')
  const db = supabaseAdmin()
  const list = await getReservations({ from, to })
  const { cbGet } = await import('./cloudbeds')
  const totals: Record<string, { total: number | null; balance: number | null; room: number | null; taxes: number | null }> = {}
  const num = (v: any) => { const x = Number(v); return v == null || v === '' || !Number.isFinite(x) ? null : x }
  const { roomRevenueOf } = await import('./res-detail')
  const net = await (await import('./segments')).hasRoomRevenue()
  for (let page = 1; page <= 30; page++) {
    const { data } = await cbGet<any[]>('getReservationsWithRateDetails', { reservationCheckOutFrom: from, reservationCheckOutTo: ymd(new Date(Date.parse(to) + 45 * 86400000)), pageNumber: page, pageSize: 100 })
    const rows = Array.isArray(data) ? data : []
    for (const r of rows) if (r?.reservationID) totals[String(r.reservationID)] = { total: num(r.total), balance: num(r.balance), ...roomRevenueOf(r) }
    if (rows.length < 100) break
  }
  const rows = list.map(r => ({
    id: r.id, status: r.status, guest_name: r.guestName, guest_email: r.guestEmail, guest_phone: r.guestPhone, check_in: r.checkIn, check_out: r.checkOut,
    nights: r.checkIn && r.checkOut ? Math.max(0, Math.round((Date.parse(r.checkOut) - Date.parse(r.checkIn)) / 86400000)) : null,
    adults: r.adults, children: r.children, room_ids: r.roomIds, room_names: r.roomNames, source: r.source,
    ...((totals[r.id]?.total ?? r.total) != null ? { total: totals[r.id]?.total ?? r.total } : {}), balance: totals[r.id]?.balance ?? r.balance,
    ...(net && totals[r.id]?.room != null ? { room_revenue: totals[r.id]!.room, taxes_fees: totals[r.id]!.taxes } : {}),
    booked_at: r.bookedAt || null, modified_at: r.modifiedAt || null, raw: r.raw, synced_at: new Date().toISOString(),
  }))
  for (let i = 0; i < rows.length; i += 200) { const { error } = await db.from('garden_reservations').upsert(rows.slice(i, i + 200), { onConflict: 'id' }); if (error) throw new Error(error.message) }
  const { getSettingFresh, setSetting } = await import('../app-settings')
  const cur = await getSettingFresh<string | null>('garden_history_from', null).catch(() => null)
  if (!cur || from < cur) await setSetting('garden_history_from', from, 'backfill')
  return { reservations: rows.length, totals: Object.keys(totals).length }
}
