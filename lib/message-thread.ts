// ONE THREAD, LOADED ONCE, FOR THE PAGE AND THE PANE (Jon, 2026-10-01: "change the inbox to look like
// a unified inbox … the left-hand column shows the inbox, the right shows the full message thread
// when you open it, with details about the booking").
//
// /inbox/[id] and /inbox/phone/[number] used to assemble their thread inline. The unified inbox
// opens the same thread in a pane without leaving the list, through /api/messages/thread — so the
// assembly moved here and both read it. Access is the caller's job (Messages 'view'); money is masked
// here by the same app-wide rule the pages used (canSeeMoney).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canSeeMoney, type Access } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { loadPhoneThread } from '@/lib/phone-threads'
import { talkrouteConfigured } from '@/lib/talkroute'
import { cleanGuestName } from '@/lib/guest-name'
import { hostVoiceFor } from '@/lib/host-voice'

export const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', homeaway: 'VRBO', homeaway2: 'VRBO', booking: 'Booking', 'booking.com': 'Booking',
  bookingcom: 'Booking', manual: 'Direct', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other',
}
export function unitOf(listingName: string): string {
  const m = String(listingName || '').match(/#?\s*([0-9]{2,5}[A-Za-z]?)\s*$/)
  return m ? m[1] : ''
}
const RES_COLS = 'id, guest_name, guest_phone, listing_name, check_in, check_out, nights, status, money_total, money_balance, money_currency, source'

export type ThreadReservation = {
  id: string; guest_name?: string | null; guest_phone?: string | null; listing_name?: string | null
  check_in?: string | null; check_out?: string | null; nights?: number | null; status?: string | null
  money_total?: number | null; money_balance?: number | null; money_currency?: string | null; source?: string | null
} | null

export type GuestyThread = {
  kind: 'guesty'
  conversationId: string; channel: string; guest: string; unit: string; listingName: string
  messages: any[]; reservation: ThreadReservation; reservationId: string | null; guestyUrl: string; canReply: boolean
  guestEmail: string | null; guestPhone: string | null
  /** The Guesty listing behind the thread — what "Create task" files against. */
  listingId: string | null
  /** The sign-off this home's replies carry when it is hosted under its owners' names (lib/host-voice), else null. */
  signOff: string | null
  /** What we believe about the unit's door code (door_code_state) — never the code itself. */
  door: DoorStatus | null
  /** Changes only when the thread's messages do: the pane sends it back and skips an identical reload. */
  sig: string
}
/** Door-code health for the thread header: when it was last confirmed working, last reported failing, last changed. */
export type DoorStatus = { verifiedAt: string | null; failedAt: string | null; fails: number; changedAt: string | null }

/** A fingerprint of a thread's messages: how many, and the newest one's id and time. */
export function threadSig(msgs: { id?: any; sent_at?: any }[]): string {
  const last = msgs.length ? msgs[msgs.length - 1] : null
  return msgs.length + ':' + String(last?.id ?? '') + ':' + String(last?.sent_at ?? '')
}
export type PhoneThreadData = {
  kind: 'phone'
  number: string; display: string; guest: string; unit: string; events: any[]; reservation: ThreadReservation; reservationId: string | null
  conversationId: string; fromNumber: string; connected: boolean; canReply: boolean
}

export async function loadGuestyThread(id: string, access: Access): Promise<GuestyThread | null> {
  const sb = supabaseAdmin()
  const money = canSeeMoney(access)
  // THE NEWEST 500, NOT THE OLDEST (inbox audit, 2026-11-09). This read was oldest-first with a
  // limit, so a thread past 500 messages showed its first 500 and silently dropped everything
  // recent — including the message being answered. Newest-first, then turned back into reading order.
  const [{ data: convo }, { data: newest }] = await Promise.all([
    sb.from('guesty_conversations').select('id, reservation_id, listing_id, guest_name, channel, raw').eq('id', id).maybeSingle(),
    sb.from('guesty_messages').select('id, sender, sender_name, body, sent_at, module, is_automated').eq('conversation_id', id).order('sent_at', { ascending: false }).limit(500),
  ])
  if (!convo) return null
  const msgs: any[] = ((newest ?? []) as any[]).slice().reverse()
  const meta: any = (convo.raw && typeof convo.raw === 'object') ? (convo.raw as any).meta || {} : {}
  const metaRes: any = Array.isArray(meta.reservations) && meta.reservations.length ? meta.reservations[0] : null
  const metaListing: any = metaRes?.listing || null
  let listingName = metaListing?.nickname || metaListing?.title || ''
  const listingId: string | null = convo.listing_id ? String(convo.listing_id) : (metaListing?._id ? String(metaListing._id) : null)
  // ONE ROUND for the three reads that hang off the conversation row: the listing (its building says
  // whose voice the home speaks in), the booking, and the door-code health for the header.
  const [lRes, rRes, dRes] = await Promise.all([
    listingId ? sb.from('guesty_listings').select('nickname, title, building').eq('id', listingId).maybeSingle() : Promise.resolve({ data: null }),
    convo.reservation_id ? sb.from('guesty_reservations').select(RES_COLS).eq('id', convo.reservation_id).maybeSingle() : Promise.resolve({ data: null }),
    listingId ? sb.from('door_code_state').select('changed_at,last_verified_at,last_failed_at,fail_count').eq('listing_id', listingId).maybeSingle() : Promise.resolve({ data: null }),
  ].map((q: any) => Promise.resolve(q).catch(() => ({ data: null }))))
  const l: any = (lRes as any)?.data || null
  const d: any = (dRes as any)?.data || null
  if (!listingName) listingName = l?.nickname || l?.title || ''
  let reservation: any = (rRes as any)?.data || null
  if (!reservation && metaRes) {
    const stay: any = metaRes.stay || {}
    reservation = {
      id: metaRes._id || convo.reservation_id || '', guest_name: meta.guest?.fullName || convo.guest_name || null, guest_phone: meta.guest?.phone || null,
      listing_name: listingName || null, check_in: metaRes.checkIn || stay.checkIn || null, check_out: metaRes.checkOut || stay.checkOut || null,
      nights: stay.nightsCount ?? null, status: metaRes.status || null, money_total: null, money_balance: null, money_currency: null, source: metaRes.source || null,
    }
  }
  if (reservation && !money) reservation = { ...reservation, money_total: null, money_balance: null, money_currency: null }
  const channel = CHANNEL_LABELS[String(convo.channel || '').toLowerCase()] || convo.channel || ''
  const unit = unitOf(listingName || reservation?.listing_name || '')
  // The name as a person writes it (lib/guest-name): Expedia's "MAR??A GABRIELA" reads "María Gabriela".
  const guest = cleanGuestName(convo.guest_name || meta.guest?.fullName || reservation?.guest_name, meta.guest?.fullName, reservation?.guest_name, [meta.guest?.firstName, meta.guest?.lastName].filter(Boolean).join(' ')) || 'Guest'
  if (reservation && reservation.guest_name) reservation = { ...reservation, guest_name: cleanGuestName(reservation.guest_name, meta.guest?.fullName, convo.guest_name) || reservation.guest_name }
  const hv = hostVoiceFor(listingName, reservation?.listing_name, l?.building, l?.nickname)
  const door: DoorStatus | null = d ? { verifiedAt: d.last_verified_at || null, failedAt: d.last_failed_at || null, fails: Number(d.fail_count) || 0, changedAt: d.changed_at || null } : null
  return {
    kind: 'guesty', conversationId: String(convo.id), channel, guest, unit, listingName: listingName || reservation?.listing_name || '',
    messages: msgs, reservation: reservation && reservation.id ? reservation : null, reservationId: convo.reservation_id ? String(convo.reservation_id) : null,
    guestyUrl: `https://app.guesty.com/inbox/${convo.id}`, canReply: atLeast(access.levels['messages'], 'edit'),
    guestEmail: meta.guest?.email || null, guestPhone: reservation?.guest_phone || meta.guest?.phone || null,
    listingId, signOff: hv ? hv.signOff : null, door, sig: threadSig(msgs),
  }
}

export async function loadPhoneThreadData(number: string, access: Access): Promise<PhoneThreadData> {
  const sb = supabaseAdmin()
  const [t, connected] = await Promise.all([loadPhoneThread(sb, number), talkrouteConfigured()])
  let reservation: any = null
  if (t.reservationId) {
    const { data: r } = await sb.from('guesty_reservations').select(RES_COLS).eq('id', t.reservationId).maybeSingle()
    if (r) reservation = canSeeMoney(access) ? r : { ...r, money_total: null, money_balance: null, money_currency: null }
  }
  return {
    kind: 'phone', number: t.number, display: t.display, guest: cleanGuestName(t.guestName || reservation?.guest_name, reservation?.guest_name) || t.display, unit: unitOf(reservation?.listing_name || ''),
    events: t.events, reservation, reservationId: t.reservationId || null, conversationId: t.conversationId, fromNumber: t.fromNumber, connected,
    canReply: atLeast(access.levels['messages'], 'edit'),
  }
}
