// Eve keeps tabs on Slack — twice a day.
//
// The MORNING run (before the team starts) reads everything since yesterday, posts the roll-up in
// #vr-eve and sends the day's gentle nudges. The MIDDAY run reads what came in since, so a problem
// raised at 10am that affects a 4pm check-in gets said at lunchtime, not tomorrow. Both use the
// same cursors; nothing is read twice.
//
// Costs are capped inside runSlackWatch (channels, candidates, model calls per run), so a busy day
// costs a fixed amount and a quiet day costs a Slack read and nothing else.
import { NextRequest, NextResponse } from 'next/server'
import { runSlackWatch, openItems } from '@/lib/eve/slack-watch'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const items = await openItems(100).catch(() => [])
  return NextResponse.json({ ok: true, open: items.length, items })
}

export async function POST(req: NextRequest) {
  // Two ways in: Vercel's scheduler with the bearer, or a signed-in Eve admin pressing "run now".
  // With CRON_SECRET set, cronAllowed refuses everything else outright — which is correct for a job
  // that spends money, and also means there was no way for Jon to run it by hand. So an admin
  // session is the second key, throttled the same way so a double-click cannot run it twice.
  const allowed = cronAllowed(req)
  if (!allowed.ok) {
    const gate = await eveGate()
    if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!allowed.viaSecret) {
    const skip = await tooSoon('slack-watch', 20)
    if (skip) return NextResponse.json({ ok: true, ...skip })
  }
  const url = new URL(req.url)
  // Morning is whichever run first sees a new ET date; the digest guard inside makes it once a day.
  const digest = url.searchParams.get('digest') !== '0'
  const nudge = url.searchParams.get('nudge') !== '0'
  const started = Date.now()
  const res = await runSlackWatch({ digest, nudge })
  recordRun({ name: 'slack-watch', ok: res.ok, itemCount: res.opened + res.closed + res.nudged, detail: res, error: res.error || null, ms: Date.now() - started })
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}
