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
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

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
  const { data: conv, error: cErr } = await db.from('guesty_conversations').select('id').eq('id', conversationId).maybeSingle()
  if (cErr) return NextResponse.json({ ok: false, error: 'Could not read the conversation: ' + cErr.message }, { status: 500 })
  if (!conv) return NextResponse.json({ ok: false, error: 'That conversation is not in Lighthouse — sync, or reply in Guesty.' }, { status: 404 })

  // A PERSON WROTE THIS: the executor files the mirrored message under this name, as not automated,
  // so the thread and the human response time say so until the next sync brings Guesty's own copy.
  const who = str((gate.access.profile as any)?.name || (gate.access.profile as any)?.full_name).trim() || actor.split('@')[0]
  const { runExecutor } = await import('@/lib/eve/executors')
  const r = await runExecutor('guest_reply_send', { conversationId, body }, { by: 'chat', actor, actorName: who, human: true })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error || r.summary || 'Guesty did not send the message.' }, { status: 502 })

  // THE RECEIPT. The executor says which Guesty module carried it ("sent to the guest via airbnb2:
  // …"); the reply box shows it, so a message that went out by email instead of inside the OTA
  // thread is visible the moment it happens.
  const via = (str(r.summary).match(/ via ([A-Za-z0-9_.-]+):/) || [])[1] || ''
  const at = new Date().toISOString()

  // The thread leaves Needs reply now, not at the next guest-comms run.
  try { const { refreshConversationStats } = await import('@/lib/response-times'); await refreshConversationStats(conversationId) } catch { /* the next run catches up */ }

  return NextResponse.json({ ok: true, module: via, id: r.ref && r.ref !== conversationId ? r.ref : null, at, by: who })
}
