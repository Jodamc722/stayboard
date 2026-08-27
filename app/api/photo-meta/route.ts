// PER-PHOTO CORRECTIONS THAT ACTUALLY STICK.
//
// Jon, 2026-08-27: "We should also be able to edit the tag as well."
//
// You already could, visually. The category dropdown on each photo card called `setCategory`,
// which wrote React state and nothing else — the value was never sent anywhere, was not part of the
// push body, and was wiped by the next Analyze or page reload. Every tag anyone has corrected since
// the panel shipped was thrown away. The only real way to fix a mis-tag was to type a note in the
// guidance box and pay for a fresh 40-image vision call.
//
// This is the route that makes an edit real. It merges into `raw._photoIndex`, the same jsonb bag
// the vision pass writes, using the same pattern as /api/photo-caption.
//
// ── AND IT HAS TO SURVIVE THE NEXT ANALYZE ──────────────────────────────────────────────────────
// A correction that the next AI run silently reverts is worse than no correction: the operator
// fixes it, watches it come back wrong, and stops trusting the control. So a human edit is marked
// `by: 'human'` and /api/optimize-photos now treats those the way it has always treated a
// human-written caption — as the answer, not as a suggestion to be overwritten.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// One taxonomy. It was previously written out in five places that had already drifted — the model
// enum, the server sort ranks, the card dropdown, a different set of ranks in the bulk panel, and
// Eve's own vision table. This is the list the UI and this route agree on.
export const PHOTO_CATEGORIES = [
  'living', 'kitchen', 'dining', 'bedroom', 'bathroom',
  'outdoor', 'view', 'amenity', 'exterior', 'detail', 'other',
] as const

export async function POST(req: NextRequest) {
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '')
  const photoId = String(body?.photoId || '')
  if (!listingId || !photoId) return NextResponse.json({ error: 'listingId and photoId required' }, { status: 400 })

  const category = typeof body?.category === 'string' ? body.category.trim().toLowerCase() : null
  const room = typeof body?.room === 'string' ? body.room.trim().slice(0, 40) : null
  const caption = typeof body?.caption === 'string' ? body.caption.trim().slice(0, 240) : null
  if (category && (PHOTO_CATEGORIES as readonly string[]).indexOf(category) < 0) {
    return NextResponse.json({ error: `Unknown category "${category}".` }, { status: 400 })
  }
  if (!category && !room && caption == null) return NextResponse.json({ error: 'nothing to change' }, { status: 400 })

  const db = supabaseAdmin()
  const { data, error } = await db.from('guesty_listings').select('raw').eq('id', listingId).limit(1)
  if (error || !data?.[0]) return NextResponse.json({ error: 'listing not found' }, { status: 404 })

  const raw = ((data[0] as any).raw && typeof (data[0] as any).raw === 'object') ? { ...(data[0] as any).raw } : {}
  const idx = (raw._photoIndex && typeof raw._photoIndex === 'object') ? { ...raw._photoIndex } : {}
  const prev = (idx[photoId] && typeof idx[photoId] === 'object') ? idx[photoId] : {}
  idx[photoId] = {
    ...prev,
    ...(category ? { category } : {}),
    ...(room ? { room } : {}),
    ...(caption != null ? { caption } : {}),
    // The flag the next vision run reads. Without it the AI overwrites the correction tomorrow.
    by: 'human',
    at: new Date().toISOString(),
  }
  raw._photoIndex = idx

  const { error: upErr } = await db.from('guesty_listings').update({ raw }).eq('id', listingId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, photoId, meta: idx[photoId] })
}
