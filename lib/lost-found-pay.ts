// LOST & FOUND — PAID SHIPPING (Jon, 2026-11-05: "once you identify cost you can update here, then ask
// for guest to pay, once paid mark paid in the tab and then once paid should send breezeway task").
//
//   1. The cost is typed on the item (shipping_cost) and where it goes (ship_to).
//   2. Ask the guest to pay: for a booking Guesty can bill (not Airbnb), the cost goes on the Guesty
//      folio as one line, so the payment link or the card on file covers it; Airbnb guests are asked
//      through the Resolution Center. The message itself goes through /api/messages/send (the page
//      sends it, with that route's duplicate guard and receipt) — this file only records the ask.
//   3. Mark paid: a person says how it was paid. That is the moment the item is ready to leave.
//   4. Paid → "Lost & Found Delivery" in Breezeway (Jon, 2026-11-05: "call it lost and found delivery,
//      details, name of guest, $ cost we charged guest, address etc. This will be auto populated to
//      breezeway and sent to the county supervisors / Roberto"). One task on the unit, assigned to
//      Roberto plus the county's supervisor — the same people and settings the auto-inspections use
//      (task automation: assignAlways + supervisors by market), never-assign respected. Its id is kept
//      on the item; a failed push is recorded and can be retried from the page.
//      WHERE AND WHEN (Jon, 2026-11-05: "Delivery is going be Tuesday, so tasks should be created for
//      Tuesday. Assigned to lost and found Property… Should be as an inspection"): the task is an
//      INSPECTION on Breezeway's own "Lost and Found" property (not the guest's unit), dated the next
//      Tuesday. "It should keep moving the task not recreating it if not done": a delivery still open
//      after its Tuesday is moved to the next Tuesday — the same task, never a second one.
//   5. "Once they complete task it shows sent": syncSent() reads the task's status from the Breezeway
//      mirror and moves the item to Sent with who closed it.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { createInvoiceItems } from './guesty-payments'
import { createBreezewayTask, updateBreezewayTask, matchBreezewayPerson } from './breezeway'
import { getTaskAutomation } from './auto-inspections'
import { neverAssignGuard } from './never-assign'
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
/** Roberto + the county supervisor for this market → Breezeway person ids (never-assign respected). */
async function deliveryPeople(market: string | null): Promise<{ ids: number[]; names: string[] }> {
  const cfg = await getTaskAutomation()
  const sup = (cfg.supervisors as Record<string, string>)[market || ''] || cfg.supervisors.Miami
  const wanted = Array.from(new Set([cfg.assignAlways, sup].filter(Boolean))) as string[]
  let guard: Awaited<ReturnType<typeof neverAssignGuard>> | null = null
  try { guard = await neverAssignGuard() } catch { guard = null }
  const ids: number[] = [], names: string[] = []
  for (const n of wanted) {
    if (guard && guard.blocks(n)) continue
    let id: number | null = null
    try { id = await matchBreezewayPerson(n) } catch { id = null }
    if (id == null || (guard && guard.ids.has(Number(id)))) continue
    ids.push(Number(id)); names.push(n)
  }
  return { ids, names }
}

const SITE = 'https://lighthouse-stay.vercel.app'

/** Delivery day: Tuesday. Today if it is Tuesday, otherwise the next one (Eastern time). */
export function deliveryTuesday(fromISO = todayET()): string {
  const d = new Date(fromISO + 'T12:00:00Z')
  const add = (2 - d.getUTCDay() + 7) % 7          // 2 = Tuesday
  d.setUTCDate(d.getUTCDate() + add)
  return d.toISOString().slice(0, 10)
}

let _lfHome: { at: number; id: number | null; name: string } | null = null
/** Breezeway's "Lost and Found" property — where every delivery task lives. */
export async function lostFoundHome(): Promise<{ id: number | null; name: string }> {
  if (_lfHome && _lfHome.id && Date.now() - _lfHome.at < 10 * 60_000) return _lfHome   // a miss is never remembered
  const db = supabaseAdmin()
  const { data } = await db.from('breezeway_properties').select('home_id,name').limit(2000)
  const hit = ((data || []) as any[]).find(p => /lost\s*(?:&|and|n|\+)?\s*found/i.test(str(p.name)))
  _lfHome = { at: Date.now(), id: hit ? Number(hit.home_id) : null, name: hit ? str(hit.name) : '' }
  return _lfHome
}

/** Create the "Lost & Found Delivery" task for a paid item, assigned to Roberto + the county supervisor. */
export async function pushShipTask(item: any): Promise<{ ok: boolean; taskId?: string; error?: string; assignedTo?: string[]; date?: string }> {
  // Belt and braces: the route checks too. No payment, no ship task.
  if (!item.shipping_paid) return { ok: false, error: 'Not paid yet — the delivery task goes out once the guest has paid.' }
  if (item.breezeway_task_id) return { ok: true, taskId: String(item.breezeway_task_id) }
  const db = supabaseAdmin()
  const home = await lostFoundHome()
  if (!home.id || !Number.isFinite(home.id)) return { ok: false, error: 'No "Lost and Found" property found in Breezeway — create it there (or sync Breezeway properties), then Retry.' }
  const homeId = home.id
  const date = deliveryTuesday()
  const guest = str(item.guest_name) || 'Guest'
  const title = 'Lost & Found Delivery — ' + guest
  const charged = item.shipping_cost != null ? money(Number(item.shipping_cost)) : 'not recorded'
  const receipts = Array.isArray(item.receipts) ? item.receipts.length : 0
  const description = [
    'LOST & FOUND DELIVERY · paid by the guest — pack and ship',
    '',
    'Guest: ' + guest + (item.guest_phone ? ' · ' + str(item.guest_phone) : '') + (item.guest_email ? ' · ' + str(item.guest_email) : ''),
    'Stay: ' + str(item.unit) + (item.check_in ? ' · ' + str(item.check_in) + ' → ' + str(item.check_out) : ''),
    'Charged the guest: ' + charged + (item.paid_via ? ' · paid via ' + str(item.paid_via) : '') + (item.paid_at ? ' on ' + str(item.paid_at).slice(0, 10) : ''),
    'Ship to: ' + (str(item.ship_to) || 'ADDRESS MISSING — get it from the guest before shipping'),
    '',
    'Item: ' + str(item.item) + (item.description ? ' — ' + str(item.description).split('\nSlack:')[0].replace(/\s+/g, ' ').slice(0, 240) : ''),
    'Found: ' + str(item.found_date) + (item.found_where ? ' · ' + str(item.found_where) : ''),
    'Kept at: ' + (str(item.storage_location) || 'not recorded — check Lost & Found in Lighthouse'),
    'Receipt' + (receipts === 1 ? '' : 's') + ': ' + (receipts ? receipts + ' attached in Lighthouse' : 'none attached yet'),
    '',
    'Delivery day: Tuesday. Not done by then? Lighthouse moves this same task to the next Tuesday.',
    'Ship USPS at the price quoted (postcalc.usps.com). Add the tracking number on the item in Lighthouse; completing this task marks it Sent.',
    SITE + '/lost-found?item=' + str(item.id),
  ].join('\n')
  // allowDuplicate: every delivery is its own job (one per item) on the one Lost and Found property;
  // the item itself holds the task id, so a second press never makes a second task.
  const payload: Record<string, any> = { name: title, type_department: 'inspection', type_priority: 'high', scheduled_date: date, description, home_id: homeId, allowDuplicate: true }
  const r = await createBreezewayTask(payload)
  if (!r.ok || !r.data || !r.data.id) return { ok: false, error: 'Breezeway ' + r.status + ': ' + str(r.text).slice(0, 160) }
  const taskId = String(r.data.id)
  const who = await deliveryPeople(item.market || null).catch(() => ({ ids: [] as number[], names: [] as string[] }))
  // An assignment Breezeway refused used to be reported as made ("assigned to Roberto") while the
  // task sat unassigned. Only say assigned when Breezeway took it.
  let assigned = false
  if (who.ids.length) { try { const a = await updateBreezewayTask(taskId, { assignments: who.ids }); assigned = !!(a && a.ok) } catch { assigned = false } }
  const assignedTo = assigned ? who.names : []
  try {
    await db.from('breezeway_tasks_sync').upsert({
      id: taskId, reference_property_id: null, home_id: homeId, name: title, status: 'created',
      scheduled_date: date, type_department: 'inspection', assignees: assignedTo, report_url: r.data.report_url || null,
      raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch { /* the next Breezeway sync mirrors it */ }
  return { ok: true, taskId, assignedTo, date }
}

/** Completed Breezeway delivery tasks → the item shows Sent. Cheap: one read of the mirror. */
export async function syncSent(): Promise<number> {
  const db = supabaseAdmin()
  const { data: open } = await db.from('lost_found_items').select('id,breezeway_task_id,status,history')
    .not('breezeway_task_id', 'is', null).is('sent_at', null).in('status', ['held', 'contacted', 'claimed', 'shipping'])
  // 'shipping' with no sent_at is included (2026-11-09 audit): typing the tracking number marks the
  // item Sent by hand, and its Breezeway task then fell out of this pass — never moved to the next
  // Tuesday, never recorded as completed.
  const rows = (open || []) as any[]
  if (!rows.length) return 0
  const { data: tasks } = await db.from('breezeway_tasks_sync').select('id,status,assignees,scheduled_date,finished_at:raw->>finished_at').in('id', rows.map(r => String(r.breezeway_task_id)))
  const done: Record<string, any> = {}, late: any[] = []
  const today = todayET()
  for (const t of (tasks || []) as any[]) {
    if (/\b(complete|finish|close|approv)/i.test(str(t.status))) done[String(t.id)] = t
    else if (!/cancel|delet/i.test(str(t.status)) && str(t.scheduled_date) && str(t.scheduled_date).slice(0, 10) < today) late.push(t)
  }
  // MOVE, NEVER RECREATE: an open delivery past its Tuesday goes to the next Tuesday, same task.
  for (const t of late) {
    const to = deliveryTuesday(today)
    const u = await updateBreezewayTask(String(t.id), { scheduled_date: to }).catch(() => null)
    if (!u || !u.ok) continue
    await db.from('breezeway_tasks_sync').update({ scheduled_date: to, synced_at: new Date().toISOString() }).eq('id', String(t.id))
    const r = rows.find(x => String(x.breezeway_task_id) === String(t.id))
    if (r) {
      r.history = [...(Array.isArray(r.history) ? r.history : []), { at: new Date().toISOString(), who: 'Lighthouse', what: 'moved', note: 'Delivery not done on ' + str(t.scheduled_date).slice(0, 10) + ' — the same Breezeway task moved to Tuesday ' + to }].slice(-60)
      await db.from('lost_found_items').update({ history: r.history, updated_at: new Date().toISOString() }).eq('id', r.id)
    }
  }
  let n = 0
  for (const r of rows) {
    const t = done[String(r.breezeway_task_id)]
    if (!t) continue
    const by = Array.isArray(t.assignees) ? t.assignees.join(', ') : ''
    const at = str(t.finished_at) || new Date().toISOString()
    const history = [...(Array.isArray(r.history) ? r.history : []), { at: new Date().toISOString(), who: 'Lighthouse', what: 'sent', note: 'Breezeway delivery task #' + r.breezeway_task_id + ' completed' + (by ? ' (' + by + ')' : '') }].slice(-60)
    const { error } = await db.from('lost_found_items').update({ status: 'shipping', sent_at: at, sent_by: by || null, history, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (!error) n++
  }
  return n
}
