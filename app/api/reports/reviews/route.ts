// Reviews pull for an existing owner report (P7). GET ?id=<reportId>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns a KPI summary (avg rating, count) + the full review list for the report's listings in
// that window, unit-labeled. The client stores the result in content.voices (kpi/all) and saves.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pullReviews, resolveScope } from '@/lib/owner-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const id = str(sp.get('id'))
  const from = str(sp.get('from'))
  const to = str(sp.get('to'))
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'id + from/to (YYYY-MM-DD) required' }, { status: 400 })
  }
  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('listing_ids').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : []).map((x: any) => String(x)).filter(Boolean)
  if (!ids.length) return NextResponse.json({ ok: true, kpi: null, reviews: [] })
  const scope = await resolveScope(ids, [])
  const byId: Record<string, any> = {}
  for (const l of scope.listings) byId[l.id] = l
  const rows = await pullReviews(ids, from, to)
  const rated = rows.filter(r => r.rating != null)
  const avg = rated.length ? Math.round((rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length) * 100) / 100 : null
  const fiveCount = rated.filter(r => (r.rating as number) >= 5).length
  const reviews = rows.slice(0, 100).map(r => {
    const l = r.listing_id ? byId[r.listing_id] : undefined
    return {
      text: r.content.slice(0, 500),
      guest: (r.guest_name || 'Guest'),
      unit: l ? 'Unit ' + (l.unit || l.name) : '',
      br: l && l.bedrooms != null ? l.bedrooms + 'BR' : '',
      rating: r.rating,
      date: r.created_at ? String(r.created_at).slice(0, 10) : '',
      channel: r.channel || '',
    }
  })
  return NextResponse.json({
    ok: true,
    kpi: { avg, count: rows.length, fiveStar: fiveCount, from, to },
    reviews,
  })
}
