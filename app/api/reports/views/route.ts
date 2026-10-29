// Viewing sessions for one report or deck, for the Views panel. Team only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabaseAdmin().from('report_views')
    .select('session_id, visitor_id, started_at, last_seen, device, referrer, country, region, city, total_ms, max_slide, slide_count, presented, slides, clicks')
    .eq('report_id', id).order('started_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ ok: false, error: error.message, needsMigration: /report_views/.test(error.message) }, { status: 200 })
  return NextResponse.json({ ok: true, views: data || [] })
}
