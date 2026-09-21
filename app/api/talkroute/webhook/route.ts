// TALKROUTE WEBHOOK RECEIVER. Talkroute POSTs new_call_record / call_completed / new_text_message /
// new_voicemail here. It signs nothing, so the URL carries a random token (registered by the admin
// panel) and a request without it is dropped.
//
// The payload is NOT trusted: it has no ids, only numbers and a result. Each event just kicks the
// matching feed's sync, which re-reads the last hour of records from the API by id — the same code
// the cron runs — so a replayed or forged POST can at worst cause a harmless re-sync.
//
// Reachable signed-out: middleware.ts excludes every /api/ path from the login redirect, and this
// route does its own token check instead.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTalkrouteSettings } from '@/lib/talkroute'
import { syncTalkrouteCalls, syncTalkrouteTexts, syncTalkrouteVoicemails } from '@/lib/talkroute-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const s = await getTalkrouteSettings()
  const t = req.nextUrl.searchParams.get('t') || ''
  if (!s.webhookToken || t !== s.webhookToken) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body: any = await req.json().catch(() => ({}))
  const type = String(req.nextUrl.searchParams.get('type') || body?.type || body?.event || '').toLowerCase()
  const sb = supabaseAdmin()
  const since = new Date(Date.now() - 2 * 3600_000).toISOString()
  try {
    let r: any
    if (type.indexOf('text') >= 0 || (body?.body != null && body?.from_number)) r = await syncTalkrouteTexts(sb, { since })
    else if (type.indexOf('voicemail') >= 0) r = await syncTalkrouteVoicemails(sb)
    else r = await syncTalkrouteCalls(sb, { since })
    return NextResponse.json({ ok: true, type: type || 'call', ...r })
  } catch (e: any) {
    // 200 anyway: Talkroute retries on non-2xx and a stuck retry loop helps nobody; the cron backfills.
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) })
  }
}

export async function GET() { return NextResponse.json({ ok: true, receiver: 'talkroute' }) }
