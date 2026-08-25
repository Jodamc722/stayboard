// THE GUEST'S SIDE of the vending machine. Public by design: the 14-character link code is the
// only key, it is unguessable, and every read here is scoped to that one reservation. Nothing on
// this route can enumerate links, reservations or other guests.
//
//   GET  ?code=…            the stay, the catalog for that building, the deadline, past orders
//   POST { code, basket, note }   submit a basket (priced server-side, never from the client)
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getGuestOrdersCfg, loadCatalog, orderByFor, submitOrder, ordersForLink, fmtDay, fmtTimeET, todayET, timingFor, hubOf, type LinkRow } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CODE_RE = /^[A-Za-z0-9]{8,32}$/

async function linkFor(code: string): Promise<LinkRow | null> {
  if (!CODE_RE.test(code)) return null
  const { data } = await supabaseAdmin().from('guest_order_links').select('*').eq('code', code).limit(1)
  return data && data[0] ? (data[0] as LinkRow) : null
}

function publicOrder(o: any) {
  return {
    id: String(o.id).slice(0, 8), status: o.status, items: o.items, subtotal: o.subtotal_usd, tax: o.tax_usd, total: o.total_usd,
    submittedAt: o.submitted_at, deliveryDate: o.delivery_date, deliveryNote: o.delivery_note, note: o.guest_note, requested: o.requested_delivery, requestedDate: o.requested_date,
    paid: !!o.paid_at, declined: o.status === 'declined', delivered: o.status === 'delivered',
  }
}

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get('code') || '').trim()
  const link = await linkFor(code)
  if (!link) return NextResponse.json({ ok: false, error: 'This order link is not valid.' }, { status: 404 })
  const cfg = await getGuestOrdersCfg()
  const timing = timingFor(cfg, link.building, link.market, link.listing_id)
  const hub = hubOf(cfg, link.building, link.listing_id)
  const [catalog, orders] = await Promise.all([loadCatalog({ building: link.building, market: link.market, hub: hub ? hub.id : null, hideOutOfStock: true }), ordersForLink(link.code)])
  // first open, remembered once — the board shows "opened" so the team knows the guest saw it
  if (!link.opened_at) { try { await supabaseAdmin().from('guest_order_links').update({ opened_at: new Date().toISOString() }).eq('code', link.code) } catch { /* cosmetic */ } }

  const checkIn = link.check_in || todayET()
  const orderBy = orderByFor(checkIn, link.check_in_time, timing)
  const now = Date.now()
  const today = todayET()
  const inHouse = today >= checkIn && (!link.check_out || today < link.check_out)
  const departed = !!link.check_out && today >= link.check_out
  const arrivalDayStillPossible = now <= orderBy.getTime()
  // What the guest can expect if they pay right now — the same rule the approval uses.
  const nextDelivery = arrivalDayStillPossible
    ? 'on arrival day, ' + fmtDay(checkIn)
    : (inHouse ? 'within 24 hours of payment (same day if paid before ' + (timing.sameDayCutoffHour > 12 ? timing.sameDayCutoffHour - 12 + ' pm' : timing.sameDayCutoffHour + ' am') + ')' : 'the day after arrival at the latest — we confirm the time once payment clears')

  return NextResponse.json({
    ok: true,
    stay: {
      guestFirst: String(link.guest_name || 'there').split(' ')[0], unit: link.unit, building: link.building,
      checkIn, checkOut: link.check_out, checkInLabel: fmtDay(checkIn), checkOutLabel: fmtDay(link.check_out),
      inHouse, departed,
    },
    copy: { title: cfg.formTitle, intro: cfg.formIntro, taxPct: timing.taxPct, brand: cfg.brandLine, accent: cfg.accentColor, footer: cfg.footerNote },
    deadline: { orderBy: orderBy.toISOString(), orderByLabel: fmtTimeET(orderBy) + ' ET', arrivalDayStillPossible, nextDelivery, hoursBefore: timing.orderByHoursBefore, leadHours: timing.leadHours, offered: timing.enabled },
    catalog: catalog.map(c => ({ sku: c.sku, name: c.name, description: c.description, price: c.price_usd, unit: c.unit_label, category: c.category || 'Extras', maxQty: c.track_stock && c.available !== null && c.available !== undefined ? Math.min(c.max_qty, c.available) : c.max_qty, image: c.image_url, fewLeft: c.track_stock && c.available !== null && c.available !== undefined && c.available <= 3 ? c.available : null })),
    orders: orders.map(publicOrder),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const code = String(body?.code || '').trim()
  const link = await linkFor(code)
  if (!link) return NextResponse.json({ ok: false, error: 'This order link is not valid.' }, { status: 404 })
  if (link.check_out && todayET() >= link.check_out) return NextResponse.json({ ok: false, error: 'This stay has ended — thank you for staying with us!' }, { status: 400 })
  // a cancelled booking keeps its link but must not produce a chargeable order
  const { data: rs } = await supabaseAdmin().from('guesty_reservations').select('status').eq('id', link.reservation_id).limit(1)
  const rstatus = String(((rs || [])[0] || {}).status || '').toLowerCase()
  if (rstatus && ['confirmed', 'checked_in'].indexOf(rstatus) < 0) return NextResponse.json({ ok: false, error: 'This reservation is no longer active. If that is a surprise, reply to your booking message and we will help.' }, { status: 400 })
  const basket = (Array.isArray(body?.basket) ? body.basket : []).map((b: any) => ({ sku: String(b?.sku || '').slice(0, 60), qty: Math.floor(Number(b?.qty) || 0) })).filter((b: any) => b.sku && b.qty > 0).slice(0, 40)
  if (!basket.length) return NextResponse.json({ ok: false, error: 'Pick at least one item.' }, { status: 400 })
  // one open basket at a time — a second submit while the first waits is almost always a double tap
  const open = (await ordersForLink(link.code)).filter(o => o.status === 'submitted')
  if (open.length) return NextResponse.json({ ok: false, error: 'Your previous order is still being reviewed — we will be in touch shortly.' }, { status: 409 })
  const modeRaw = String(body?.delivery?.mode || 'auto')
  const mode = (['asap', 'arrival', 'date'].indexOf(modeRaw) >= 0 ? modeRaw : 'auto') as any
  let date: string | null = String(body?.delivery?.date || '') || null
  if (mode === 'date') {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: 'Pick a delivery date.' }, { status: 400 })
    if (link.check_in && date < link.check_in) return NextResponse.json({ ok: false, error: 'Delivery can’t be before your arrival.' }, { status: 400 })
    if (link.check_out && date >= link.check_out) return NextResponse.json({ ok: false, error: 'Delivery has to be before your checkout day.' }, { status: 400 })
    if (date < todayET()) return NextResponse.json({ ok: false, error: 'That date has passed.' }, { status: 400 })
  } else date = null
  const r = await submitOrder(link, basket, String(body?.note || ''), req.nextUrl.origin, { mode, date })
  if (!r.ok || !r.order) return NextResponse.json({ ok: false, error: r.error || 'Could not place the order.' }, { status: 400 })
  return NextResponse.json({ ok: true, order: publicOrder(r.order) })
}
