// ONE NOTICE, OPENED (Jon, 2026-10-07: "we should also be able to click into it and pull
// reservation details and go into Guesty").
//
// The list carries what the desk needs at a glance. This is what sits behind the click: the
// booking as Guesty holds it — money, nights, guests, status, the thread — alongside the ID and
// deposit record for that stay and the channel rule that says whether either was owed at all.
//
//   GET ?id=<notice id>  →  { ok, notice, reservation, check, guestyUrl }
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { RESERVATION_EMAILS_KEY, mergeProperties } from '@/lib/reservation-emails'
import { checksForNotices } from '@/lib/notice-checks'
import { guestSplit } from '@/lib/reservation-pull'

export const dynamic = 'force-dynamic'

const str = (v: any) => (v == null ? '' : String(v))
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const id = str(req.nextUrl.searchParams.get('id')).trim()
  if (!id) return NextResponse.json({ ok: false, error: 'Which notice?' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: n, error } = await db.from('reservation_notices').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message.slice(0, 200) }, { status: 500 })
  if (!n) return NextResponse.json({ ok: false, error: 'That notice is gone.' }, { status: 404 })

  const properties = mergeProperties(await getSetting<any>(RESERVATION_EMAILS_KEY, null))
  const prop = properties.find(p => p.id === (n as any).property_id)
  const notice = { ...(n as any), propertyName: prop ? prop.name : (n as any).property_id }

  // The booking itself. A notice filed by hand has no reservation id — then we try the
  // confirmation code, which is what a person would have typed off the OTA.
  let res: any = null
  const rid = str(notice.reservation_id)
  const code = str(notice.confirmation_code)
  const COLS = 'id,listing_id,listing_name,guest_name,guest_email,guest_phone,check_in,check_out,nights,status,source,confirmation_code,money_total,money_paid,money_balance,money_currency,conversation_id,notes,custom_fields'
  if (rid) { const { data } = await db.from('guesty_reservations').select(COLS).eq('id', rid).maybeSingle(); res = data || null }
  if (!res && code) { const { data } = await db.from('guesty_reservations').select(COLS).eq('confirmation_code', code).maybeSingle(); res = data || null }

  // Guests live in the raw payload, spelled four different ways by channel and API version —
  // guestSplit is the same probe the notice pull uses, so the two can't disagree. What the notice
  // already recorded wins nothing: it came from here in the first place, and is the fallback.
  let guests: { adults: number | null; children: number | null; pets: string | null } | null = null
  if (res?.id) {
    const { data: raw } = await db.from('guesty_reservations').select('raw').eq('id', res.id).maybeSingle()
    const g = guestSplit((raw as any)?.raw || {})
    guests = { adults: g.adults ?? num(notice.adults), children: g.children ?? num(notice.children), pets: str(notice.pets) || null }
  } else {
    guests = { adults: num(notice.adults), children: num(notice.children), pets: str(notice.pets) || null }
  }

  const checks = await checksForNotices([{ id: notice.id, reservation_id: notice.reservation_id, channel: notice.channel, property_id: notice.property_id, propertyName: notice.propertyName }])

  return NextResponse.json({
    ok: true,
    notice: { id: notice.id, propertyName: notice.propertyName },
    reservation: res ? {
      id: str(res.id), listingId: str(res.listing_id), unit: str(res.listing_name),
      guest: str(res.guest_name), email: str(res.guest_email), phone: str(res.guest_phone),
      checkIn: str(res.check_in).slice(0, 10), checkOut: str(res.check_out).slice(0, 10), nights: num(res.nights),
      status: str(res.status), source: str(res.source), code: str(res.confirmation_code),
      total: num(res.money_total), paid: num(res.money_paid), balance: num(res.money_balance), currency: str(res.money_currency) || 'USD',
      conversationId: str(res.conversation_id) || null, notes: str(res.notes).slice(0, 2000) || null,
      guests,
    } : null,
    check: checks[notice.id] || null,
    guestyUrl: res?.id ? 'https://app.guesty.com/reservations/' + encodeURIComponent(str(res.id)) + '/summary' : (rid ? 'https://app.guesty.com/reservations/' + encodeURIComponent(rid) + '/summary' : null),
  })
}
