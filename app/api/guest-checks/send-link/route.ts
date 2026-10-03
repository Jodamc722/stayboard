// SEND THE VERIFICATION LINK to the guest on their Guesty thread (the channel they booked on), and
// stamp when and by whom it went. If the thread cannot be found the desk copies the link instead.
//   POST { reservationId } → { ok, sent, via }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendGuestMessage } from '@/lib/guesty'
import { guestVerifyUrl } from '@/lib/guest-verify-token'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const g = await requireLevel('welcome-calls', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({} as any))
  const rid = String(b?.reservationId || '').trim()
  if (!rid) return NextResponse.json({ ok: false, error: 'Which reservation?' }, { status: 400 })
  const db = supabaseAdmin()
  const [{ data: r }, { data: convs }] = await Promise.all([
    db.from('guesty_reservations').select('id,guest_name,listing_name,check_in').eq('id', rid).maybeSingle(),
    db.from('guesty_conversations').select('id').eq('reservation_id', rid).order('last_message_at', { ascending: false }).limit(1),
  ])
  if (!r) return NextResponse.json({ ok: false, error: 'Reservation not found.' }, { status: 404 })
  const conv = ((convs || []) as any[])[0]
  const url = guestVerifyUrl(rid)
  if (!conv) return NextResponse.json({ ok: false, noThread: true, url, error: 'No message thread for this booking yet — copy the link and send it another way.' })
  const first = String((r as any).guest_name || '').trim().split(/\s+/)[0] || 'there'
  const text = String(b?.text || '').trim() || `Hi ${first}! Before your stay at ${(r as any).listing_name}, we do a quick ID check for every guest — it takes under a minute on your phone: ${url}\n\nIt's a photo of your ID and a selfie, stored privately and only for this reservation. Thank you! — Stay Hospitality`
  const res = await sendGuestMessage(String(conv.id), text)
  if (!res.ok) return NextResponse.json({ ok: false, url, error: res.error || 'Guesty refused the message.' }, { status: 502 })
  const now = new Date().toISOString()
  const { data: cur } = await db.from('guest_checks').select('*').eq('reservation_id', rid).maybeSingle()
  await db.from('guest_checks').upsert({ ...(cur || {}), reservation_id: rid, id_link_sent_at: now, id_link_sent_by: String(g.access.email || ''), id_link_sent_via: 'guesty', updated_at: now, updated_by: String(g.access.email || '') }, { onConflict: 'reservation_id' })
  return NextResponse.json({ ok: true, sent: true, via: res.module || 'guesty', url })
}
