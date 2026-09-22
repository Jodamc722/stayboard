// MARK A REVIEW AS REMOVED BY THE CHANNEL -- or undo it.
//
// Jon, 2026-09-22: "we also got a few reviews removed, not sure if guesty catches that but
// should. If not we should have a option at the review page to state review was removed."
//
// Guesty does not catch it. /api/cron/sync-reviews pages the feed and upserts by id,
// incrementally: no delete path, no flag. When a channel pulls a review it just stops coming
// back, and our row lives on inside every average. So a person says so here, and that is
// deliberate -- the sync is never allowed to remove a review on its own, because one bad page
// of API results would silently delete real reviews.
//
// Removed implies excluded from the score, so the many readers that already filter on
// excluded_from_score are covered by this write alone; the readers that filtered on nothing
// were given `.is('removed_at', null)` in the same change.
//
// UNDO IS CAREFUL: it only clears excluded_from_score when this route is what set it. A review
// excluded for its own reason ("listing not mapped on channel") stays excluded.
import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'

const EXCLUDE_REASON = 'removed by the channel'

export async function POST(req: Request) {
  const gate = await requireLevel('reviews', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const reviewId = body?.reviewId
  if (!reviewId) return NextResponse.json({ error: 'reviewId required' }, { status: 400 })
  const undo = body?.undo === true
  const reason = String(body?.reason || '').trim().slice(0, 200)

  const sb = supabaseAdmin()
  let patch: Record<string, any>
  if (undo) {
    const { data: cur } = await sb.from('guesty_reviews').select('exclude_reason').eq('id', reviewId).maybeSingle()
    const oursDidIt = String((cur as any)?.exclude_reason || '') === EXCLUDE_REASON
    patch = { removed_at: null, removed_by: null, removed_reason: null }
    if (oursDidIt) { patch.excluded_from_score = false; patch.exclude_reason = null }
  } else {
    patch = {
      removed_at: new Date().toISOString(),
      removed_by: String(user.email || '').toLowerCase(),
      removed_reason: reason || null,
      excluded_from_score: true,
      exclude_reason: EXCLUDE_REASON,
    }
  }

  const { error } = await sb.from('guesty_reviews').update(patch).eq('id', reviewId)
  if (error) {
    return NextResponse.json({
      error: `Could not ${undo ? 'restore' : 'mark'} the review: ${error.message}. Has migration 107 (the removed_at column) been run?`,
    }, { status: 500 })
  }
  try { revalidateTag('reviews') } catch { /* best effort */ }
  return NextResponse.json({ ok: true, removed: !undo })
}
