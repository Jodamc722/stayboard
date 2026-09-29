// A PHONE THREAD — everything Talkroute has seen for one guest number: texts, voicemails and
// calls, in time order, with the booking it belongs to and a box to text back. The phone half of
// the unified inbox (lib/phone-threads.ts); Guesty threads stay at /messages/[id].
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess, canSeeMoney } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { Shell } from '@/components/Shell'
import { PhoneThread } from '@/components/PhoneThread'
import { loadPhoneThread } from '@/lib/phone-threads'
import { talkrouteConfigured } from '@/lib/talkroute'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

function unitOf(listingName: string): string {
  const m = String(listingName || '').match(/#?\s*([0-9]{2,5}[A-Za-z]?)\s*$/)
  return m ? m[1] : ''
}

export default async function PhoneThreadPage({ params }: { params: { number: string } }) {
  // Same bar as the Guesty thread (2026-09-28 audit, D16): texts, voicemails and call notes are read
  // with the service role, so the page checks the Messages level, not just the session.
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed) redirect('/no-access')
  if (!atLeast(access.levels['messages'], 'view')) redirect(access.landing || '/no-access')
  const sb = supabaseAdmin()
  const [t, connected] = await Promise.all([loadPhoneThread(sb, params.number), talkrouteConfigured()])

  let reservation: any = null
  if (t.reservationId) {
    const { data: r } = await sb.from('guesty_reservations')
      .select('id, guest_name, guest_phone, listing_name, check_in, check_out, nights, status, money_total, money_balance, money_currency, source')
      .eq('id', t.reservationId).maybeSingle()
    if (r) reservation = canSeeMoney(access) ? r : { ...r, money_total: null, money_balance: null, money_currency: null }
  }
  const guest = t.guestName || reservation?.guest_name || t.display
  const unit = unitOf(reservation?.listing_name || '')

  return (
    <Shell>
      <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-3"><ArrowLeft size={15} /> All conversations</Link>
      <PhoneThread number={t.number} display={t.display} guest={guest} unit={unit} events={t.events} reservation={reservation}
        conversationId={t.conversationId} fromNumber={t.fromNumber} connected={connected} />
    </Shell>
  )
}
