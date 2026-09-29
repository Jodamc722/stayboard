// REPLY TO A GUEST FROM THE THREAD (2026-09-28 audit, D1). The reply box on /messages/[id].
//
// Airbnb, Booking and VRBO threads — most of the guest traffic — could only be answered by leaving
// the app for Guesty; the one in-app send was an Eve draft. A person now types (or has Eve draft)
// the reply and presses Send, and it goes through exactly the path an Eve draft's Send uses:
// guest_reply_send with human:true (lib/eve/executors), which calls Guesty's send-message on the
// thread's own channel, returns Guesty's message id and the module it went out on as the receipt,
// and mirrors the message into our copy of the thread under this person's name, as a human reply.
// Nothing here sends on its own: every message is one person's press of Send, gated on edit access
// to Messages.
//
// NEVER THE SAME MESSAGE TWICE (2026-09-29 security review, N11). The same text to the same thread
// within two minutes is refused (409 "Already sent"): a double press, or a resend after a timeout
// that had in fact been delivered, reaches the guest twice and cannot be taken back. Three records
// can say it went: the thread (the executor mirrors every confirmed send into guesty_messages, and
// the sync brings Guesty's own copy), Eve's action log (a Send on an Eve draft) and this route's own
// send log — the only one that also remembers a send Guesty never confirmed.
//
// AN UNCONFIRMED SEND IS NOT A FAILED ONE. A timeout, a dropped connection or a 5xx from Guesty may
// still have delivered the message, so the answer then is "Guesty didn't confirm — check the thread
// in Guesty before resending", never "nothing reached the guest". Only a refusal we can be sure of
// (a 4xx, Guesty not configured) says nothing was sent.
//
// ONE LOG ROW PER SEND (lib/activity): who, which conversation, the channel and module, and how it
// ended. Never the message: the row carries a short fingerprint of the text, so a retry can be
// matched without the log ever holding what was said.
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { logActivity } from '@/lib/activity'
import { bustDay } from '@/lib/bust'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

const DUP_WINDOW_MS = 2 * 60_000
const SEND_FEATURE = 'messages:send'
/** The same words, whatever the spacing — what a guest would read as the same message. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const fingerprintOf = (s: string) => createHash('sha256').update(norm(s)).digest('hex').slice(0, 16)
const etTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

/**
 * Did Guesty definitely NOT take the message? Only a 4xx or a check that fails before anything is
 * sent is sure. A timeout, a thrown connection, a 5xx or an error we cannot read may have gone out.
 */
function certainlyNotSent(err: string): boolean {
  const m = err.match(/Guesty send-message (\d{3})\b/)
  if (m) return Number(m[1]) < 500
  return /Guesty is not configured|no conversation id|empty message|conversationId and body required|only runs after a person says yes|welded to propose/i.test(err)
}

type Dup = { at: number; unconfirmed: boolean }

/** The most recent send of this exact text to this thread in the last two minutes, if any. Fails open. */
async function recentSend(db: any, conversationId: string, body: string, fp: string): Promise<Dup | null> {
  const since = new Date(Date.now() - DUP_WINDOW_MS).toISOString()
  const text = norm(body)
  const quoted = ': "' + body.slice(0, 80) + '"'   // how guest_reply_send words its receipt
  const [msgs, agent, sends] = await Promise.all([
    db.from('guesty_messages').select('body,sent_at').eq('conversation_id', conversationId).eq('sender', 'host')
      .gte('sent_at', since).order('sent_at', { ascending: false }).limit(20),
    db.from('eve_agent_log').select('summary,at').eq('action', 'guest_reply_send').eq('allowed', true).eq('ref', conversationId)
      .gte('at', since).order('at', { ascending: false }).limit(20),
    db.from('user_activity').select('at,meta').eq('feature', SEND_FEATURE).filter('meta->>conversationId', 'eq', conversationId)
      .gte('at', since).order('at', { ascending: false }).limit(20),
  ].map((q: any) => Promise.resolve(q).catch(() => ({ data: null }))))
  const hits: Dup[] = []
  const add = (iso: any, unconfirmed: boolean) => { const at = Date.parse(str(iso)); if (Number.isFinite(at)) hits.push({ at, unconfirmed }) }
  for (const m of ((msgs as any)?.data || []) as any[]) if (norm(str(m.body)) === text) add(m.sent_at, false)
  for (const a of ((agent as any)?.data || []) as any[]) if (str(a.summary).indexOf(quoted) >= 0) add(a.at, false)
  for (const s of ((sends as any)?.data || []) as any[]) {
    const meta = (s && typeof s.meta === 'object' && s.meta) || {}
    if (str(meta.fp) !== fp) continue
    if (meta.outcome === 'sent') add(s.at, false)
    else if (meta.outcome === 'unconfirmed') add(s.at, true)
  }
  if (!hits.length) return null
  // A confirmed send outranks an unconfirmed attempt; then the most recent.
  hits.sort((x, y) => Number(x.unconfirmed) - Number(y.unconfirmed) || y.at - x.at)
  return hits[0]
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const actor = str(gate.access.email || 'someone')
  const b = await req.json().catch(() => ({} as any))
  const conversationId = str(b?.conversationId).trim()
  const body = str(b?.body).trim()
  if (!conversationId || !body) return NextResponse.json({ ok: false, error: 'Write the message first.' }, { status: 400 })
  if (body.length > 4000) return NextResponse.json({ ok: false, error: 'That is too long for a guest message (4,000 characters at most).' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: conv, error: cErr } = await db.from('guesty_conversations').select('id,channel').eq('id', conversationId).maybeSingle()
  if (cErr) return NextResponse.json({ ok: false, error: 'Could not read the conversation: ' + cErr.message }, { status: 500 })
  if (!conv) return NextResponse.json({ ok: false, error: 'That conversation is not in Lighthouse — sync, or reply in Guesty.' }, { status: 404 })
  const channel = str((conv as any).channel) || null

  const fp = fingerprintOf(body)
  const dup = await recentSend(db, conversationId, body, fp).catch(() => null)
  if (dup) {
    const ago = Math.max(1, Math.round((Date.now() - dup.at) / 1000))
    const agoText = ago < 60 ? ago + 's ago' : Math.round(ago / 60) + 'm ago'
    return NextResponse.json({
      ok: false, duplicate: true,
      error: dup.unconfirmed
        ? `Already sent ${agoText}, but Guesty didn't confirm it — check the thread in Guesty before resending (the same text can go again after ${etTime(dup.at + DUP_WINDOW_MS)}).`
        : `Already sent — this exact message went to this guest ${agoText}.`,
    }, { status: 409 })
  }

  const logSend = (outcome: 'sent' | 'unconfirmed' | 'refused', module?: string) => logActivity({
    email: str(gate.access.email), kind: 'api', path: '/api/messages/send', feature: SEND_FEATURE, need: 'edit', allowed: true,
    meta: { conversationId, channel, module: module || null, outcome, fp },
  })

  // A PERSON WROTE THIS: the executor files the mirrored message under this name, as not automated,
  // so the thread and the human response time say so until the next sync brings Guesty's own copy.
  const who = str((gate.access.profile as any)?.name || (gate.access.profile as any)?.full_name).trim() || actor.split('@')[0]
  const { runExecutor } = await import('@/lib/eve/executors')
  const r = await runExecutor('guest_reply_send', { conversationId, body }, { by: 'chat', actor, actorName: who, human: true })
  if (!r.ok) {
    const detail = str(r.error || r.summary)
    if (certainlyNotSent(detail)) {
      logSend('refused')
      return NextResponse.json({ ok: false, error: 'Guesty refused it, so nothing reached the guest — ' + (detail || 'no reason given') }, { status: 502 })
    }
    logSend('unconfirmed')
    return NextResponse.json({ ok: false, unconfirmed: true, error: "Guesty didn't confirm — check the thread in Guesty before resending." + (detail ? ' (' + detail.slice(0, 200) + ')' : '') }, { status: 504 })
  }

  // THE RECEIPT. The executor says which Guesty module carried it ("sent to the guest via airbnb2:
  // …"); the reply box shows it, so a message that went out by email instead of inside the OTA
  // thread is visible the moment it happens.
  const via = (str(r.summary).match(/ via ([A-Za-z0-9_.-]+):/) || [])[1] || ''
  const at = new Date().toISOString()
  logSend('sent', via)

  // The thread leaves Needs reply now, not at the next guest-comms run — and the Command Center's
  // cached day (its "waiting" rows read the same table) is rebuilt on its next read.
  try { const { refreshConversationStats } = await import('@/lib/response-times'); await refreshConversationStats(conversationId) } catch { /* the next run catches up */ }
  bustDay()

  return NextResponse.json({ ok: true, module: via, id: r.ref && r.ref !== conversationId ? r.ref : null, at, by: who })
}
