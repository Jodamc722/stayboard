import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { bustDay } from '@/lib/bust'
import { neverAssignRefusal } from '@/lib/never-assign'

export const dynamic = 'force-dynamic'

// Persist a staged cleaner assignment BEFORE it is pushed to Breezeway, so it survives
// a refresh, tab-switch, or sync and is visible to the whole team. Cleared on push.
export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'schedule' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('schedule', 'edit')
  if (!__gate.ok) return __gate.res
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
  // A staged pick is an assignment waiting for Push — the never-assign list refuses it here too.
  if (cleanerId != null && Number.isFinite(cleanerId)) {
    const refusal = await neverAssignRefusal({ ids: [cleanerId] })
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })
  }
  // Today in Ops reads the staged picks through its 45-second day cache (a staged clean is spoken
  // for, so Plan day must not propose a second person for it) — bust it once the write lands. The
  // Scheduler reads schedule_staged live on every load, so its own cache is left alone.
  // supabase-js does not throw on a failed write; the error is checked, never reported as saved.
  try {
    if (cleanerId == null || !Number.isFinite(cleanerId)) {
      const { error } = await db.from('schedule_staged').delete().eq('listing_id', listingId).eq('date', date)
      if (error) return NextResponse.json({ error: String(error.message || error).slice(0, 200) }, { status: 500 })
      bustDay()
      return NextResponse.json({ ok: true, cleared: true })
    }
    const { error } = await db.from('schedule_staged').upsert({ listing_id: listingId, date, cleaner_id: cleanerId, cleaner_name: cleanerName, updated_at: new Date().toISOString(), updated_by: user.email || null }, { onConflict: 'listing_id,date' })
    if (error) return NextResponse.json({ error: String(error.message || error).slice(0, 200) }, { status: 500 })
    bustDay()
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
