// THE LIVE LINK for the field team: every guest order due today (and what is coming), grouped by
// building → unit, with who has it. Gated by the shared team password like /delivery. The one
// write is "delivered" — a tap from the phone of whoever carried it up.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { todayET, addDays, markDelivered, fmtDay } from '@/lib/guest-orders'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function shape(o: any, today: string) {
  const due = o.delivery_date || null
  return {
    id: String(o.id), unit: o.unit, building: o.building || 'Other', market: o.market, guest: String(o.guest_name || 'Guest').split(' ')[0],
    checkIn: o.check_in, checkOut: o.check_out, checkInLabel: fmtDay(o.check_in), inHouse: o.check_in && today > o.check_in,
    items: Array.isArray(o.items) ? o.items : [], note: o.guest_note, status: o.status,
    deliveryDate: due, deliveryLabel: due ? (due === today ? 'Today' : due < today ? 'Overdue · ' + fmtDay(due) : fmtDay(due)) : 'Unscheduled',
    overdue: !!due && due < today && o.status !== 'delivered', assignees: o.assignee_names || [], assignNote: o.assign_note, taskId: o.breezeway_task_id,
    deliveredAt: o.delivered_at, deliveredBy: o.delivered_by,
  }
}

export async function GET() {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  const today = todayET()
  const db = supabaseAdmin()
  const [live, done] = await Promise.all([
    db.from('guest_orders').select('*').in('status', ['paid', 'pushed']).lte('delivery_date', addDays(today, 7)).order('delivery_date', { ascending: true }).limit(300),
    db.from('guest_orders').select('*').eq('status', 'delivered').gte('delivered_at', new Date(Date.now() - 36 * 3_600_000).toISOString()).order('delivered_at', { ascending: false }).limit(100),
  ])
  const orders = (live.data || []).map(o => shape(o, today))
  return NextResponse.json({
    ok: true, today, todayLabel: fmtDay(today),
    due: orders.filter(o => o.deliveryDate && o.deliveryDate <= today),
    upcoming: orders.filter(o => !o.deliveryDate || o.deliveryDate > today),
    delivered: (done.data || []).map(o => shape(o, today)),
  })
}

export async function POST(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const id = String(body?.id || '')
  const who = String(body?.who || '').trim().slice(0, 60) || 'team (live link)'
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 })
  const r = await markDelivered(id, who)
  return NextResponse.json({ ok: r.ok, error: r.error })
}
