// EVE'S GUEST REPLY DRAFTS (2026-09-21). A guest_reply_draft lands in eve_actions (kind
// 'guest_draft', status 'proposed') — on the thread page and in the Command Center's Decide band
// with Send / Discard. Send is the one path that runs guest_reply_send, and it runs it as a HUMAN
// yes (rung 2, welded): the person who pressed the button is on the receipt.
//
//   GET ?conversation=<id>  → the live draft for one thread (anyone who may see messages)
//   GET                     → every live draft, newest first (Decide band)
//   POST { op: 'send', id, body? }    → send it (edited text allowed), close the row, log with the sender
//   POST { op: 'discard', id, note? } → drop it
//
// REVIEW DRAFTS SEND TOO (2026-09-28 audit, D17). A draft with a reviewId and no thread is a public
// reply to a review (the bad_review_in watch). Send posts it through lib/review-reply — the same
// path as the Reviews page — and needs edit on Reviews, the bar /api/reviews/reply sets; a thread
// draft still needs edit on Messages.
import { NextRequest, NextResponse } from 'next/server'
import { requireAnyLevel } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { listGuestDrafts, decideGuestDraft } from '@/lib/eve/inbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET(req: NextRequest) {
  // Thread drafts belong to Messages, review drafts to Reviews: each person sees the ones their desk
  // can act on (it was Messages only, so a review lead never saw a review draft).
  const gate = await requireAnyLevel(['messages', 'reviews'], 'view')
  if (!gate.ok) return gate.res
  const seesThreads = atLeast(gate.access.levels['messages'], 'view')
  const seesReviews = atLeast(gate.access.levels['reviews'], 'view')
  const sp = new URL(req.url).searchParams
  const conv = str(sp.get('conversation')).trim()
  // The list (and DID WE ALREADY FOLLOW UP? — Jon, 2026-10-16) lives in lib/eve/inbox.ts now, so
  // the Eve inbox reads the same drafts the same way.
  const drafts = await listGuestDrafts({ seesThreads, seesReviews, conversation: conv })
  return NextResponse.json({ ok: true, drafts })
}

export async function POST(req: NextRequest) {
  // Either desk may act on a draft; which one it needs is checked once the draft says what it answers.
  const gate = await requireAnyLevel(['messages', 'reviews'], 'edit')
  if (!gate.ok) return gate.res
  const by = str(gate.access.email || 'someone')
  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id).trim()
  const op = str(body?.op)
  if (!id || (op !== 'send' && op !== 'discard')) return NextResponse.json({ error: 'op (send|discard) and id required' }, { status: 400 })
  // CLAIM FIRST, the desk check, the review path and the send all live in lib/eve/inbox.ts
  // decideGuestDraft (moved unchanged) — the Eve inbox runs the same copy.
  const r = await decideGuestDraft({ id, op: op as 'send' | 'discard', body: body?.body, note: body?.note, by, levels: gate.access.levels })
  return NextResponse.json(r.json, { status: r.status })
}
