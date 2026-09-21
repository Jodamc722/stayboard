// CALL NOTES — the transcription + note worker (2026-09-21).
//
// Its own cron rather than a slice of the Talkroute sync, because the two have different shapes:
// the sync is a quick mirror every 15 minutes, this walks a queue of audio and can take as long as
// it is given. Time-boxed and resumable; a backlog drains over several passes, newest calls first.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cronAllowed } from '@/lib/cron-auth'
import { talkrouteConfigured } from '@/lib/talkroute'
import { processCallIntel } from '@/lib/call-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const allowed = cronAllowed(req)
  if (!allowed.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await talkrouteConfigured())) return NextResponse.json({ ok: true, skipped: 'talkroute not connected' })
  const t0 = Date.now()
  try {
    const r = await processCallIntel(supabaseAdmin(), { deadline: t0 + 100_000, limit: 40 })
    try {
      await supabaseAdmin().from('automation_runs').insert({ name: 'call-notes', ok: r.errors.length === 0, item_count: r.transcribed + r.notesPushed, detail: r, ms: Date.now() - t0 })
    } catch { /* ledger best-effort */ }
    return NextResponse.json({ ok: true, ...r, ms: Date.now() - t0 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
