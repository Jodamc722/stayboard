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
import { runOnWatch } from '@/lib/eve/on-watch'
import { checkOutcomes } from '@/lib/eve/outcomes'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// VERCEL CRON SENDS GET (2026-09-18). This handler only listed open items, so the scheduled watch
// had never actually run — both entries in vercel.json were no-ops. A scheduler call (x-vercel-cron
// or the bearer) now runs the watch; a person's GET still gets the list. The afternoon run skips
// the digest: before 14:00 UTC (10am ET) it is the morning pass, after that the midday one.
export async function GET(req: NextRequest) {
  const scheduled = cronAllowed(req).viaSecret
  if (scheduled) {
    const digest = new Date().getUTCHours() < 14
    const url = new URL(req.url); url.searchParams.set('digest', digest ? '1' : '0')
    return POST(new NextRequest(url, { headers: req.headers }))
  }
  // The open-items list names staff and quotes guest threads: signed-in Eve admins only. It
  // answered anonymous GETs until 2026-09-18.
  const gate = await eveGate()
  if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // ?watch=preview — what the next on-watch pass would say, posting nothing and saving nothing.
  if (new URL(req.url).searchParams.get('watch') === 'preview') return NextResponse.json(await runOnWatch({ preview: true }))
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
  // ON WATCH (Jon, 2026-09-23). The same cron now fires hourly 15–23 UTC as well as the 5am pass;
  // once the rooms are read, Eve checks what is slipping between Slack, the glitch board and
  // Breezeway and says it in the command rooms. It gates itself to 11am–7pm ET. ?watch=0 skips it.
  // OUTCOMES (2026-09-24). Before she looks at the rooms, she looks at what became of her own
  // actions — the same hourly ride, one cheap query, so her decision log says what is true now
  // rather than what was true when she pressed the button. Never fails the run.
  const o0 = Date.now()
  const outcomes = await checkOutcomes().catch((e: any) => ({ checked: 0, updated: 0, byOutcome: {}, error: String(e?.message || e).slice(0, 160) }))
  if (outcomes.checked || outcomes.error) recordRun({ name: 'eve-outcomes', ok: !outcomes.error, itemCount: outcomes.updated, detail: outcomes, error: outcomes.error || null, ms: Date.now() - o0 })
  let watch: any = null
  if (url.searchParams.get('watch') !== '0') {
    const w0 = Date.now()
    watch = await runOnWatch({ force: url.searchParams.get('watch') === 'force' }).catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
    if (watch && !watch.skipped) recordRun({ name: 'on-watch', ok: watch.ok !== false, itemCount: Object.values(watch.posted || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) + (watch.resolved || 0), detail: watch, error: watch.error || null, ms: Date.now() - w0 })
  }
  return NextResponse.json({ ...res, outcomes, watch }, { status: res.ok ? 200 : 500 })
}
