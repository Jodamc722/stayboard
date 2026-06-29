import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { MessageThread } from '@/components/MessageThread'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CHANNEL_LABELS: Record<string, string> = {
  airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', homeaway: 'VRBO', homeaway2: 'VRBO', booking: 'Booking', 'booking.com': 'Booking',
  bookingcom: 'Booking', manual: 'Direct', sms: 'SMS', email: 'Email', whatsapp: 'WhatsApp', other: 'Other',
}

function unitOf(listingName: string): string {
  const m = String(listingName || '').match(/#?\s*([0-9]{2,5}[A-Za-z]?)\s*$/)
  return m ? m[1] : ''
}

export default async function MessageThreadPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = supabaseAdmin()
  const [{ data: convo }, { data: msgs }] = await Promise.all([
    sb.from('guesty_conversations').select('id, reservation_id, listing_id, guest_name, channel, raw').eq('id', params.id).maybeSingle(),
    sb.from('guesty_messages').select('id, sender, sender_name, body, sent_at').eq('conversation_id', params.id).order('sent_at', { ascending: true }).limit(500),
  ])
  if (!convo) notFound()

  // Guesty embeds the guest + reservation(s) + listing under raw.meta.
  const meta: any = (convo.raw && typeof convo.raw === 'object') ? (convo.raw as any).meta || {} : {}
  const metaRes: any = Array.isArray(meta.reservations) && meta.reservations.length ? meta.reservations[0] : null
  const metaListing: any = metaRes?.listing || null

  // Listing name / unit.
  let listingName = metaListing?.nickname || metaListing?.title || ''
  if (!listingName && convo.listing_id) {
    const { data: l } = await sb.from('guesty_listings').select('nickname, title').eq('id', convo.listing_id).maybeSingle()
    listingName = l?.nickname || l?.title || ''
  }

  // Reservation details: prefer our synced row, fall back to the conversation's embedded reservation.
  let reservation: any = null
  if (convo.reservation_id) {
    const { data: r } = await sb.from('guesty_reservations')
      .select('id, guest_name, guest_phone, listing_name, check_in, check_out, nights, status, money_total, money_balance, money_currency, source')
      .eq('id', convo.reservation_id).maybeSingle()
    if (r) reservation = r
  }
  if (!reservation && metaRes) {
    const stay: any = metaRes.stay || {}
    reservation = {
      id: metaRes._id || convo.reservation_id || '',
      guest_name: meta.guest?.fullName || convo.guest_name || null,
      guest_phone: meta.guest?.phone || null,
      listing_name: listingName || null,
      check_in: metaRes.checkIn || stay.checkIn || null,
      check_out: metaRes.checkOut || stay.checkOut || null,
      nights: stay.nightsCount ?? null,
      status: metaRes.status || null,
      money_total: null, money_balance: null, money_currency: null,
      source: metaRes.source || null,
    }
  }

  const channel = CHANNEL_LABELS[String(convo.channel || '').toLowerCase()] || convo.channel || ''
  const unit = unitOf(listingName || reservation?.listing_name || '')
  const guest = convo.guest_name || meta.guest?.fullName || reservation?.guest_name || 'Guest'
  const guestyUrl = `https://app.guesty.com/inbox/${convo.id}`

  return (
    <Shell>
      <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> All conversations</Link>
      <MessageThread
        conversationId={convo.id}
        channel={channel}
        guest={guest}
        unit={unit}
        initialMessages={(msgs ?? []) as any}
        reservation={reservation && reservation.id ? reservation : null}
        guestyUrl={guestyUrl}
      />
    </Shell>
  )
}
