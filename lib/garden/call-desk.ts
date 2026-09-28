// THE GARDEN HOTEL CALL DESK — welcome calls and the rest of what the desk owes each guest.
//
// Jon, 2026-09-28: "the garden will do welcome calls". The VR Calls desk taught the rules (lib/
// call-desk.ts): a welcome call is workable from a few days before arrival through the arrival day,
// never after the guest has slept in the room; a call not completed in its window is closed as
// incomplete, not carried. Here the same shape, driven by garden_hotel settings:
//   welcome     due (daysBefore) before check-in at fromHour ET; window closes at check-in time
//   verification due on booking when ID/card are required and not yet passed; closes at check-in
//   post_stay / review_ask   due hoursAfterCheckout after check-out; closes 3 days later
// garden_call_queue is the to-do; garden_calls (the log) records every attempt; a logged attempt
// bumps the queue row, and an outcome of 'reached' completes it.
import 'server-only'
import { supabaseAdmin } from '../supabase-admin'
import { getHotel, getVoice, type HotelSettings } from './settings'
import { todayET } from './sync'

const ET = 'America/New_York'
const LIVE = ['confirmed', 'not_confirmed', 'checked_in']

/** An ET wall-clock on a date → ISO. */
export function etTime(ymd: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  // Find the UTC offset in effect on that date in ET.
  const probe = new Date(`${ymd}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour12: false, hour: '2-digit' }).formatToParts(probe)
  const etHour = Number(parts.find(p => p.type === 'hour')?.value || 12)
  const offset = 12 - etHour   // 4 in EDT, 5 in EST
  return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)), (h || 0) + offset, m || 0)).toISOString()
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)

function mandatory(h: HotelSettings, r: any): boolean {
  const m = h.welcomeCall.mandatoryFor
  if (m.includes('all')) return true
  const src = String(r.source || '').toLowerCase()
  const direct = !src || /direct|website|walk|phone|cloudbeds/.test(src)
  if (m.includes('direct') && direct) return true
  if (m.includes('ota') && !direct) return true
  if (m.includes('long_stay') && (Number(r.nights) || 0) >= h.welcomeCall.longStayNights) return true
  return false
}

/** Build/refresh the queue from the reservation mirror. Idempotent on (reservation, kind). */
export async function buildCallQueue(): Promise<{ added: number; expired: number }> {
  const db = supabaseAdmin()
  const h = await getHotel()
  const t0 = todayET(0)
  const { data: res } = await db.from('garden_reservations').select('id,status,guest_name,guest_phone,check_in,check_out,nights,source,room_names,balance')
    .in('status', [...LIVE, 'checked_out']).gte('check_out', addDays(t0, -4)).lte('check_in', addDays(t0, h.welcomeCall.daysBefore + 1))
  const { data: existing } = await db.from('garden_call_queue').select('reservation_id,kind')
  const have = new Set(((existing || []) as any[]).map(q => `${q.reservation_id}|${q.kind}`))
  const { data: vers } = await db.from('garden_verifications').select('reservation_id,kind,status').in('status', ['passed', 'waived'])
  const verOk: Record<string, Set<string>> = {}
  for (const v of ((vers || []) as any[])) (verOk[v.reservation_id] = verOk[v.reservation_id] || new Set()).add(v.kind)
  const rows: any[] = []
  const hh = (n: number) => `${String(n).padStart(2, '0')}:00`
  for (const r of ((res || []) as any[])) {
    if (!r.check_in || !r.check_out) continue
    const push = (kind: string, due_at: string, window_end: string | null) => { const k = `${r.id}|${kind}`; if (!have.has(k)) { have.add(k); rows.push({ reservation_id: r.id, kind, due_at, window_end }) } }
    if (LIVE.includes(r.status) && r.check_in >= t0) {
      if (h.welcomeCall.enabled && mandatory(h, r)) push('welcome', etTime(addDays(r.check_in, -h.welcomeCall.daysBefore), hh(h.welcomeCall.fromHour)), etTime(r.check_in, h.checkInTime))
      const need = (h.verification.requireId && !verOk[r.id]?.has('id')) || (h.verification.requireCard && !verOk[r.id]?.has('card'))
      if (need && (!h.verification.sources.length || h.verification.sources.some(s => String(r.source || '').toLowerCase().includes(s.toLowerCase())))) push('verification', new Date().toISOString(), etTime(r.check_in, h.checkInTime))
    }
    if (r.status === 'checked_out' || r.check_out <= t0) {
      const due = new Date(Date.parse(etTime(r.check_out, h.checkOutTime)) + h.postStay.hoursAfterCheckout * 3600000).toISOString()
      const end = etTime(addDays(r.check_out, 3), '23:00')
      if (h.postStay.callEnabled) push('post_stay', due, end)
      if (h.postStay.reviewAskEnabled) push('review_ask', due, end)
    }
  }
  let added = 0
  if (rows.length) { const { error } = await db.from('garden_call_queue').insert(rows); if (error) throw new Error(error.message); added = rows.length }
  // Windows that closed: incomplete, not carried (the VR rule).
  const { data: exp } = await db.from('garden_call_queue').update({ status: 'expired', note: 'window closed — not completed in time' }).eq('status', 'pending').lt('window_end', new Date().toISOString()).select('id')
  // Verification queue rows complete themselves when the checks pass.
  const { data: pendV } = await db.from('garden_call_queue').select('id,reservation_id').eq('status', 'pending').eq('kind', 'verification')
  for (const q of ((pendV || []) as any[])) {
    const ok = (!h.verification.requireId || verOk[q.reservation_id]?.has('id')) && (!h.verification.requireCard || verOk[q.reservation_id]?.has('card'))
    if (ok) await db.from('garden_call_queue').update({ status: 'done', done_at: new Date().toISOString(), done_by: 'verifications', last_outcome: 'verified' }).eq('id', q.id)
  }
  return { added, expired: (exp || []).length }
}

/** A call logged in garden_calls updates its queue row. Called by the calls route. */
export async function noteAttempt(reservationId: string, kind: string, outcome: string, by: string | null): Promise<void> {
  const db = supabaseAdmin()
  const qk = kind === 'pre_arrival' ? 'welcome' : kind
  const { data: q } = await db.from('garden_call_queue').select('id,attempts,status').eq('reservation_id', reservationId).eq('kind', qk).maybeSingle()
  if (!q) return
  const patch: any = { attempts: (Number(q.attempts) || 0) + 1, last_outcome: outcome, last_attempt_at: new Date().toISOString() }
  if (outcome === 'reached' && q.status === 'pending') { patch.status = 'done'; patch.done_at = patch.last_attempt_at; patch.done_by = by }
  await db.from('garden_call_queue').update(patch).eq('id', q.id)
}

/** The desk's list: due now first, then upcoming, each with the reservation and a script. */
export async function callQueue(opts: { status?: string; days?: number } = {}) {
  const db = supabaseAdmin()
  const status = opts.status || 'pending'
  const to = new Date(Date.now() + (opts.days || 3) * 86400000).toISOString()
  let q = db.from('garden_call_queue').select('*').eq('status', status).order('due_at')
  q = status === 'pending' ? q.lte('due_at', to) : q.order('done_at', { ascending: false }).limit(200)
  const { data: rows } = await q
  const ids = Array.from(new Set(((rows || []) as any[]).map(r => r.reservation_id).filter(Boolean)))
  const { data: res } = ids.length ? await db.from('garden_reservations').select('id,status,guest_name,guest_phone,guest_email,check_in,check_out,nights,adults,children,room_names,source,balance,total').in('id', ids) : { data: [] as any[] }
  const byId: Record<string, any> = {}
  for (const r of ((res || []) as any[])) byId[r.id] = r
  const now = Date.now()
  return ((rows || []) as any[]).map(r => ({ ...r, reservation: byId[r.reservation_id] || null, dueNow: Date.parse(r.due_at) <= now, overdue: r.window_end ? (Date.parse(r.window_end) - now) < 6 * 3600000 : false }))
}

/** The welcome-call script for one reservation, from the voice settings — no model call. */
export async function welcomeScript(reservationId: string): Promise<{ opening: string; points: string[]; closing: string; facts: Record<string, string> }> {
  const db = supabaseAdmin()
  const [{ data: r }, h, v] = await Promise.all([db.from('garden_reservations').select('*').eq('id', reservationId).maybeSingle(), getHotel(), getVoice()])
  const first = String(r?.guest_name || 'there').split(/\s+/)[0]
  const fmt = (ymd: string | null) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '—'
  const facts: Record<string, string> = {
    guest: String(r?.guest_name || ''), arrives: fmt(r?.check_in || null), leaves: fmt(r?.check_out || null), nights: String(r?.nights ?? ''),
    room: (r?.room_names || []).join(', ') || 'to be assigned', guests: `${r?.adults || 0} adult${r?.adults === 1 ? '' : 's'}${r?.children ? `, ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}`,
    source: String(r?.source || 'direct'), balance: r?.balance != null ? `$${Math.round(Number(r.balance))}` : '—', checkIn: h.checkInTime, checkOut: h.checkOutTime, desk: h.frontDeskPhone || '(front desk number)',
  }
  return {
    opening: `Hi ${first}, this is ${h.managerName || 'the front desk'} at ${h.name}. I am calling ahead of your stay on ${facts.arrives} — do you have a minute?`,
    points: v.welcomeCallPoints,
    closing: `Anything at all before you arrive, call us on ${facts.desk} — someone is here around the clock. We are looking forward to having you.`,
    facts,
  }
}
