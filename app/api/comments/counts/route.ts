// Comment COUNTS for a batch of entities so boards can show a badge without opening each
// thread. GET /api/comments/counts?type=task&ids=1,2,3 -> { counts: { "1": 2, ... } }
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const type = String(req.nextUrl.searchParams.get('type') || '')
  const ids = String(req.nextUrl.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 300)
  if (!type || !ids.length) return NextResponse.json({ ok: true, counts: {} })
  const db = supabaseAdmin()
  const { data, error } = await db.from('app_comments').select('entity_id').eq('entity_type', type).in('entity_id', ids).limit(2000)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const counts: Record<string, number> = {}
  for (const r of (data || []) as any[]) { const k = String(r.entity_id); counts[k] = (counts[k] || 0) + 1 }
  return NextResponse.json({ ok: true, counts })
}
