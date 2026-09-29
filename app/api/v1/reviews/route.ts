import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { v1Gate, json, todayET, ymd, shift } from '@/lib/api-v1'
import { pageRows } from '@/lib/db-page'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const g = await v1Gate(req, 'reviews'); if (!g.ok) return g.res
  const sp = req.nextUrl.searchParams
  const since = ymd(sp.get('since'), shift(todayET(), -30))
  const min = Number(sp.get('min')), max = Number(sp.get('max'))
  // Paged, newest first (was one capped read): with a `since` far enough back to pass 1,000 reviews,
  // the oldest ones silently fell off (2026-09-29).
  const paged = await pageRows((a, b) => {
    let q = supabaseAdmin().from('guesty_reviews').select('id,listing_id,rating,channel,guest_name,content,created_at').gte('created_at', since + 'T00:00:00Z')
    if (Number.isFinite(min) && sp.get('min')) q = q.gte('rating', min)
    if (Number.isFinite(max) && sp.get('max')) q = q.lte('rating', max)
    return q.order('created_at', { ascending: false }).order('id').range(a, b)
  })
  if (paged.truncated) console.error('api/v1/reviews: read stopped early')
  const data = paged.rows
  const rows = ((data as any[]) || []).map(r => ({ id: r.id, listingId: r.listing_id, rating: r.rating, channel: r.channel, guest: r.guest_name, text: r.content, at: r.created_at }))
  return json(rows, { since, count: rows.length })
}
