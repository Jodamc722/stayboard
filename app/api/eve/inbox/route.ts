// THE ONE INBOX (2026-11-10) — everything Eve needs from a person, one ranked list. lib/eve/inbox.ts.
//
//   GET  ?kind=approve|review_draft|loop|answer|plan|note|decide   one kind only ('decide' = her
//        thoughts, never in the main list) · ?limit=N (default 50) · ?offset=N · ?fresh=1 hides
//        out-of-date rows
//        → { summary: { total, counts, stale }, items, total, partial }
//   POST { id: '<kind>:<rowid>', action, note?, text?, dupes? }
//        Dispatches to the decide logic the old route for that kind runs, behind THAT route's gate:
//          approve       approve | reject           requireAdmin('admin') → executeProposal / rejectProposal (agent route)
//          review_draft  send | discard              requireAnyLevel(messages|reviews, edit) → decideGuestDraft (guest-drafts route)
//          loop          close | dismiss             requireLevel('loops','edit') → closeLoopItem (loops route)
//          answer        answer | dismiss            eveGate + VR → answerQuestion / dismissQuestion (questions route)
//          plan          accept | reject             eveGate + VR → decideRecommendation (recommendations route)
//          note (exp-)   done | dismiss              eveGate + the expectations edit rule → setExpectationStatus
//          note (audit-) ack | snooze                eveGate + VR → decideAudit (audits route)
//          decide        do | dismiss | ask_next_time  requireVrAdmin('admin') → doThought / dismissThought / askNextTime
//        `dupes` (approve only): the older copies of the same proposal, declined after a decision —
//        what the Needs you tab did from the browser, one call each, behind the same admin gate.
import { NextRequest, NextResponse } from 'next/server'
import { requireUser, requireAdmin, requireLevel, requireAnyLevel } from '@/lib/access'
import { isVrLogin, hotelOnlyRes, requireVrAdmin } from '@/lib/vr-gate'
import { eveGate } from '../../agent/route'
import { loadInbox, viewerOf, parseInboxId, KIND_ACTIONS, INBOX_KINDS, decideGuestDraft, closeLoopItem, canEditExpectations, type InboxKind } from '@/lib/eve/inbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET(req: NextRequest) {
  const g = await requireUser()
  if (!g.ok) return g.res
  const v = viewerOf(g.access)
  if (!v.eveAny && !v.loopsView && !v.msgsView && !v.reviewsView) {
    return NextResponse.json({ error: 'forbidden', message: 'Nothing in Eve\'s inbox is open to your role.' }, { status: 403 })
  }
  const sp = new URL(req.url).searchParams
  const k = str(sp.get('kind')).trim()
  const kind = (INBOX_KINDS as string[]).includes(k) ? (k as InboxKind) : null
  if (k && !kind) return NextResponse.json({ error: 'kind must be one of ' + INBOX_KINDS.join(', ') }, { status: 400 })
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50))
  const offset = Math.max(0, Number(sp.get('offset')) || 0)
  const r = await loadInbox(v, { kind, includeStale: !sp.get('fresh') })
  return NextResponse.json({
    ok: true, summary: r.summary, partial: r.partial, total: r.total, offset, limit,
    items: r.items.slice(offset, offset + limit),
    viewer: { admin: v.admin, loopsEdit: v.loopsEdit, thoughts: v.vrAdmin },
  })
}

const reply = (r: any, okStatus = 200, badStatus = 400) => NextResponse.json(r, { status: r && r.ok ? okStatus : badStatus })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const parsed = parseInboxId(str(body?.id))
  if (!parsed) return NextResponse.json({ error: 'id must be <kind>:<rowid>' }, { status: 400 })
  const { kind, rowId } = parsed
  const action = str(body?.action)
  if (!KIND_ACTIONS[kind].includes(action)) return NextResponse.json({ error: `action for ${kind} must be one of ${KIND_ACTIONS[kind].join(', ')}` }, { status: 400 })
  const note = body?.note != null && str(body.note).trim() ? str(body.note) : undefined
  const text = str(body?.text ?? body?.answer ?? body?.body)

  if (kind === 'approve') {
    // /api/eve/agent POST approve | reject — the same gate, the same two functions.
    const gate = await requireAdmin('admin')
    if (!gate.ok) return gate.res
    const by = String(gate.access.email || 'admin')
    const { executeProposal, rejectProposal } = await import('@/lib/eve/agent-mode')
    const r: any = action === 'approve' ? await executeProposal(rowId, by) : await rejectProposal(rowId, by, note)
    if (r.ok && Array.isArray(body?.dupes)) {
      // The older copies of the same proposal are superseded either way — declined quietly.
      for (const d of (body.dupes as any[]).map(str).filter(x => x && x !== rowId).slice(0, 25)) {
        try { await rejectProposal(d, by) } catch { /* fine */ }
      }
    }
    return reply(r)
  }

  if (kind === 'review_draft') {
    const gate = await requireAnyLevel(['messages', 'reviews'], 'edit')
    if (!gate.ok) return gate.res
    const by = str(gate.access.email || 'someone')
    const r = await decideGuestDraft({ id: rowId, op: action === 'send' ? 'send' : 'discard', body: text, note, by, levels: gate.access.levels })
    return NextResponse.json(r.json, { status: r.status })
  }

  if (kind === 'loop') {
    const gate = await requireLevel('loops', 'edit')
    if (!gate.ok) return gate.res
    const by = gate.access.email || 'someone'
    const r = await closeLoopItem(rowId, action === 'close' ? 'close' : 'dismiss', by, note)
    return NextResponse.json(r.json, { status: r.status })
  }

  if (kind === 'answer') {
    const gate = await eveGate()
    if (!gate.ok) return gate.res
    if (!isVrLogin(gate.access)) return hotelOnlyRes()
    const by = String(gate.access.email || 'unknown')
    const { answerQuestion, dismissQuestion } = await import('@/lib/eve/questions')
    const r = action === 'answer' ? await answerQuestion(rowId, text, by) : await dismissQuestion(rowId, by)
    return reply(r)
  }

  if (kind === 'plan') {
    const gate = await eveGate()
    if (!gate.ok) return gate.res
    if (!isVrLogin(gate.access)) return hotelOnlyRes()
    const actor = String(gate.access.email || '')
    const { decideRecommendation } = await import('@/lib/eve/recommendations')
    const r = await decideRecommendation(rowId, action === 'accept' ? 'accepted' : 'rejected', actor, note)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (kind === 'note') {
    const gate = await eveGate()
    if (!gate.ok) return gate.res
    const by = String(gate.access.email || 'unknown')
    if (rowId.startsWith('exp-')) {
      if (action !== 'done' && action !== 'dismiss') return NextResponse.json({ error: 'an expectation note takes done or dismiss' }, { status: 400 })
      if (!canEditExpectations(gate.access)) return NextResponse.json({ ok: false, error: 'edit access to Eve is needed' }, { status: 403 })
      const { setExpectationStatus } = await import('@/lib/eve/expectations')
      const r = await setExpectationStatus(rowId.slice(4), action === 'done' ? 'done' : 'dismissed', by, note)
      return reply(r)
    }
    if (rowId.startsWith('audit-')) {
      if (action !== 'ack' && action !== 'snooze') return NextResponse.json({ error: 'an audit finding takes ack or snooze' }, { status: 400 })
      if (!isVrLogin(gate.access)) return hotelOnlyRes()
      const { decideAudit } = await import('@/lib/eve/audit')
      const r = await decideAudit(rowId.slice(6), action as 'ack' | 'snooze', by, 7)
      return reply(r)
    }
    return NextResponse.json({ error: 'unknown note' }, { status: 400 })
  }

  // kind === 'decide' — her thoughts. /api/eve/thoughts POST, the same gate.
  const gate = await requireVrAdmin('admin')
  if (!gate.ok) return gate.res
  const by = str(gate.access.email).toLowerCase() || 'admin'
  const { doThought, dismissThought, askNextTime } = await import('@/lib/eve/thoughts')
  const r = action === 'do' ? await doThought(rowId, by) : action === 'dismiss' ? await dismissThought(rowId, by, note) : await askNextTime(rowId, by)
  return reply(r)
}
