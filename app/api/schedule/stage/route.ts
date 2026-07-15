import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// Persist a staged cleaner assignment BEFORE it is pushed to Breezeway, so it survives
// a refresh, tab-switch, or sync and is visible to the whole team. Cleared on push.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '').trim()
  const date = String(body?.date || '').slice(0, 10)
  if (!listingId || !date) return NextResponse.json({ error: 'listingId and date required' }, { status: 400 })
  const db = supabaseAdmin()
  const cleanerId = body?.cleanerId != null && body.cleanerId !== '' ? Number(body.cleanerId) : null
  const cleanerName = body?.cleanerName ? String(body.cleanerName).slice(0, 120) : null
  try {
    if (cleanerId == null || !Number.isFinite(cleanerId)) {
      await db.from('schedule_staged').delete().eq('listing_id', listingId).eq('date', date)
      return NextResponse.json({ ok: true, cleared: true })
    }
    await db.from('schedule_staged').upsert({ listing_id: listingId, date, cleaner_id: cleanerId, cleaner_name: cleanerName, updated_at: new Date().toISOString(), updated_by: user.email || null }, { onConflict: 'listing_id,date' })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
