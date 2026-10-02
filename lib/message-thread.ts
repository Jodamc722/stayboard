// ONE THREAD, LOADED ONCE, FOR THE PAGE AND THE PANE (Jon, 2026-10-01: "change the inbox to look like
// a unified inbox … the left-hand column shows the inbox, the right shows the full message thread
// when you open it, with details about the booking").
//
// /messages/[id] and /messages/phone/[number] used to assemble their thread inline. The unified inbox
// opens the same thread in a pane without leaving the list, through /api/messages/thread — so the
// assembly moved here and both read it. Access is the caller's job (Messages 'view'); money is masked
// here by the same app-wide rule the pages used (canSeeMoney).
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canSeeMoney, type Access } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { loadPhoneThread } from '@/lib/phone-threads'
import { talkrouteConfigured } from '@/lib/talkroute'

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
}
export type PhoneThreadData = {
  kind: 'phone'
  number: string; display: string; guest: string; unit: string; events: any[]; reservation: ThreadReservation; reservationId: string | null
  conversationId: string; fromNumber: string; connected: boolean; canReply: boolean
}

export async function loadGuestyThread(id: string, access: Access): Promise<GuestyThread | null> {
  const sb = supabaseAdmin()
  const money = canSeeMoney(access)
  const [{ data: convo }, { data: msgs }] = await Promise.all([
    sb.from('guesty_conversations').select('id, reservation_id, listing_id, guest_name, channel, raw').eq('id', id).maybeSingle(),
    sb.from('guesty_messages').select('id, sender, sender_name, body, sent_at, module, is_automated').eq('conversation_id', id).order('sent_at', { ascending: true }).limit(500),
  ])
  if (!convo) return null
  const meta: any = (convo.raw && typeof convo.raw === 'object') ? (convo.raw as any).meta || {} : {}
  const metaRes: any = Array.isArray(meta.reservations) && meta.reservations.length ? meta.reservations[0] : null
  const metaListing: any = metaRes?.listing || null
  let listingName = metaListing?.nickname || metaListing?.title || ''
  if (!listingName && convo.listing_id) {
    const { data: l } = await sb.from('guesty_listings').select('nickname, title').eq('id', convo.listing_id).maybeSingle()
    listingName = l?.nickname || l?.title || ''
  }
  let reservation: any = null
  if (convo.reservation_id) {
    const { data: r } = await sb.from('guesty_reservations').select(RES_COLS).eq('id', convo.reservation_id).maybeSingle()
    if (r) reservation = r
  }
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
  const guest = convo.guest_name || meta.guest?.fullName || reservation?.guest_name || 'Guest'
  return {
    kind: 'guesty', conversationId: String(convo.id), channel, guest, unit, listingName: listingName || reservation?.listing_name || '',
    messages: (msgs ?? []) as any[], reservation: reservation && reservation.id ? reservation : null, reservationId: convo.reservation_id ? String(convo.reservation_id) : null,
    guestyUrl: `https://app.guesty.com/inbox/${convo.id}`, canReply: atLeast(access.levels['messages'], 'edit'),
    guestEmail: meta.guest?.email || null, guestPhone: reservation?.guest_phone || meta.guest?.phone || null,
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
    kind: 'phone', number: t.number, display: t.display, guest: t.guestName || reservation?.guest_name || t.display, unit: unitOf(reservation?.listing_name || ''),
    events: t.events, reservation, reservationId: t.reservationId || null, conversationId: t.conversationId, fromNumber: t.fromNumber, connected,
    canReply: atLeast(access.levels['messages'], 'edit'),
  }
}
