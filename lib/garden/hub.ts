// CLOUDBEDS HUB (migration 118) — the four things Cloudbeds runs for the hotel, mirrored:
//
//   calendar   centralized multi-calendar: room type × date → available, rate, min stay, closed
//              (Cloudbeds API v1.2 getRatePlans with detailedRates)
//   channels   calendar synchronization: which channels Cloudbeds pushes to (getSources)
//   payments   Cloudbeds Payments: charges, deposits, refunds (getTransactions, v1.2 accounting)
//   messaging  integrated guest messaging — NO public read endpoint confirmed yet; the adapter is
//              here so a webhook or the endpoint, once confirmed, fills garden_threads/messages.
//
// Every puller is best-effort and stamps garden_sync_status under its own entity, so the setup
// page shows exactly which feed is live. Nothing here writes back to Cloudbeds.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { cbGet, cloudbedsConfigured } from './cloudbeds'

const ymd = (d: Date) => d.toISOString().slice(0, 10)
async function mark(entity: string, ok: { count?: number } | { error: string }) {
  const row: any = { entity, last_sync_at: new Date().toISOString() }
  if ('error' in ok) row.last_error = ok.error.slice(0, 500); else { row.last_error = null; row.count = ok.count ?? null }
  await supabaseAdmin().from('garden_sync_status').upsert(row, { onConflict: 'entity' })
}

/** Multi-calendar: the next `days` of availability and rates per room type. */
export async function pullCalendar(days = 120): Promise<number> {
  const start = ymd(new Date()), end = ymd(new Date(Date.now() + days * 86400000))
  const { data } = await cbGet<any[]>('getRatePlans', { startDate: start, endDate: end, detailedRates: true })
  const rows: any[] = []
  for (const rp of (Array.isArray(data) ? data : [])) {
    // Base rate plan only per room type — derived plans are views on it.
    if (rp?.isDerived) continue
    for (const d of (rp?.roomRateDetailed || [])) {
      rows.push({ room_type_id: String(rp.roomTypeID), room_type: rp.roomTypeName || null, date: d.date, available: d.roomsAvailable ?? null, total: rp.totalRooms ?? null, rate: d.rate ?? null, rate_plan: rp.ratePlanNamePublic || rp.ratePlanID || null, min_stay: d.minLos ?? null, closed: !!(d.closedToArrival && d.closedToDeparture), synced_at: new Date().toISOString() })
    }
  }
  const db = supabaseAdmin()
  for (let i = 0; i < rows.length; i += 500) await db.from('garden_calendar').upsert(rows.slice(i, i + 500), { onConflict: 'room_type_id,date' })
  return rows.length
}

/** Calendar sync: the channels (sources) Cloudbeds distributes to. */
export async function pullChannels(): Promise<number> {
  const { data } = await cbGet<any>('getSources', {})
  // Cloudbeds wraps the list as [{ "0": {...}, "1": {...} }] — flatten whatever shape arrives.
  const flat: any[] = (Array.isArray(data) ? data : [data]).flatMap((x: any) => x && typeof x === 'object' && !x.sourceID && !x.sourceName ? Object.values(x) : [x]).filter((x: any) => x && (x.sourceID || x.sourceName))
  const rows = flat.map((s: any) => ({ id: String(s.sourceID || s.sourceName), name: String(s.sourceName || s.sourceID), kind: s.isThirdParty ? 'ota' : 'direct', status: s.status === false ? 'off' : 'on', synced_at: new Date().toISOString() }))
  if (rows.length) await supabaseAdmin().from('garden_channels').upsert(rows, { onConflict: 'id' })
  return rows.length
}

/** Cloudbeds Payments: the last `days` of transactions. */
export async function pullPayments(days = 45): Promise<number> {
  const { data } = await cbGet<any[]>('getTransactions', { resultsFrom: ymd(new Date(Date.now() - days * 86400000)), resultsTo: ymd(new Date()), pageSize: 500 })
  const rows = (Array.isArray(data) ? data : []).filter((t: any) => /payment|refund|deposit|authoriz|void/i.test(String(t.transactionType || t.transactionCategory || ''))).map((t: any) => ({
    id: String(t.transactionID), reservation_id: t.reservationID ? String(t.reservationID) : null, guest_name: t.guestName || null,
    kind: /refund/i.test(t.transactionType) ? 'refund' : /void/i.test(t.transactionType) ? 'void' : /auth/i.test(t.transactionType) ? 'authorization' : /deposit/i.test(t.transactionType || t.description || '') ? 'deposit' : 'charge',
    method: t.paymentMethod || t.description || null, amount: Number(t.amount) || 0, currency: t.currency || 'USD', status: t.status || null,
    paid_at: t.transactionDateTime || t.transactionDate || null, note: t.notes || null, synced_at: new Date().toISOString(),
  }))
  if (rows.length) await supabaseAdmin().from('garden_payments').upsert(rows, { onConflict: 'id' })
  return rows.length
}

/**
 * Guest messaging. Cloudbeds' integrated messaging has no confirmed public read endpoint in API
 * v1.2; until it does, threads arrive through ingestMessage (a webhook or a manual import).
 */
export async function pullMessages(): Promise<number | null> { return null }
export async function ingestMessage(m: { threadId: string; reservationId?: string | null; guest?: string | null; channel?: string | null; source?: string | null; id: string; direction: 'in' | 'out'; author?: string | null; body: string; sentAt?: string | null; quiet?: boolean }): Promise<void> {
  const db = supabaseAdmin()
  const at = m.sentAt || new Date().toISOString()
  const { data: t } = await db.from('garden_threads').select('unread,last_message_at').eq('id', m.threadId).maybeSingle()
  const { data: seen } = await db.from('garden_messages').select('id').eq('id', m.id).maybeSingle()
  if (seen) return
  const newer = !(t as any)?.last_message_at || at >= (t as any).last_message_at
  const row: any = { id: m.threadId, reservation_id: m.reservationId || null, guest_name: m.guest || null, channel: m.channel || null, synced_at: new Date().toISOString() }
  if (newer) Object.assign(row, { last_message_at: at, last_snippet: m.body.slice(0, 200) })
  if (!m.quiet) Object.assign(row, { unread: m.direction === 'in' ? ((t as any)?.unread || 0) + 1 : 0, status: m.direction === 'in' ? 'open' : 'waiting' })
  const { error } = await db.from('garden_threads').upsert({ ...row, source: m.source || null }, { onConflict: 'id' })
  if (error && /source|schema cache/i.test(error.message)) await db.from('garden_threads').upsert(row, { onConflict: 'id' })
  await db.from('garden_messages').upsert({ id: m.id, thread_id: m.threadId, direction: m.direction, author: m.author || null, body: m.body, sent_at: at }, { onConflict: 'id' })
}

/** Out-of-service and blocked rooms (getRoomBlocks) — maintenance as Cloudbeds sees it. */
export async function pullRoomBlocks(): Promise<number> {
  const start = ymd(new Date(Date.now() - 7 * 86400000)), end = ymd(new Date(Date.now() + 90 * 86400000))
  const { data } = await cbGet<any>('getRoomBlocks', { startDate: start, endDate: end })
  const arr: any[] = (Array.isArray(data) ? data : [data]).flatMap((x: any) => Array.isArray(x?.roomBlocks) ? x.roomBlocks : [x]).filter((x: any) => x && (x.roomBlockID || x.id))
  const rows = arr.map((b: any) => {
    const rooms: any[] = Array.isArray(b.rooms) ? b.rooms : []
    return { id: String(b.roomBlockID || b.id), room_ids: rooms.map(r => String(r.roomID)).filter(Boolean), room_names: rooms.map(r => String(r.roomName || r.roomID)).filter(Boolean),
      kind: String(b.roomBlockType || b.type || 'blocked').toLowerCase().replace(/\s+/g, '_'), reason: b.roomBlockReason || b.reason || null,
      start_date: String(b.startDate || '').slice(0, 10) || null, end_date: String(b.endDate || '').slice(0, 10) || null, synced_at: new Date().toISOString() }
  })
  const db = supabaseAdmin()
  await db.from('garden_room_blocks').delete().gte('synced_at', '1970-01-01')
  if (rows.length) { const { error } = await db.from('garden_room_blocks').insert(rows); if (error) throw new Error(error.message) }
  return rows.length
}

/** Front-desk notes on reservations arriving, in house or leaving this week → the inbox (source 'note'). */
export async function pullReservationNotes(): Promise<number> {
  const db = supabaseAdmin()
  const t0 = ymd(new Date(Date.now() - 86400000)), t7 = ymd(new Date(Date.now() + 7 * 86400000))
  const { data: res } = await db.from('garden_reservations').select('id,guest_name,source,check_in,check_out').lte('check_in', t7).gte('check_out', t0).neq('status', 'canceled').limit(150)
  let n = 0
  for (const r of ((res || []) as any[])) {
    try {
      const { data } = await cbGet<any>('getReservationNotes', { reservationID: r.id })
      for (const note of (Array.isArray(data) ? data : [])) {
        const body = String(note.reservationNote || note.note || '').trim()
        if (!body) continue
        await ingestMessage({ threadId: `note:${r.id}`, reservationId: r.id, guest: r.guest_name, channel: r.source, source: 'note', id: `note:${note.reservationNoteID || note.id || body.slice(0, 40)}`, direction: 'out', author: note.userName || 'Front desk', body, sentAt: note.dateCreated ? new Date(String(note.dateCreated).replace(' ', 'T') + 'Z').toISOString() : null, quiet: true })
        n++
      }
    } catch { /* one reservation's notes failing never stops the rest */ }
  }
  return n
}

export type HubResult = Record<string, number | string | null>
/** Runs with the Garden sync (lib/garden/sync). Each feed independent. */
export async function syncHub(): Promise<HubResult> {
  const out: HubResult = {}
  if (!cloudbedsConfigured()) return { skipped: 'Cloudbeds not connected' }
  const feeds: [string, () => Promise<number | null>][] = [['calendar', () => pullCalendar()], ['channels', pullChannels], ['payments', () => pullPayments()], ['blocks', pullRoomBlocks], ['notes', pullReservationNotes], ['messages', pullMessages]]
  for (const [k, fn] of feeds) {
    try { const n = await fn(); out[k] = n; if (n != null) await mark(k, { count: n }) }
    catch (e: any) { out[k] = `error: ${String(e?.message || e).slice(0, 160)}`; await mark(k, { error: String(e?.message || e) }) }
  }
  return out
}
