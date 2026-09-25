import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd, RES_SEL, shapeReservation as shape } from '@/lib/api-v1'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'reservations'); if (!g.ok) return g.res
  const date = ymd(req.nextUrl.searchParams.get('date'), todayET())
  const { data } = await supabaseAdmin().from('guesty_reservations').select(RES_SEL).eq('check_in', date).order('listing_name').limit(1000)
  const rows = ((data as any[]) || []).filter(r => !/cancel|declin|inquir|expire/i.test(String(r.status || ''))).map(shape)
  return json(rows, { date, count: rows.length })
}
