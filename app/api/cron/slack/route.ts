// THE SLACK HEARTBEAT — runs the alert engines, then flushes the outbox.
//
// Order matters. Expiring first means an item nobody approved in time is dropped before we would
// otherwise send it; dispatching last means anything Jon approved from a DM in the last half hour
// goes out on this pass rather than waiting for the next one.
//
// The alert engines themselves are cheap when nothing is wrong: each one loads its situation,
// finds nothing worth saying, and returns a skip. A quiet day produces zero Slack messages.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import {
  runLateCleanAlert, runGlitchAlert, runOvertimeAlert,
  runRepeatOffenderAlert, runDoorCodeAlert, runBlockedArrivalAlert,
  runMarketBrief, runHandover, runWalkInRiskAlert,
  runReadinessCheck, runLaborReport, runNotableArrivals,
} from '@/lib/slack-alerts'
import { expireStale, dispatchApproved } from '@/lib/slack-queue'
import { botConnected } from '@/lib/slack'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res

  const expired = await expireStale().catch(() => 0)

  // Without a bot token there is nothing to post with. Still expire and report, so the Command
  // Center does not fill up with drafts that can never go anywhere.
  if (!(await botConnected())) {
    return NextResponse.json({ ok: true, expired, skipped: 'Slack bot not connected', hint: 'Connect Slack from the Command Center, then set the rules in /users.' })
  }

  // Every engine runs on every pass, but each one's own rule decides whether it may speak: quiet
  // hours keep the market brief to the morning and the handover to the evening, and the cooldown
  // keeps both to once a day. That is why there is one cron here rather than five.
  const safe = (p: Promise<any>) => p.catch((e: any) => ({ error: String((e && e.message) || e) }))

  // The two Jon actually asked for. Their own windows keep them to 3pm and 5pm — everything else
  // below ships disabled and only runs if someone turns it on in /users.
  const readiness = await safe(runReadinessCheck())
  const labor = await safe(runLaborReport())
  const notable = await safe(runNotableArrivals())
  const walkIn = await safe(runWalkInRiskAlert())
  const lateCleans = await safe(runLateCleanAlert())
  const glitches = await safe(runGlitchAlert())
  const overtime = await safe(runOvertimeAlert())
  const repeats = await safe(runRepeatOffenderAlert())
  const doorCodes = await safe(runDoorCodeAlert())
  const blockedArrivals = await safe(runBlockedArrivalAlert())
  const marketBrief = await safe(runMarketBrief())
  const handover = await safe(runHandover())
  // An outbox crash is NOT "nothing to send" (2026-09-28 audit #23) — it is reported as such.
  const dispatched: { sent: number; failed: number; error?: string } =
    await dispatchApproved().catch((e: any) => ({ sent: 0, failed: 0, error: String((e && e.message) || e).slice(0, 200) }))

  // HONEST OK: false when the outbox crashed or any engine errored, naming which.
  const engines: Record<string, any> = { readiness, labor, notable, walkIn, lateCleans, glitches, overtime, repeats, doorCodes, blockedArrivals, marketBrief, handover }
  const errors = Object.keys(engines)
    .filter(k => engines[k] && typeof engines[k] === 'object' && engines[k].error)
    .map(k => k + ': ' + String(engines[k].error).slice(0, 120))
  if (dispatched.error) errors.unshift('dispatch: ' + dispatched.error)

  return NextResponse.json({
    ok: errors.length === 0, ranAt: new Date().toISOString(), expired,
    readiness, labor, notable, walkIn, lateCleans, glitches, overtime, repeats, doorCodes, blockedArrivals,
    marketBrief, handover, dispatched,
    ...(errors.length ? { error: errors.join('; ').slice(0, 480) } : {}),
  })
}

// RECEIPT (2026-09-28): the registry has always said this job writes one; it never did. Named by
// its registry key (lib/eve/automations.ts 'slack-alerts'), counting messages dispatched.
const receipted = withRouteReceipt<NextRequest>('slack-alerts', run, { count: (b) => (b.dispatched && typeof b.dispatched.sent === 'number' ? b.dispatched.sent : undefined) })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
