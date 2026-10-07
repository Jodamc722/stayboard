// Eve keeps tabs on Slack — hourly at :48, 00–04 and 11–23 UTC (vercel.json).
//
// Every run reads what came in since the last one (the same cursors; nothing is read twice) and
// sends the day's gentle nudges. The morning roll-up in #vr-eve goes once a day, on a morning run
// (before 14:00 UTC, see GET, and inside lib/eve/slack-watch.ts's 7–10am ET window); on-watch
// gates itself to 11am–7pm ET.
//
// Costs are capped inside runSlackWatch (channels, candidates, model calls per run), so a busy day
// costs a fixed amount and a quiet day costs a Slack read and nothing else.
import { NextRequest, NextResponse } from 'next/server'
import { runSlackWatch, openItems } from '@/lib/eve/slack-watch'
import { runOnWatch } from '@/lib/eve/on-watch'
import { runOpsDesk } from '@/lib/eve/ops-desk'
import { runSchedulerShadow } from '@/lib/eve/scheduler-shadow'
import { sweepLoops } from '@/lib/eve/slack-watch'
import { checkOutcomes } from '@/lib/eve/outcomes'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// VERCEL CRON SENDS GET (2026-09-18). This handler only listed open items, so the scheduled watch
// had never actually run — both entries in vercel.json were no-ops. A scheduler call (the bearer;
// x-vercel-cron is not trusted) now runs the watch; a person's GET still gets the list. Only a run
// before 14:00 UTC (10am EDT) may send the morning digest; later runs pass digest=0.
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
  // ?desk=plan|recap — what the ops desk would post right now, posting nothing.
  const deskPrev = new URL(req.url).searchParams.get('desk')
  if (deskPrev === 'plan' || deskPrev === 'recap') return NextResponse.json(await runOpsDesk({ force: deskPrev, preview: true }))
  // ?morning=preview — the one morning post as it would read now, posting nothing. ?approvals=preview — the digest.
  if (new URL(req.url).searchParams.get('morning') === 'preview') { const { runMorning } = await import('@/lib/eve/morning'); return NextResponse.json(await runMorning({ preview: true })) }
  if (new URL(req.url).searchParams.get('approvals') === 'preview') { const { flushApprovalDigest } = await import('@/lib/eve/slack-approvals'); return NextResponse.json(await flushApprovalDigest({ preview: true })) }
  // ?sweep=1 — expire moot loops and calm stale 'urgent' flags now, reading no Slack.
  if (new URL(req.url).searchParams.get('sweep') === '1') return NextResponse.json(await sweepLoops())
  // ?shadow=1 — run the shadow scheduler's evening pass now (score today, project tomorrow), saving.
  if (new URL(req.url).searchParams.get('shadow') === '1') return NextResponse.json(await runSchedulerShadow({ force: true }))
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
  // ON WATCH (Jon, 2026-09-23). The same cron fires hourly at :48, 00–04 and 11–23 UTC;
  // once the rooms are read, Eve checks what is slipping between Slack, the glitch board and
  // Breezeway and says it in the command rooms. It gates itself to 11am–7pm ET. ?watch=0 skips it.
  // OUTCOMES (2026-09-24). Before she looks at the rooms, she looks at what became of her own
  // actions — the same hourly ride, one cheap query, so her decision log says what is true now
  // rather than what was true when she pressed the button. Never fails the run.
  const o0 = Date.now()
  const outcomes = await checkOutcomes().catch((e: any) => ({ checked: 0, updated: 0, byOutcome: {}, error: String(e?.message || e).slice(0, 160) }))
  if (outcomes.checked || outcomes.error) recordRun({ name: 'eve-outcomes', ok: !outcomes.error, itemCount: outcomes.updated, detail: outcomes, error: outcomes.error || null, ms: Date.now() - o0 })
  // THE ONE MORNING POST and THE APPROVALS DIGEST (Eve audit 2026-10-07). The morning post (7–10am ET,
  // once a day) replaces the roll-up, the ops-desk plan and the empty handoffs; the digest lists every
  // queued proposal as one numbered post. Each in its own try, each with its own receipt.
  let morning: any = null, approvals: any = null
  if (digest) {
    const m0 = Date.now()
    const { runMorning } = await import('@/lib/eve/morning')
    morning = await runMorning().catch((e: any) => ({ posted: false, note: String(e?.message || e).slice(0, 200) }))
    if (morning && !morning.skipped) recordRun({ name: 'eve-morning', ok: morning.posted || morning.mode !== 'act', itemCount: morning.posted ? 1 : 0, detail: { mode: morning.mode, note: morning.note }, error: null, ms: Date.now() - m0 })
  }
  {
    const a0 = Date.now()
    const { flushApprovalDigest } = await import('@/lib/eve/slack-approvals')
    approvals = await flushApprovalDigest().catch((e: any) => ({ posted: 0, waiting: 0, upkeep: 0, error: String(e?.message || e).slice(0, 200) }))
    if (approvals && (approvals.posted || approvals.error)) recordRun({ name: 'eve-approvals-digest', ok: !approvals.error, itemCount: approvals.posted, detail: approvals, error: approvals.error || null, ms: Date.now() - a0 })
  }
  let watch: any = null, opsDesk: any = null, shadow: any = null
  if (url.searchParams.get('watch') !== '0') {
    const w0 = Date.now()
    watch = await runOnWatch({ force: url.searchParams.get('watch') === 'force' }).catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
    // THE OPS DESK rides the same hourly line (Jon, 2026-09-28): 7am plan by person, hourly
    // assignment proposals for unowned work, 6pm recap. Own try; its hours are its own setting.
    opsDesk = await runOpsDesk().catch((e: any) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }))
    // THE SHADOW SCHEDULER (Jon, 2026-09-28): evenings, score today's projection and build
    // tomorrow's. Never assigns. Own try.
    shadow = await runSchedulerShadow().catch((e: any) => ({ ok: false, notes: [String(e?.message || e).slice(0, 200)] }))
    // THE SCHEDULE MANAGER'S EVENING PASS (Jon, 2026-10-01): at 5pm, tomorrow by market — unowned
    // cleans, people off but assigned, people over their own usual day, same-day turns sitting late,
    // the day short, the next three days. Own try, own receipt. lib/eve/schedule-check.ts.
    const sc0 = Date.now()
    const { runScheduleCheck } = await import('@/lib/eve/schedule-check')
    const scheduleCheck = await runScheduleCheck().catch((e: any) => ({ ok: false, date: '', markets: [], posted: 0, notes: [String(e?.message || e).slice(0, 200)] }))
    if (scheduleCheck && !(scheduleCheck as any).skipped) recordRun({ name: 'schedule-check', ok: scheduleCheck.ok !== false, itemCount: scheduleCheck.posted, detail: { date: scheduleCheck.date, posted: scheduleCheck.posted, notes: scheduleCheck.notes, markets: (scheduleCheck.markets || []).map((m: any) => ({ market: m.market, cleans: m.cleans, unassigned: m.unassigned.length, off: m.offButAssigned.length, over: m.overloaded.length, shortMin: m.shortMin })) }, error: scheduleCheck.ok === false ? (scheduleCheck.notes || []).join('; ') : null, ms: Date.now() - sc0 })
    if (shadow && !shadow.skipped) recordRun({ name: 'scheduler-shadow', ok: shadow.ok !== false, itemCount: (shadow.scored ? 1 : 0) + (shadow.projected ? 1 : 0), detail: shadow, error: shadow.ok === false ? (shadow.notes || []).join('; ') : null, ms: Date.now() - w0 })
    if (opsDesk && !opsDesk.skipped) recordRun({ name: 'ops-desk', ok: opsDesk.ok !== false, itemCount: (opsDesk.proposedAssign || 0) + (opsDesk.plan ? 1 : 0) + (opsDesk.recap ? 1 : 0), detail: opsDesk, error: opsDesk.error || null, ms: Date.now() - w0 })
    if (watch && !watch.skipped) recordRun({ name: 'on-watch', ok: watch.ok !== false, itemCount: Object.values(watch.posted || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) + (watch.resolved || 0), detail: watch, error: watch.error || null, ms: Date.now() - w0 })
  }
  return NextResponse.json({ ...res, outcomes, morning, approvals, watch, opsDesk, shadow }, { status: res.ok ? 200 : 500 })
}
