// LOST & FOUND — PAID SHIPPING (Jon, 2026-11-05: "once you identify cost you can update here, then ask
// for guest to pay, once paid mark paid in the tab and then once paid should send breezeway task").
//
//   1. The cost is typed on the item (shipping_cost) and where it goes (ship_to).
//   2. Ask the guest to pay: for a booking Guesty can bill (not Airbnb), the cost goes on the Guesty
//      folio as one line, so the payment link or the card on file covers it; Airbnb guests are asked
//      through the Resolution Center. The message itself goes through /api/messages/send (the page
//      sends it, with that route's duplicate guard and receipt) — this file only records the ask.
//   3. Mark paid: a person says how it was paid. That is the moment the item is ready to leave.
//   4. Paid → one Breezeway task on the unit to pack and ship it (createBreezewayTask, so the twin
//      guard applies), unassigned for the supervisor to hand out. Its id is kept on the item; a failed
//      push is recorded and can be retried from the page.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createInvoiceItems } from './guesty-payments'
import { createBreezewayTask } from './breezeway'
import { hostVoiceFor } from './host-voice'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2)
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

/** The booking's channel and its Guesty conversation — what the page needs to word and send the ask. */
export async function payContext(reservationId: string, unit = ''): Promise<{ source: string; airbnb: boolean; conversationId: string | null; guestFirst: string; signOff: string }> {
  const db = supabaseAdmin()
  const [{ data: res }, { data: conv }] = await Promise.all([
    db.from('guesty_reservations').select('source,guest_name').eq('id', reservationId).maybeSingle(),
    db.from('guesty_conversations').select('id').eq('reservation_id', reservationId).order('last_message_at', { ascending: false }).limit(1),
  ])
  const source = str((res as any)?.source)
  // Boynton Beach guests hear from Vanessa and Taylor, never "Stay Hospitality" (lib/host-voice).
  const voice = hostVoiceFor(unit)
  return { source, airbnb: /airbnb/i.test(source), conversationId: str(((conv || [])[0] as any)?.id) || null, guestFirst: str((res as any)?.guest_name).split(' ')[0] || '', signOff: voice ? voice.signOff : 'Stay Hospitality' }
}

/** Put the shipping cost on the Guesty folio (non-Airbnb bookings). Returns the new invoice item ids. */
export async function billOnFolio(item: any, amount: number): Promise<{ ok: boolean; ids: string[]; error?: string }> {
  if (!item.reservation_id) return { ok: false, ids: [], error: 'Attach the stay first.' }
  const r = await createInvoiceItems(String(item.reservation_id), [{
    title: 'Lost & found shipping',
    description: 'Shipping ' + str(item.item).slice(0, 80) + ' found in ' + str(item.unit) + ' on ' + str(item.found_date),
    amount, feeCode: 'GUEST_SERVICE',
  }])
  return r.ok ? { ok: true, ids: r.ids } : { ok: false, ids: r.ids, error: r.error || 'Guesty did not take the folio line' }
}

/** Create the Breezeway task that packs and ships a paid item. */
export async function pushShipTask(item: any): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  if (item.breezeway_task_id) return { ok: true, taskId: String(item.breezeway_task_id) }
  if (!item.listing_id) return { ok: false, error: 'The item has no unit on it — set the unit before the task can go to Breezeway.' }
  const db = supabaseAdmin()
  const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', item.listing_id).limit(1)
  const homeId = Number((((props || [])[0]) || {} as any).home_id)
  const title = 'Ship lost & found — ' + str(item.item).slice(0, 60) + (item.guest_name ? ' to ' + str(item.guest_name).split(' ')[0] : '')
  const description = [
    'LOST & FOUND · PAID — pack and ship',
    'Item: ' + str(item.item) + (item.description ? '\n' + str(item.description).split('\nSlack:')[0].slice(0, 300) : ''),
    'Kept at: ' + (str(item.storage_location) || 'not recorded — check the Lost & Found page'),
    'Ship to: ' + (str(item.ship_to) || 'ADDRESS MISSING — get it from the guest before shipping'),
    'Guest: ' + (str(item.guest_name) || 'Guest') + (item.guest_phone ? ' · ' + str(item.guest_phone) : ''),
    'Paid ' + (item.shipping_cost != null ? money(Number(item.shipping_cost)) : '') + (item.paid_via ? ' via ' + str(item.paid_via) : ''),
    'Ship USPS at the price quoted (postcalc.usps.com). When it is shipped, add the carrier and tracking on Lighthouse → Lost & Found.',
  ].join('\n')
  const payload: Record<string, any> = { name: title, type_department: 'housekeeping', type_priority: 'high', scheduled_date: todayET(), description }
  if (Number.isFinite(homeId)) payload.home_id = homeId
  else payload.reference_property_id = item.listing_id
  const r = await createBreezewayTask(payload)
  if (!r.ok || !r.data || !r.data.id) return { ok: false, error: 'Breezeway ' + r.status + ': ' + str(r.text).slice(0, 160) }
  const taskId = String(r.data.id)
  try {
    await db.from('breezeway_tasks_sync').upsert({
      id: taskId, reference_property_id: item.listing_id, home_id: Number.isFinite(homeId) ? homeId : null, name: title, status: 'created',
      scheduled_date: todayET(), type_department: 'housekeeping', assignees: [], report_url: r.data.report_url || null,
      raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch { /* the next Breezeway sync mirrors it */ }
  return { ok: true, taskId }
}
