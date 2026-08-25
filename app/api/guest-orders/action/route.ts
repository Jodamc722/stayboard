// Every human action on a guest order. Edit access on the Guest Orders tab; money actions
// (approve = charge, mark paid, cancel a paid order) need FULL.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  approveOrder, declineOrder, markPaid, cancelOrder, markDelivered, setDeliveryDate, pushOrder, getOrder,
  ensureLink, writeLinkToGuesty, getGuestOrdersCfg, linkUrl, createDueLinks, pushDue,
} from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MONEY = ['approve', 'mark_paid', 'cancel', 'run_cron']

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const action = String(body?.action || '')
  const gate = await requireLevel('guest-orders', MONEY.indexOf(action) >= 0 ? 'full' : 'edit')
  if (!gate.ok) return gate.res
  const actor = gate.access.email || 'staff'
  const id = String(body?.id || '')
  const cfg = await getGuestOrdersCfg()
  try {
    switch (action) {
      case 'approve': {
        const r = await approveOrder(id, actor)
        return NextResponse.json({ ok: r.ok, error: r.error, order: r.order })
      }
      case 'decline': {
        const r = await declineOrder(id, actor, String(body?.reason || ''))
        return NextResponse.json({ ok: r.ok, error: r.error, order: await getOrder(id) })
      }
      case 'mark_paid': {
        const settle = ['guesty', 'external', 'outside'].indexOf(String(body?.settle)) >= 0 ? String(body?.settle) as any : 'guesty'
        const r = await markPaid(id, actor, String(body?.note || ''), settle)
        return NextResponse.json({ ok: r.ok, error: r.error, order: r.order })
      }
      case 'cancel': {
        const r = await cancelOrder(id, actor)
        return NextResponse.json({ ok: r.ok, error: r.error, order: await getOrder(id) })
      }
      case 'delivered': {
        const r = await markDelivered(id, actor)
        return NextResponse.json({ ok: r.ok, error: r.error, order: await getOrder(id) })
      }
      case 'set_delivery': {
        const r = await setDeliveryDate(id, String(body?.date || ''), actor)
        return NextResponse.json({ ok: r.ok, error: r.error, order: await getOrder(id) })
      }
      case 'push_now': {
        const order = await getOrder(id)
        if (!order) return NextResponse.json({ ok: false, error: 'order not found' }, { status: 404 })
        if (['paid', 'pushed'].indexOf(order.status) < 0) return NextResponse.json({ ok: false, error: 'only a paid order can be pushed (it is ' + order.status + ')' }, { status: 400 })
        const r = await pushOrder(order, cfg, { date: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? String(body.date) : undefined, origin: req.nextUrl.origin })
        return NextResponse.json({ ok: r.ok, error: r.error, taskId: r.taskId, order: await getOrder(id) })
      }
      case 'create_link': {
        const reservationId = String(body?.reservationId || '').trim()
        if (!reservationId) return NextResponse.json({ ok: false, error: 'reservationId required' }, { status: 400 })
        const r = await ensureLink(reservationId, actor)
        if (!r.ok || !r.link) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
        const w = body?.write === false ? { ok: false, note: 'not written' } : await writeLinkToGuesty(r.link, cfg)
        return NextResponse.json({ ok: true, created: r.created, url: linkUrl(r.link.code, cfg, req.nextUrl.origin), code: r.link.code, guesty: w })
      }
      case 'write_link': {
        const code = String(body?.code || '')
        const { data } = await supabaseAdmin().from('guest_order_links').select('*').eq('code', code).limit(1)
        const link = data && data[0]
        if (!link) return NextResponse.json({ ok: false, error: 'link not found' }, { status: 404 })
        const w = await writeLinkToGuesty(link as any, cfg)
        return NextResponse.json({ ok: w.ok, error: w.ok ? undefined : w.note, note: w.note })
      }
      case 'run_cron': {
        const links = await createDueLinks(cfg, 25_000)
        const pushes = await pushDue(cfg, 25_000)
        return NextResponse.json({ ok: true, links, pushes })
      }
      default:
        return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 240) }, { status: 500 })
  }
}
