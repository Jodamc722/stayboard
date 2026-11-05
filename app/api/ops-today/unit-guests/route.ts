// THE GUESTS ON A UNIT, FOR THE ADD-A-TASK SHEET (Jon, 2026-11-05: "Should be able to see messages
// from guest from there — any time a guest or reservation is added should be able to see it").
// GET ?listingId=<guesty listing id> → the stays around today (in house, arriving within 7 days,
// left within 7 days), each with its Guesty conversation id so the sheet can show the thread.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

export async function GET(req: NextRequest) {
  const g = await requireLevel('plan', 'view')
  if (!g.ok) return g.res
  const p = req.nextUrl.searchParams
  const listingId = String(p.get('listingId') || '').trim()
  const resId = String(p.get('reservationId') || '').trim()
  if (!listingId && !resId) return NextResponse.json({ ok: true, stays: [] })
  const db = supabaseAdmin()
  const today = ymd(new Date())
  const back = ymd(new Date(Date.now() - 7 * 86400_000)), fwd = ymd(new Date(Date.now() + 7 * 86400_000))
  let q = db.from('guesty_reservations').select('id,listing_id,guest_name,confirmation_code,check_in,check_out,status,source')
  q = resId ? q.eq('id', resId) : q.eq('listing_id', listingId).lte('check_in', fwd).gte('check_out', back)
  const { data: rows } = await q.order('check_in', { ascending: true }).limit(20)
  const stays = (rows || []).filter((r: any) => !/cancel|declin|inquiry|expired/i.test(String(r.status || '')))
  const ids = stays.map((r: any) => String(r.id))
  const convo: Record<string, string> = {}
  if (ids.length) {
    const { data: cs } = await db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', ids)
    for (const c of cs || []) if (c.reservation_id) convo[String(c.reservation_id)] = String(c.id)
  }
  const out = stays.map((r: any) => {
    const ci = String(r.check_in || '').slice(0, 10), co = String(r.check_out || '').slice(0, 10)
    const when = ci <= today && co > today ? 'in house' : ci > today ? 'arriving' : co === today ? 'checking out' : 'left'
    return { id: String(r.id), guest: r.guest_name || 'Guest', code: r.confirmation_code || null, checkIn: ci, checkOut: co, when, source: r.source || null, conversationId: convo[String(r.id)] || null }
  })
  const order: Record<string, number> = { 'in house': 0, 'checking out': 1, arriving: 2, left: 3 }
  out.sort((a, b) => order[a.when] - order[b.when] || a.checkIn.localeCompare(b.checkIn))
  return NextResponse.json({ ok: true, stays: out })
}
