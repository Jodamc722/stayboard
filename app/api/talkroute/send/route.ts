// Send an SMS through Talkroute from a /messages thread. Needs edit on 'messages' (the same gate as
// Eve's guest-reply Send) and a bulk-texting-enabled Talkroute plan; Talkroute's error is passed
// through verbatim when the plan says no. The sent message is mirrored locally at once.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { trSendText, trConversationId, phoneDigits, TalkrouteError } from '@/lib/talkroute'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const body: any = await req.json().catch(() => ({}))
  const text = String(body?.body || '').trim().slice(0, 1600)
  if (!text) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 })
  let conversationId = String(body?.conversationId || '')
  if (!conversationId && body?.to && body?.from) conversationId = trConversationId(String(body.from), String(body.to))
  if (!/^\d{11}-\d{7,15}$/.test(conversationId)) return NextResponse.json({ error: 'No Talkroute conversation for this guest yet.' }, { status: 400 })
  try {
    const m = await trSendText(conversationId, text)
    const sb = supabaseAdmin()
    const [ourNum, theirNum] = conversationId.split('-')
    const at = m?.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString()
    const id = String(m?.id || `local-${Date.now()}`)
    try {
      await sb.from('talkroute_texts').upsert({ id, conversation_id: conversationId, direction: 'outgoing', body: text, user_email: gate.access.email || m?.userEmail || null, read: true, sent_at: at, raw: m, synced_at: at }, { onConflict: 'id' })
      const { data: prev } = await sb.from('talkroute_conversations').select('messages_count').eq('id', conversationId).maybeSingle()
      await sb.from('talkroute_conversations').upsert({ id: conversationId, talkroute_number: phoneDigits(ourNum), contact_number: phoneDigits(theirNum), last_message_at: at, last_message_preview: text.slice(0, 240), last_direction: 'outgoing', unread: false, messages_count: (Number(prev?.messages_count) || 0) + 1, synced_at: at }, { onConflict: 'id' })
    } catch { /* mirror best-effort; the next sync corrects it */ }
    return NextResponse.json({ ok: true, id, at, by: gate.access.email || '' })
  } catch (e: any) {
    const status = e instanceof TalkrouteError ? (e.status === 0 ? 503 : e.status >= 500 ? 502 : e.status) : 502
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status })
  }
}
