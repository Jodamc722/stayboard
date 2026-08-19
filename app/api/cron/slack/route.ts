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
// Auth matches the other crons: enforce the bearer token when CRON_SECRET is set, otherwise run
// open so the schedule works without extra configuration.
import { NextRequest, NextResponse } from 'next/server'
import {
  runLateCleanAlert, runGlitchAlert, runOvertimeAlert,
  runRepeatOffenderAlert, runDoorCodeAlert, runBlockedArrivalAlert,
  runMarketBrief, runHandover,
} from '@/lib/slack-alerts'
import { expireStale, dispatchApproved } from '@/lib/slack-queue'
import { botConnected } from '@/lib/slack'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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

  const lateCleans = await safe(runLateCleanAlert())
  const glitches = await safe(runGlitchAlert())
  const overtime = await safe(runOvertimeAlert())
  const repeats = await safe(runRepeatOffenderAlert())
  const doorCodes = await safe(runDoorCodeAlert())
  const blockedArrivals = await safe(runBlockedArrivalAlert())
  const marketBrief = await safe(runMarketBrief())
  const handover = await safe(runHandover())
  const dispatched = await dispatchApproved().catch(() => ({ sent: 0, failed: 0 }))

  return NextResponse.json({
    ok: true, ranAt: new Date().toISOString(), expired,
    lateCleans, glitches, overtime, repeats, doorCodes, blockedArrivals,
    marketBrief, handover, dispatched,
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
