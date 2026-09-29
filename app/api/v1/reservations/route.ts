import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd, shift, RES_SEL, reservationShaper } from '@/lib/api-v1'
import { pageRows } from '@/lib/db-page'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'reservations'); if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const from = ymd(sp.get('from'), todayET()), to = ymd(sp.get('to'), shift(from, 14))
  // Paged (was one read capped at 1,000): a wide from/to silently lost every check-in after the 1,000th (2026-09-29).
  const paged = await pageRows((a, b) => supabaseAdmin().from('guesty_reservations').select(RES_SEL).gte('check_in', from).lte('check_in', to).order('check_in').order('id').range(a, b))
  if (paged.truncated) console.error('api/v1/reservations: read stopped early')
  let rows = (paged.rows as any[]).map(reservationShaper(g.canMoney))
  const b = String(sp.get('building') || '').toLowerCase(); if (b) rows = rows.filter(r => String(r.building || '').toLowerCase() === b)
  return json(rows, { from, to, count: rows.length })
}
