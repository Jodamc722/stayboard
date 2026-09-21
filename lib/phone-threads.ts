// PHONE THREADS — the Talkroute side of the unified inbox (2026-09-21).
//
// Jon: "I think we can find a way to unify the inboxes / conversations." Guesty threads are keyed
// by conversation; the phone is keyed by NUMBER. One guest number carries texts, voicemails and
// calls, so a phone thread is everything Talkroute has seen for that number, in time order, with
// the booking it matched. The Messages list shows phone threads beside Guesty threads; the thread
// page at /messages/phone/<number> shows the whole history and lets the team text back.
import 'server-only'
import { formatPhone, phoneDigits } from './talkroute'

export type PhoneThreadSummary = {
  kind: 'phone'
  number: string                 // digits
  display: string                // (305) 555-1234
  guestName: string
  reservationId: string
  listingId: string
  lastAt: string
  preview: string
  lastKind: 'sms' | 'voicemail' | 'call'
  awaiting: boolean              // latest event is from the guest with no reply after it
  unread: boolean
  counts: { texts: number; voicemails: number; calls: number }
}

export type PhoneEvent =
  | { kind: 'sms'; id: string; at: string; direction: 'incoming' | 'outgoing'; body: string; by: string; conversationId: string; attachments: any[] }
  | { kind: 'voicemail'; id: string; at: string; duration: number; transcript: string; transcribing: boolean; audio: string; callerName: string }
  | { kind: 'call'; id: string; at: string; direction: 'inbound' | 'outbound'; result: string; duration: number; recording: string; matchKind: string; externalName: string }

const iso = (v: any) => { const t = new Date(String(v || '')).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : '' }

/** The phone threads for the Messages list: newest `limit` numbers by last activity. */
export async function listPhoneThreads(sb: any, limit = 100): Promise<PhoneThreadSummary[]> {
  const since = new Date(Date.now() - 60 * 86400_000).toISOString()
  const [{ data: convos }, { data: vms }, { data: calls }] = await Promise.all([
    sb.from('talkroute_conversations').select('id,contact_number,last_message_at,last_message_preview,last_direction,messages_count,unread,reservation_id,guest_name,listing_id').order('last_message_at', { ascending: false }).limit(300),
    sb.from('talkroute_voicemails').select('id,caller_number,caller_name,duration,transcript,created_at,read,reservation_id').gte('created_at', since).order('created_at', { ascending: false }).limit(300),
    sb.from('talkroute_calls').select('id,direction,call_at,external_number,external_name,duration,result,reservation_id').gte('call_at', since).order('call_at', { ascending: false }).limit(600),
  ])
  const byNum = new Map<string, PhoneThreadSummary>()
  const get = (num: string) => {
    let t = byNum.get(num)
    if (!t) { t = { kind: 'phone', number: num, display: formatPhone(num), guestName: '', reservationId: '', listingId: '', lastAt: '', preview: '', lastKind: 'sms', awaiting: false, unread: false, counts: { texts: 0, voicemails: 0, calls: 0 } }; byNum.set(num, t) }
    return t
  }
  const bump = (t: PhoneThreadSummary, at: string, kind: PhoneThreadSummary['lastKind'], preview: string, awaiting: boolean) => {
    if (at && at > t.lastAt) { t.lastAt = at; t.lastKind = kind; t.preview = preview; t.awaiting = awaiting }
  }
  for (const c of (convos || [])) {
    const num = phoneDigits(c.contact_number); if (!num) continue
    const t = get(num)
    t.counts.texts += Number(c.messages_count) || 0
    if (c.reservation_id && !t.reservationId) { t.reservationId = String(c.reservation_id); t.guestName = String(c.guest_name || ''); t.listingId = String(c.listing_id || '') }
    if (c.unread) t.unread = true
    bump(t, iso(c.last_message_at), 'sms', String(c.last_message_preview || ''), c.last_direction === 'incoming')
  }
  for (const v of (vms || [])) {
    const num = phoneDigits(v.caller_number); if (!num) continue
    const t = get(num)
    t.counts.voicemails++
    if (v.reservation_id && !t.reservationId) t.reservationId = String(v.reservation_id)
    if (!t.guestName && v.caller_name) t.guestName = String(v.caller_name)
    if (v.read === false) t.unread = true
    bump(t, iso(v.created_at), 'voicemail', 'Voicemail' + (v.transcript ? ': ' + String(v.transcript).slice(0, 160) : ` (${Number(v.duration) || 0}s)`), true)
  }
  for (const c of (calls || [])) {
    const num = phoneDigits(c.external_number); if (!num) continue
    const t = get(num)
    t.counts.calls++
    if (c.reservation_id && !t.reservationId) t.reservationId = String(c.reservation_id)
    if (!t.guestName && c.external_name) t.guestName = String(c.external_name)
    const res = String(c.result || '')
    const label = c.direction === 'outbound' ? (res === 'answered' ? 'Outbound call · answered' : 'Outbound call · no answer') : (res === 'answered' ? 'Inbound call · answered' : 'Missed call from guest')
    bump(t, iso(c.call_at), 'call', label, c.direction === 'inbound' && res !== 'answered')
  }
  // Names from bookings where nothing on the phone side carried one.
  const need = Array.from(byNum.values()).filter(t => t.reservationId && !t.guestName).map(t => t.reservationId)
  if (need.length) {
    const { data: rs } = await sb.from('guesty_reservations').select('id,guest_name,listing_id').in('id', need.slice(0, 200))
    const m = new Map<string, any>((rs || []).map((r: any) => [String(r.id), r]))
    for (const t of Array.from(byNum.values())) { const r = m.get(t.reservationId); if (r) { t.guestName = t.guestName || String(r.guest_name || ''); t.listingId = t.listingId || String(r.listing_id || '') } }
  }
  return Array.from(byNum.values()).filter(t => t.lastAt).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, limit)
}

/** Everything for one number, oldest first, plus the booking and the Talkroute number to reply from. */
export async function loadPhoneThread(sb: any, numberRaw: string): Promise<{
  number: string; display: string; events: PhoneEvent[]; reservationId: string; conversationId: string; fromNumber: string; guestName: string
}> {
  const number = phoneDigits(numberRaw)
  const [{ data: convos }, { data: vms }, { data: calls }] = await Promise.all([
    sb.from('talkroute_conversations').select('id,talkroute_number,last_message_at,reservation_id,guest_name').eq('contact_number', number).order('last_message_at', { ascending: false }).limit(10),
    sb.from('talkroute_voicemails').select('id,talkroute_number,caller_name,duration,transcript,transcribing,audio_link,created_at,reservation_id').eq('caller_number', number).order('created_at', { ascending: false }).limit(100),
    sb.from('talkroute_calls').select('id,direction,call_at,talkroute_number,external_name,duration,result,recording:raw->>recording,match_kind,reservation_id').eq('external_number', number).order('call_at', { ascending: false }).limit(200),
  ])
  const convoIds = (convos || []).map((c: any) => String(c.id))
  const { data: texts } = convoIds.length
    ? await sb.from('talkroute_texts').select('id,conversation_id,direction,body,user_email,sent_at,attachments').in('conversation_id', convoIds).order('sent_at', { ascending: true }).limit(1000)
    : { data: [] }
  const events: PhoneEvent[] = []
  for (const m of (texts || [])) events.push({ kind: 'sms', id: String(m.id), at: iso(m.sent_at), direction: m.direction === 'outgoing' ? 'outgoing' : 'incoming', body: String(m.body || ''), by: String(m.user_email || ''), conversationId: String(m.conversation_id), attachments: Array.isArray(m.attachments) ? m.attachments : [] })
  for (const v of (vms || [])) events.push({ kind: 'voicemail', id: String(v.id), at: iso(v.created_at), duration: Number(v.duration) || 0, transcript: String(v.transcript || ''), transcribing: !!v.transcribing, audio: String(v.audio_link || ''), callerName: String(v.caller_name || '') })
  for (const c of (calls || [])) events.push({ kind: 'call', id: String(c.id), at: iso(c.call_at), direction: c.direction === 'outbound' ? 'outbound' : 'inbound', result: String(c.result || ''), duration: Number(c.duration) || 0, recording: String(c.recording || ''), matchKind: String(c.match_kind || ''), externalName: String(c.external_name || '') })
  events.sort((a, b) => a.at.localeCompare(b.at))
  const reservationId = String((convos || []).find((c: any) => c.reservation_id)?.reservation_id || (vms || []).find((v: any) => v.reservation_id)?.reservation_id || (calls || []).find((c: any) => c.reservation_id)?.reservation_id || '')
  const latestConvo: any = (convos || [])[0] || null
  const fromNumber = String(latestConvo?.talkroute_number || (calls || []).find((c: any) => c.talkroute_number)?.talkroute_number || (vms || []).find((v: any) => v.talkroute_number)?.talkroute_number || '')
  const guestName = String(latestConvo?.guest_name || (vms || []).find((v: any) => v.caller_name)?.caller_name || (calls || []).find((c: any) => c.external_name)?.external_name || '')
  return { number, display: formatPhone(number), events, reservationId, conversationId: String(latestConvo?.id || ''), fromNumber, guestName }
}
