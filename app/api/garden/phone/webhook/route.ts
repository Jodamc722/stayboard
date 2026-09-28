// GARDEN HOTEL PHONE WEBHOOK — any phone system that can POST JSON lands here.
//   POST ?token=<garden_phone.webhookToken>
//   body: one call or { calls: [...] }, each { id, direction, from, to, startedAt, durationSec, result?, recordingUrl?, transcript? }
// No session: the token is the auth. Unknown fields are kept in raw.
import { NextRequest, NextResponse } from 'next/server'
import { getPhone } from '@/lib/garden/settings'
import { ingestCalls, type PhoneCall } from '@/lib/garden/phone'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cfg = await getPhone()
  const token = req.nextUrl.searchParams.get('token') || req.headers.get('x-garden-token') || ''
  if (!cfg.webhookToken || token !== cfg.webhookToken) return NextResponse.json({ error: 'bad token' }, { status: 401 })
  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ error: 'json body required' }, { status: 400 })
  const list: any[] = Array.isArray(b?.calls) ? b.calls : [b]
  const calls: PhoneCall[] = list.filter(c => c && (c.id || c.startedAt)).map(c => ({
    id: `webhook:${String(c.id || `${c.from || ''}-${c.startedAt || Date.now()}`)}`, provider: 'webhook',
    direction: /in/i.test(String(c.direction || '')) ? 'inbound' : 'outbound', from: c.from ? String(c.from) : null, to: c.to ? String(c.to) : null,
    startedAt: c.startedAt && !isNaN(Date.parse(c.startedAt)) ? new Date(c.startedAt).toISOString() : new Date().toISOString(),
    durationSec: Number(c.durationSec ?? c.duration) || 0, result: /voicemail/i.test(String(c.result || '')) ? 'voicemail' : /miss|no.?answer|busy|fail/i.test(String(c.result || '')) ? 'missed' : (Number(c.durationSec ?? c.duration) || 0) > 0 ? 'answered' : 'missed',
    recordingUrl: c.recordingUrl || null, transcript: c.transcript || null, raw: c,
  }))
  const r = await ingestCalls(calls, cfg)
  return NextResponse.json({ ok: true, received: calls.length, ...r })
}
