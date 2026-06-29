// Send a host reply into a guest conversation via Guesty's Inbox API.
// POST { conversationId, body }. Replies on the SAME channel the conversation is on
// (module type read from the conversation/last message), then re-syncs the thread locally.
// Logged-in users only — the human writes + sends each message from the app.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncMessages } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Map our simplified channel label (or a raw Guesty module) to a valid send-message module type.
function moduleType(raw: string): string {
  const c = String(raw || '').toLowerCase()
  if (/airbnb/.test(c)) return 'airbnb2'
  if (/homeaway|vrbo/.test(c)) return 'homeaway2'
  if (/booking/.test(c)) return 'bookingCom'
  if (/whatsapp/.test(c)) return 'whatsapp'
  if (/sms/.test(c)) return 'sms'
  if (/email/.test(c)) return 'email'
  // Already a precise Guesty module (airbnb2, homeaway2, bookingCom, etc.)? pass through.
  if (c) return raw
  return 'email'
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { conversationId, body } = await req.json().catch(() => ({} as any))
  const text = typeof body === 'string' ? body.trim() : ''
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Message body is empty.' }, { status: 400 })

  const sb = supabaseAdmin()

  // Figure out which channel/module to reply on: prefer the conversation's last message module,
  // then the conversation channel, then fall back to email.
  let mod = ''
  try {
    const { data: convo } = await sb.from('guesty_conversations').select('channel, raw').eq('id', conversationId).maybeSingle()
    const raw: any = convo?.raw || {}
    mod = raw?.lastMessage?.module || convo?.channel || ''
  } catch { /* fall through */ }
  if (!mod) {
    try {
      const { data: lastMsg } = await sb.from('guesty_messages').select('raw').eq('conversation_id', conversationId).order('sent_at', { ascending: false }).limit(1).maybeSingle()
      mod = (lastMsg?.raw as any)?.module || ''
    } catch { /* ignore */ }
  }
  const type = moduleType(mod)

  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token is refreshing — try again in a moment.' }, { status: 503 })

  const r = await fetch(`${BASE}/communication/conversations/${encodeURIComponent(conversationId)}/send-message`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: { type }, body: text }),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) {
    return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}`, module: type }, { status: 502 })
  }

  // Refresh the thread from Guesty so the new message shows with its real id/timestamp.
  let synced = 0
  try { synced = await syncMessages(conversationId) } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, module: type, synced })
}
