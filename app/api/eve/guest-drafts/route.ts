// EVE'S GUEST REPLY DRAFTS (2026-09-21). A guest_reply_draft lands in eve_actions (kind
// 'guest_draft', status 'proposed') — on the thread page and in the Command Center's Decide band
// with Send / Discard. Send is the one path that runs guest_reply_send, and it runs it as a HUMAN
// yes (rung 2, welded): the person who pressed the button is on the receipt.
//
//   GET ?conversation=<id>  → the live draft for one thread (anyone who may see messages)
//   GET                     → every live draft, newest first (Decide band)
//   POST { op: 'send', id, body? }    → send it (edited text allowed), close the row, log with the sender
//   POST { op: 'discard', id, note? } → drop it
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function GET(req: NextRequest) {
  const gate = await requireLevel('messages', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const conv = str(sp.get('conversation')).trim()
  try {
    let q = supabaseAdmin().from('eve_actions').select('id,payload,why,status,created_by,created_at').eq('kind', 'guest_draft').eq('status', 'proposed').order('created_at', { ascending: false }).limit(conv ? 1 : 40)
    if (conv) q = q.filter('payload->>conversationId', 'eq', conv)
    const { data, error } = await q
    if (error) return NextResponse.json({ ok: true, drafts: [] })
    const drafts = ((data as any[]) || []).map(r => ({
      id: str(r.id), conversationId: r.payload?.conversationId || null, reviewId: r.payload?.reviewId || null,
      draft: str(r.payload?.draft), guest: r.payload?.guest || null, unit: r.payload?.unit || null, channel: r.payload?.channel || null,
      why: str(r.why), by: r.payload?.by || r.created_by || 'eve', createdAt: r.created_at,
    }))
    return NextResponse.json({ ok: true, drafts })
  } catch { return NextResponse.json({ ok: true, drafts: [] }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
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

  if (op === 'discard') {
    await db.from('eve_actions').update({ status: 'rejected', decided_by: by, decided_at: nowISO, result: { note: str(body?.note).slice(0, 300) || 'discarded' } }).eq('id', id)
    const { logAgent } = await import('@/lib/eve/agent-mode')
    await logAgent({ action: 'guest_reply_draft', rung: 2, allowed: false, mode: 'observe', reason: `draft discarded by ${by}`, summary: `discarded draft to ${pl.guest || 'guest'}`, ref: id, by: 'chat', actor: by })
    return NextResponse.json({ ok: true })
  }

  const conversationId = str(pl.conversationId)
  if (!conversationId) return NextResponse.json({ error: 'This is a review reply draft — copy it into the reply box on /reviews.' }, { status: 400 })
  const text = str(body?.body).trim() || str(pl.draft).trim()
  if (!text) return NextResponse.json({ error: 'nothing to send' }, { status: 400 })
  const { runExecutor } = await import('@/lib/eve/executors')
  const { recordAgentAction, afterAct } = await import('@/lib/eve/agent-mode')
  const r = await runExecutor('guest_reply_send', { conversationId, body: text }, { by: 'chat', actor: by, human: true })
  await db.from('eve_actions').update({ status: r.ok ? 'executed' : 'failed', decided_by: by, decided_at: nowISO, executed_at: r.ok ? nowISO : null, result: { by, ok: r.ok, done: r.ok ? r.summary : undefined, error: r.error, edited: text !== str(pl.draft).trim() } }).eq('id', id)
  await recordAgentAction('guest_reply_send', { rung: 2, allowed: r.ok, mode: 'act', reason: r.ok ? `sent by ${by} from the draft` : `send by ${by} failed: ${r.error}`, summary: r.summary, ref: r.ref || id, by: 'chat', actor: by, countAs: r.ok ? 'action' : 'none' })
  if (r.ok) await afterAct('guest_reply_send', { ok: true, done: r.summary, ref: r.ref }, { by: str(pl.by || 'chat'), actor: by, summary: r.summary, metric: 'sentiment_negative' })
  return NextResponse.json(r.ok ? { ok: true, done: r.summary } : { ok: false, error: r.error || r.summary }, { status: r.ok ? 200 : 502 })
}
