// Admin probe: what would the charge see? Lists the Guesty payment methods for a reservation
// and the custom-field id the link writes to — so the money path can be verified on a real
// booking BEFORE the first guest order is approved. Reads only; never charges.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listPaymentMethods, pickChargeable } from '@/lib/guesty-payments'
import { getGuestOrdersCfg, orderFormFieldId } from '@/lib/guest-orders'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'full')
  if (!gate.ok) return gate.res
  const cfg = await getGuestOrdersCfg()
  const out: any = { ok: true, customField: { name: cfg.customFieldName, id: await orderFormFieldId(cfg.customFieldName) } }
  // ?fields=1 — WHY CAN'T WE FIND THE FIELD? The mirror `guesty_custom_fields` has been empty
  // before (the account payload nests the definitions and the parser missed the nesting, so the
  // sync recorded a clean zero for months). This reports what each Guesty endpoint actually
  // returns — the SHAPE and the field NAMES, never a guest value — so the parser can be aimed at
  // the real payload instead of guessed at.
  if (req.nextUrl.searchParams.get('fields') === '1') {
    const token = await getToken().catch(() => '')
    const base = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
    const acct = process.env.GUESTY_ACCOUNT_ID || '68af6c6fc3307ffd38a1c2b6'
    const look = async (path: string) => {
      try {
        const r = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
        const body: any = await r.json().catch(() => null)
        if (!r.ok) return { path, status: r.status, error: String(body?.error || body?.message || '').slice(0, 200) }
        const arrays: Record<string, number> = {}
        const walk = (o: any, at: string, d: number) => {
          if (!o || typeof o !== 'object' || d > 3) return
          for (const k of Object.keys(o)) {
            const v = o[k]
            if (Array.isArray(v)) { arrays[at + k] = v.length; if (v.length && typeof v[0] === 'object') walk(v[0], at + k + '[0].', d + 1) }
            else if (v && typeof v === 'object') walk(v, at + k + '.', d + 1)
          }
        }
        walk(body, '', 0)
        // the names are what we resolve by, so show them
        const cf = Array.isArray(body) ? body : (body?.customFields || body?.results || body?.data || body?.fields || body?.account?.customFields)
        return {
          path, status: r.status,
          topKeys: body && !Array.isArray(body) ? Object.keys(body).slice(0, 25) : ['(array)'],
          arrays,
          found: Array.isArray(cf) ? cf.length : 0,
          names: Array.isArray(cf) ? cf.slice(0, 60).map((c: any) => ({ id: c?._id || c?.id || null, name: c?.name ?? null, key: c?.key ?? null, target: c?.target ?? c?.objectType ?? null, type: c?.type ?? null })) : [],
        }
      } catch (e: any) { return { path, error: String(e?.message || e).slice(0, 200) } }
    }
    out.tokenOk = !!token
    out.endpoints = await Promise.all([
      look('/accounts/' + acct + '/custom-fields'),
      look('/accounts/custom-fields'),
      look('/custom-fields'),
    ])
  }

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
