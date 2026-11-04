// GARDEN INBOX INGEST — any forwarder (an email-forwarding service, Zapier, the phone system's SMS
// hook) pushes guest messages into the hotel's unified inbox here. Cloudbeds has no messaging API,
// so this is how guest email / SMS / WhatsApp / OTA messages reach Lighthouse.
//
//   POST /api/garden/inbox/ingest
//   Header  X-Garden-Token: <app_settings 'garden_inbox_token'>   (or ?token= for forwarders that cannot set headers)
//   Body    one message, an array of them, or { messages: [...] }. Each:
//           { id, threadId?, from, to?, guest?, email?, phone?, channel?, source, subject?, body, sentAt, direction?, reservationId? }
//   Reply   { ok, received, stored, duplicates, matched, errors, threads }
//
// No session: the token is the auth. The token is shown to editors on /garden/messages.
import { NextRequest, NextResponse } from 'next/server'
import { checkInboxToken, ingestInbound } from '@/lib/garden/inbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-garden-token') || req.nextUrl.searchParams.get('token') || ''
  if (!(await checkInboxToken(token))) return NextResponse.json({ ok: false, error: 'bad token' }, { status: 401 })
  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 })
  const list: any[] = Array.isArray(b) ? b : Array.isArray(b?.messages) ? b.messages : [b]
  if (list.length > 500) return NextResponse.json({ ok: false, error: 'At most 500 messages per call.' }, { status: 413 })
  try {
    const r = await ingestInbound(list)
    return NextResponse.json({ ok: true, ...r }, { status: r.stored || r.duplicates || !r.errors.length ? 200 : 400 })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }) }
}

export async function GET() {
  return NextResponse.json({ ok: true, how: 'POST JSON here with header X-Garden-Token. Body: one message, an array, or { messages: [...] }; each { id, threadId?, from, to?, guest?, email?, phone?, channel?, source, subject?, body, sentAt, direction?, reservationId? }.' })
}
