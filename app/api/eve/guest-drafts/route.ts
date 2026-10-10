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
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bustDay } from '@/lib/bust'

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
  if (conv && !seesThreads) return NextResponse.json({ ok: true, drafts: [] })
  try {
    let q = supabaseAdmin().from('eve_actions').select('id,payload,why,status,created_by,created_at').eq('kind', 'guest_draft').eq('status', 'proposed').order('created_at', { ascending: false }).limit(conv ? 1 : 40)
    if (conv) q = q.filter('payload->>conversationId', 'eq', conv)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: true, drafts: [] })
    const visible = ((data as any[]) || []).filter(r => (r.payload?.conversationId ? seesThreads : seesReviews))
    const drafts = visible.map(r => ({
      id: str(r.id), conversationId: r.payload?.conversationId || null, reviewId: r.payload?.reviewId || null,
      draft: str(r.payload?.draft), guest: r.payload?.guest || null, unit: r.payload?.unit || null, channel: r.payload?.channel || null,
      why: str(r.why), by: r.payload?.by || r.created_by || 'eve', createdAt: r.created_at,
    }))
    return NextResponse.json({ ok: true, drafts })
  } catch { return NextResponse.json({ ok: true, drafts: [] }) }
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
  const db = supabaseAdmin()
  const { data: row } = await db.from('eve_actions').select('id,payload,status').eq('id', id).eq('kind', 'guest_draft').maybeSingle()
  if (!row) return NextResponse.json({ error: 'that draft is no longer on file' }, { status: 404 })
  if ((row as any).status !== 'proposed') return NextResponse.json({ error: `already ${(row as any).status}` }, { status: 409 })
  const pl: any = (row as any).payload || {}
  const nowISO = new Date().toISOString()
  const isReview = !str(pl.conversationId) && !!str(pl.reviewId)
  if (!atLeast(gate.access.levels[isReview ? 'reviews' : 'messages'], 'edit')) {
    return NextResponse.json({ error: `Your role needs edit access on ${isReview ? 'Reviews' : 'Messages'} to ${op} this draft.` }, { status: 403 })
  }
  // CLAIM FIRST (2026-09-28). The same draft shows on the thread and in Decide, to everyone on the
  // desk — and a review draft can now be posted from Decide too. Two presses a second apart must
  // not message the guest, or post the public reply, twice: only the request whose claim lands
  // goes on.
  const { data: claim, error: claimErr } = await db.from('eve_actions')
    .update({ status: op === 'discard' ? 'rejected' : 'approved', decided_by: by, decided_at: nowISO })
    .eq('id', id).eq('status', 'proposed').select('id')
  if (claimErr) return NextResponse.json({ error: 'could not claim the draft: ' + claimErr.message }, { status: 500 })
  if (!((claim as any[]) || []).length) return NextResponse.json({ error: 'someone else just acted on this draft' }, { status: 409 })

  if (op === 'discard') {
    await db.from('eve_actions').update({ status: 'rejected', decided_by: by, decided_at: nowISO, result: { note: str(body?.note).slice(0, 300) || 'discarded' } }).eq('id', id)
    const { logAgent } = await import('@/lib/eve/agent-mode')
    await logAgent({ action: 'guest_reply_draft', rung: 2, allowed: false, mode: 'observe', reason: `draft discarded by ${by}`, summary: `discarded draft to ${pl.guest || 'guest'}`, ref: id, by: 'chat', actor: by })
    bustDay()
    return NextResponse.json({ ok: true })
  }

  if (isReview) {
    // A PUBLIC REVIEW REPLY: posted through the Reviews page's own path, with this person's yes.
    const text = str(body?.body).trim() || str(pl.draft).trim()
    if (!text) return NextResponse.json({ error: 'nothing to send' }, { status: 400 })
    const { postReviewReply } = await import('@/lib/review-reply')
    const out = await postReviewReply(str(pl.reviewId), text)
    const closed = !!out.body.closed
    const problem = out.ok ? '' : str(out.body.message || out.body.error || 'Guesty refused the reply')
    await db.from('eve_actions').update({ status: out.ok ? 'executed' : closed ? 'rejected' : 'failed', decided_by: by, decided_at: nowISO, executed_at: out.ok ? nowISO : null, result: { by, ok: out.ok, done: out.ok ? 'posted the public review reply' : undefined, error: problem || undefined, closed: closed || undefined, edited: text !== str(pl.draft).trim() } }).eq('id', id)
    const { logAgent } = await import('@/lib/eve/agent-mode')
    await logAgent({ action: 'guest_reply_draft', rung: 2, allowed: out.ok, mode: 'act', reason: out.ok ? `review reply posted by ${by} from the draft` : `review reply by ${by} not posted: ${problem}`, summary: out.ok ? `posted a public reply to ${pl.guest || 'a guest'}'s review` : `review reply not posted: ${problem}`, ref: str(pl.reviewId), by: 'chat', actor: by })
    if (out.ok) bustDay()   // reviews to answer are counted in the Command Center's cached day
    if (out.ok) return NextResponse.json({ ok: true, done: 'Posted the review reply' + (out.body.alreadyReplied ? ' (the channel already had one, so it is marked replied)' : '') + (out.body.saveError ? ' — ' + str(out.body.saveError) : '') })
    return NextResponse.json({ ok: false, error: problem, closed: closed || undefined }, { status: closed ? 200 : out.status >= 400 ? out.status : 502 })
  }

  const conversationId = str(pl.conversationId)
  if (!conversationId) return NextResponse.json({ error: 'This draft has no thread and no review to answer.' }, { status: 400 })
  const text = str(body?.body).trim() || str(pl.draft).trim()
  if (!text) return NextResponse.json({ error: 'nothing to send' }, { status: 400 })
  const { runExecutor } = await import('@/lib/eve/executors')
  const { recordAgentAction, afterAct } = await import('@/lib/eve/agent-mode')
  const r = await runExecutor('guest_reply_send', { conversationId, body: text }, { by: 'chat', actor: by, human: true })
  await db.from('eve_actions').update({ status: r.ok ? 'executed' : 'failed', decided_by: by, decided_at: nowISO, executed_at: r.ok ? nowISO : null, result: { by, ok: r.ok, done: r.ok ? r.summary : undefined, error: r.error, edited: text !== str(pl.draft).trim() } }).eq('id', id)
  await recordAgentAction('guest_reply_send', { rung: 2, allowed: r.ok, mode: 'act', reason: r.ok ? `sent by ${by} from the draft` : `send by ${by} failed: ${r.error}`, summary: r.summary, ref: r.ref || id, by: 'chat', actor: by, countAs: r.ok ? 'action' : 'none' })
  // The thread leaves Needs reply now, not at the next guest-comms run (lib/response-times).
  if (r.ok) { try { const { refreshConversationStats } = await import('@/lib/response-times'); await refreshConversationStats(conversationId) } catch { /* the next run catches up */ } }
  if (r.ok) bustDay()   // …and the Command Center's cached day reads the same table
  if (r.ok) await afterAct('guest_reply_send', { ok: true, done: r.summary, ref: r.ref }, { by: str(pl.by || 'chat'), actor: by, summary: r.summary, metric: 'sentiment_negative' })
  // A "fixed" note sent for a glitch parks that glitch in manager_review (lib/glitch-complete).
  if (r.ok) { try { const { glitchIdOfDraft, requestGlitchCompletion } = await import('@/lib/glitch-complete'); const gid = glitchIdOfDraft(pl); if (gid) await requestGlitchCompletion(gid, by, `guest told via Eve's note, sent by ${by.split('@')[0]}`) } catch { /* the send stands */ } }
  return NextResponse.json(r.ok ? { ok: true, done: r.summary } : { ok: false, error: r.error || r.summary }, { status: r.ok ? 200 : 502 })
}
