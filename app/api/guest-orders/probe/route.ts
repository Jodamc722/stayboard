// Admin probe: what would the charge see? Lists the Guesty payment methods for a reservation
// and the custom-field id the link writes to — so the money path can be verified on a real
// booking BEFORE the first guest order is approved. Reads only; never charges.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listPaymentMethods, pickChargeable } from '@/lib/guesty-payments'
import { getGuestOrdersCfg, orderFormFieldId } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'full')
  if (!gate.ok) return gate.res
  const cfg = await getGuestOrdersCfg()
  const out: any = { ok: true, customField: { name: cfg.customFieldName, id: await orderFormFieldId(cfg.customFieldName) } }
  const reservationId = String(req.nextUrl.searchParams.get('reservation') || '').trim()
  if (reservationId) {
    const { data } = await supabaseAdmin().from('guesty_reservations').select('id,guest_id,guest_name,source,check_in,listing_name').eq('id', reservationId).limit(1)
    const r: any = (data || [])[0]
    if (!r) return NextResponse.json({ ...out, reservation: null, error: 'reservation not found locally' })
    const pm = await listPaymentMethods(String(r.guest_id || ''), reservationId)
    const pick = pm.ok ? pickChargeable(pm.methods) : null
    out.reservation = { id: r.id, guest: r.guest_name, source: r.source, checkIn: r.check_in, unit: r.listing_name }
    out.paymentMethods = pm.ok ? pm.methods.map(m => ({ id: m.id, method: m.method, brand: m.brand, last4: m.last4, status: m.status, reuse: m.reuse })) : []
    out.paymentMethodsError = pm.ok ? null : pm.error
    out.wouldCharge = pick ? { id: pick.id, brand: pick.brand, last4: pick.last4 } : null
    if (req.nextUrl.searchParams.get('raw') === '1') out.raw = pm.methods.map(m => m.raw)
  }
  return NextResponse.json(out)
}
