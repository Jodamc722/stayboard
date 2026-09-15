// The standing audit, once a day. Runs the checks and updates the tab. It no longer says anything
// in Slack (Jon, 2026-09-15: "kill those and have a tab in the app").
//
// IT USED TO POST, AND THE RESTRAINT WAS MEANT TO BE THE FEATURE: newly-opened findings only, never
// the whole open list, because an alert that repeats trains people to mute the channel. That was the
// right instinct applied to the wrong medium. This is the app auditing ITSELF — sync freshness,
// unanswered reviews, guests stuck in the pipeline — and none of it is information the field crew in
// #vr-ops can act on. It was pushing app-health noise into the channels where operational
// information lives, which is the same way a channel gets muted, just slower.
//
// So it reports to /system-health, where a finding stays open until somebody deals with it and is
// still there next week if nobody did. That is strictly better than an alert nobody can act on:
// nothing expires, nothing scrolls away, and the count is visible whenever you go looking.
//
// It also drops from hourly to once a day. The checks read sync timestamps, review backlogs and
// pipeline counts — things that move on the scale of days. Twenty-four runs a day to notice a
// thing that changes weekly was never buying anything. Run it by hand from the tab when you have
// just fixed something and want to know whether it took.
import { NextRequest, NextResponse } from 'next/server'
import { runAudit } from '@/lib/eve/audit'
import { eveGate } from '../../agent/route'
import { recordRun } from '@/lib/automation-runs'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }


async function run(req: NextRequest) {
  // AUTH (fixed 2026-08-26). This used to be: bearer-or-a-logged-in-session. With CRON_SECRET
  // unset — which it has always been — Vercel's scheduler had no bearer, failed the session check,
  // and got a 401 on every single run. See lib/cron-auth.ts for the whole story.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const viaCron = !!secret && auth === `Bearer ${secret}`
  const allowed = cronAllowed(req)
  let human = false
  if (!allowed.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!allowed.viaSecret) {
    // No secret configured: a signed-in admin runs it on demand, anyone else gets the scheduled
    // cadence and no more.
    const gate = await eveGate()
    human = gate.ok
    if (!human) {
      const skip = await tooSoon('eve-audit', 45)
      if (skip) return NextResponse.json({ ok: true, ...skip })
    }
  }

  const sp = new URL(req.url).searchParams
  const quiet = sp.get('quiet') === '1'
  const res = await runAudit()

  // NO SLACK. The findings live on /system-health. `posted` stays in the response shape so the
  // automation-runs record and anything reading this endpoint keep the same contract.
  const posted: string | null = null

  recordRun({ name: 'eve-audit', ok: true, itemCount: (res as any)?.open?.length ?? (res as any)?.found ?? undefined, detail: { posted, resolved: (res as any)?.resolved?.length } })
  return NextResponse.json({ ...res, ranBy: viaCron ? 'cron' : 'admin', posted, reportsTo: '/system-health' })
}
