import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd, shift, RES_SEL, shapeReservation as shape } from '@/lib/api-v1'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'reservations'); if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const from = ymd(sp.get('from'), todayET()), to = ymd(sp.get('to'), shift(from, 14))
  const { data } = await supabaseAdmin().from('guesty_reservations').select(RES_SEL).gte('check_in', from).lte('check_in', to).order('check_in').limit(2000)
  let rows = ((data as any[]) || []).map(shape)
  const b = String(sp.get('building') || '').toLowerCase(); if (b) rows = rows.filter(r => String(r.building || '').toLowerCase() === b)
  return json(rows, { from, to, count: rows.length })
}
