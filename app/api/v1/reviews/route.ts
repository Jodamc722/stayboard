import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd, shift } from '@/lib/api-v1'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'reviews'); if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const since = ymd(sp.get('since'), shift(todayET(), -30))
  let q = supabaseAdmin().from('guesty_reviews').select('id,listing_id,rating,channel,guest_name,content,created_at').gte('created_at', since + 'T00:00:00Z').order('created_at', { ascending: false }).limit(1000)
  const min = Number(sp.get('min')), max = Number(sp.get('max'))
  if (Number.isFinite(min) && sp.get('min')) q = q.gte('rating', min)
  if (Number.isFinite(max) && sp.get('max')) q = q.lte('rating', max)
  const { data } = await q
  const rows = ((data as any[]) || []).map(r => ({ id: r.id, listingId: r.listing_id, rating: r.rating, channel: r.channel, guest: r.guest_name, text: r.content, at: r.created_at }))
  return json(rows, { since, count: rows.length })
}
