// CALL NOTES — the transcription + note worker (2026-09-21).
//
// Its own cron rather than a slice of the Talkroute sync, because the two have different shapes:
// the sync is a quick mirror, this walks a queue of audio and can take as long as it is given.
// Every 30 minutes (9 and 39 past; was every 15 until 2026-09-28). Time-boxed and resumable; a
// backlog drains over several passes, newest calls first.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireCron } from '@/lib/cron-auth'
import { talkrouteConfigured } from '@/lib/talkroute'
import { processCallIntel } from '@/lib/call-notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const allowed = await requireCron(req)
  if (!allowed.ok) return allowed.res
  if (!(await talkrouteConfigured())) return NextResponse.json({ ok: true, skipped: 'talkroute not connected' })
  const t0 = Date.now()
  try {
    const r = await processCallIntel(supabaseAdmin(), { deadline: t0 + 100_000, limit: 40 })
    // EVERY GUEST ISSUE BECOMES A GLITCH (Jon, 2026-10-07). The intel this pass just wrote is where
    // a guest's trouble is first written down in plain English — so the watch runs right behind it,
    // while the call is minutes old, rather than waiting for its own half-hour tick. Best effort:
    // a watch failure never costs us the notes this pass already pushed.
    let heard: any = null
    try {
      const { runGuestIssueWatch } = await import('@/lib/guest-issue')
      const { getSetting } = await import('@/lib/app-settings')
      const cfg = await getSetting<any>('guest_issue_watch', null)
      if (!cfg || cfg.on !== false) heard = await runGuestIssueWatch({ hours: 12, by: 'cron:call-notes' })
    } catch (e: any) { heard = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    try {
      await supabaseAdmin().from('automation_runs').insert({ name: 'call-notes', ok: r.errors.length === 0, item_count: r.transcribed + r.notesPushed, detail: r, ms: Date.now() - t0 })
    } catch { /* ledger best-effort */ }
    return NextResponse.json({ ok: true, ...r, guestIssues: heard, ms: Date.now() - t0 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
