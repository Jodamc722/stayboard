// GUESTY → LIGHTHOUSE, THE MOMENT A GUEST WRITES (lib/guesty-webhooks). Guesty POSTs reservation.messageReceived /
// reservation.messageSent here. The URL token is required; the Svix signature is checked whenever the secret is on
// file. The payload only says WHICH conversation moved — its words are re-read from Guesty's API, the same read the
// poll does — then whoever should know is told (the person who took the thread, and anyone who turned on
// "Alert me" in the inbox).
//
// Reachable signed-out: every /api/ path skips the login redirect; this route does its own checks. It answers 200
// to anything it accepted, even when the re-read fails (Guesty retries non-2xx with backoff, and the poll and the
// cron backfill anyway).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { safeEqual } from '@/lib/signing'
import { readWebhookSettings, verifySvix, noteEvent } from '@/lib/guesty-webhooks'
import { syncMessages, syncConversationById, guestyGet } from '@/lib/guesty'
import { readInboxState } from '@/lib/inbox-state'
import { notify } from '@/lib/notify'
import { plainText } from '@/lib/message-text'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Svix ids we already handled on this instance — a redelivery is a no-op. */
const seen = new Map<string, number>()

async function conversationFor(body: any): Promise<string> {
  const c = body?.conversation
  const direct = String(c?._id || c?.id || body?.conversationId || '')
  if (direct) return direct
  const resId = String(body?.reservationId || body?.message?.reservationId || '')
  if (!resId) return ''
  const { data } = await supabaseAdmin().from('guesty_conversations').select('id').eq('reservation_id', resId).order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  if (data?.id) return String(data.id)
  // An inquiry's first message can arrive before we have its thread: ask Guesty for the booking's conversation.
  try { const r = await guestyGet<any>(`/reservations/${encodeURIComponent(resId)}?fields=conversationId`); return String(r?.conversationId || r?.data?.conversationId || '') } catch { return '' }
}

/** Who hears about a new guest message: the thread's owner, plus everyone who switched on "Alert me". */
async function recipientsFor(conversationId: string): Promise<string[]> {
  const out = new Set<string>()
  try { const st = await readInboxState(); const a = String(st['g:' + conversationId]?.assignee || '').toLowerCase(); if (a) out.add(a) } catch { /* none */ }
  try {
    const { data } = await supabaseAdmin().from('app_users').select('email, prefs').limit(500)
    for (const u of (data || []) as any[]) if (u?.prefs && u.prefs.guest_alerts === true && u.email) out.add(String(u.email).toLowerCase())
  } catch { /* none */ }
  return Array.from(out)
}

export async function POST(req: NextRequest) {
  const s = await readWebhookSettings()
  const t = req.nextUrl.searchParams.get('t') || ''
  if (!s.token || !safeEqual(t, String(s.token))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const raw = await req.text()
  if (s.secret && (req.headers.get('svix-signature') || req.headers.get('webhook-signature'))) {
    if (!verifySvix(String(s.secret), req.headers, raw)) return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }
  const sid = req.headers.get('svix-id') || req.headers.get('webhook-id') || ''
  if (sid) {
    if (seen.has(sid)) return NextResponse.json({ ok: true, duplicate: true })
    seen.set(sid, Date.now()); if (seen.size > 2000) seen.clear()
  }
  let body: any = {}
  try { body = JSON.parse(raw) } catch { /* empty */ }
  const event = String(body?.event || req.headers.get('x-guesty-event') || '')
  noteEvent(event || 'message').catch(() => {})
  try {
    const convId = await conversationFor(body)
    if (!convId) return NextResponse.json({ ok: true, skipped: 'no conversation' })
    await Promise.all([syncMessages(convId), syncConversationById(convId).catch(() => false)])
    // A guest wrote: tell whoever should know. Our own replies and Guesty's templates tell no one.
    const fromGuest = /messageReceived/i.test(event) && /guest/i.test(String(body?.message?.type || 'fromGuest')) && !/owner/i.test(String(body?.conversation?.conversationWith || ''))
    if (fromGuest) {
      const who = await recipientsFor(convId)
      if (who.length) {
        const { data: c } = await supabaseAdmin().from('guesty_conversations').select('guest_name, listing_id').eq('id', convId).maybeSingle()
        let unit = ''
        if (c?.listing_id) { const { data: l } = await supabaseAdmin().from('guesty_listings').select('nickname').eq('id', c.listing_id).maybeSingle(); unit = String(l?.nickname || '') }
        const text = plainText(String(body?.message?.body || '')).replace(/\s+/g, ' ').trim()
        await notify(who, {
          kind: 'guest_message', title: `${String(c?.guest_name || 'A guest')}${unit ? ' · ' + unit : ''} wrote`, body: text ? text.slice(0, 220) : 'New message',
          link: '/inbox?open=' + encodeURIComponent('g:' + convId), entity: { type: 'guest_conversation', id: convId },
        })
      }
    }
    return NextResponse.json({ ok: true, conversation: convId })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) })
  }
}

export async function GET() { return NextResponse.json({ ok: true, receiver: 'guesty-messages' }) }
