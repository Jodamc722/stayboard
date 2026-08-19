// THE MORNING DIGEST — one message that says what today looks like.
//
// Jon, 2026-08-19: "in the future should give them a slack message about there day, what to
// expect, what to know ect. This can be useful for them to get a little brief."
//
// This is the team-wide half of that. It auto-sends (no approval) because it is a summary of
// facts, not a nudge aimed at a person, and because a brief that arrives at lunchtime because
// nobody approved it at 7am is worthless.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
import { NextRequest, NextResponse } from 'next/server'
import { runDigest } from '@/lib/slack-alerts'
import { dispatchApproved } from '@/lib/slack-queue'
import { botConnected } from '@/lib/slack'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!(await botConnected())) return NextResponse.json({ ok: true, skipped: 'Slack bot not connected' })
  const digest = await runDigest().catch((e: any) => ({ error: String(e && e.message) }))
  const dispatched = await dispatchApproved().catch(() => ({ sent: 0, failed: 0 }))
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), digest, dispatched })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
