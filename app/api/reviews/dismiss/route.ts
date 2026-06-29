// Dismiss a review ("no reply needed") so it drops off the Needs-a-reply list — or undo that.
// Reversible; does NOT post anything to the channel and does NOT affect scores. Logged-in users only.
// Requires the guesty_reviews.dismissed column (migration 004_review_dismiss.sql).
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const reviewId = body?.reviewId
  if (!reviewId) return NextResponse.json({ error: 'reviewId required' }, { status: 400 })
  const undo = body?.undo === true

  const sb = supabaseAdmin()
  const patch = undo
    ? { dismissed: false, dismissed_by: null, dismissed_at: null }
    : { dismissed: true, dismissed_by: String(user.email || '').toLowerCase(), dismissed_at: new Date().toISOString() }
  const { error } = await sb.from('guesty_reviews').update(patch).eq('id', reviewId)
  if (error) return NextResponse.json({ error: `Could not ${undo ? 'restore' : 'dismiss'} the review: ${error.message}. Has migration 004 (the dismissed column) been run?` }, { status: 500 })
  return NextResponse.json({ ok: true, dismissed: !undo })
}
