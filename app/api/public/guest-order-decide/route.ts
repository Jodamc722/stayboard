// Approve or decline a guest order from the Slack DM link, on a phone, without logging in.
// Same contract as the outbox: the 24-byte token IS the authorisation and is cleared on first use.
// Approving CHARGES THE GUEST, so the page in front of this shows the basket and asks once.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrderByToken, approveOrder, declineOrder } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const token = String(body?.token || '').trim()
  const go = String(body?.go || '')
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ ok: false, error: 'bad token' }, { status: 400 })
  const order = await getOrderByToken(token)
  if (!order) return NextResponse.json({ ok: false, error: 'This link was already used or has expired. Open the Guest Orders board instead.' }, { status: 404 })
  if (order.status !== 'submitted') return NextResponse.json({ ok: false, error: 'Already handled — it is ' + order.status.replace('_', ' ') + '.' }, { status: 409 })
  // Burn the token BEFORE acting, and only proceed if this call is the one that burned it — a
  // double tap arrives as two requests and exactly one of them may go on to charge.
  const burn = await supabaseAdmin().from('guest_orders').update({ approve_token: null }).eq('id', order.id).eq('approve_token', token).select('id')
  if (burn.error || !burn.data || !burn.data.length) return NextResponse.json({ ok: false, error: 'That tap was already handled.' }, { status: 409 })
  const actor = 'slack-link'
  try {
    if (go === 'decline') {
      const r = await declineOrder(order.id, actor, String(body?.reason || 'declined from Slack'))
      return NextResponse.json({ ok: r.ok, error: r.error, status: 'declined' })
    }
    const r = await approveOrder(order.id, actor)
    return NextResponse.json({ ok: r.ok, error: r.error, status: r.order ? r.order.status : null, paymentNote: r.order ? r.order.payment_note : null, chargeError: r.order ? r.order.charge_error : null, deliveryDate: r.order ? r.order.delivery_date : null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) + ' — open the board to retry.' }, { status: 500 })
  }
}
