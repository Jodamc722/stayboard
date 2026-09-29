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
  const { data } = await cbGet<any[]>('getSources', {})
  const rows = (Array.isArray(data) ? data : []).map((s: any) => ({ id: String(s.sourceID || s.sourceName), name: String(s.sourceName || s.sourceID), kind: s.isThirdParty ? 'ota' : 'direct', status: s.status === false ? 'off' : 'on', synced_at: new Date().toISOString() }))
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
export async function ingestMessage(m: { threadId: string; reservationId?: string | null; guest?: string | null; channel?: string | null; id: string; direction: 'in' | 'out'; author?: string | null; body: string; sentAt?: string | null }): Promise<void> {
  const db = supabaseAdmin()
  const at = m.sentAt || new Date().toISOString()
  const { data: t } = await db.from('garden_threads').select('unread').eq('id', m.threadId).maybeSingle()
  await db.from('garden_threads').upsert({ id: m.threadId, reservation_id: m.reservationId || null, guest_name: m.guest || null, channel: m.channel || null, last_message_at: at, last_snippet: m.body.slice(0, 200), unread: m.direction === 'in' ? ((t as any)?.unread || 0) + 1 : 0, status: m.direction === 'in' ? 'open' : 'waiting', synced_at: new Date().toISOString() }, { onConflict: 'id' })
  await db.from('garden_messages').upsert({ id: m.id, thread_id: m.threadId, direction: m.direction, author: m.author || null, body: m.body, sent_at: at }, { onConflict: 'id' })
}

export type HubResult = Record<string, number | string | null>
/** Runs with the Garden sync (lib/garden/sync). Each feed independent. */
export async function syncHub(): Promise<HubResult> {
  const out: HubResult = {}
  if (!cloudbedsConfigured()) return { skipped: 'Cloudbeds not connected' }
  const feeds: [string, () => Promise<number | null>][] = [['calendar', () => pullCalendar()], ['channels', pullChannels], ['payments', () => pullPayments()], ['messages', pullMessages]]
  for (const [k, fn] of feeds) {
    try { const n = await fn(); out[k] = n; if (n != null) await mark(k, { count: n }) }
    catch (e: any) { out[k] = `error: ${String(e?.message || e).slice(0, 160)}`; await mark(k, { error: String(e?.message || e) }) }
  }
  return out
}
