// Post a host reply to a Guesty review. PUT /reviews/{id}/reply { reviewReply }.
// The work — the inactive-listing close, the 20-second cap, the channel's "already answered", and
// saving the reply on our copy — lives in lib/review-reply.ts (2026-09-28), so Eve's review drafts
// in the Command Center can post through the same path. Edit access on Reviews; a person approves
// every post.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { postReviewReply } from '@/lib/review-reply'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'reviews' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('reviews', 'edit')
  if (!__gate.ok) return __gate.res

  const { reviewId, reviewReply } = await req.json().catch(() => ({} as any))
  if (!reviewId || !reviewReply || !String(reviewReply).trim()) {
    return NextResponse.json({ error: 'reviewId and reviewReply are required' }, { status: 400 })
  }
  const out = await postReviewReply(String(reviewId), String(reviewReply))
  return NextResponse.json(out.body, { status: out.status })
}
