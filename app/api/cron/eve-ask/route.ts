// THE MORNING ASK — one interruption a day, at an hour a person is awake.
//
// Everything Eve wanted to ask has been piling up in two tables that nobody opens: `eve_questions`
// (what she cannot derive and needs a person to tell her) and `eve_audits` (what is broken right
// now, each with the fix). This is the route that finally sends the top few to a human on Telegram
// and lets the reply come back as an answer.
//
// WHY ITS OWN CRON RATHER THAN A TAIL ON /api/eve/learn. The learning pass runs at 01:47 ET, which
// is the right time to think and the wrong time to text somebody. Splitting them means the thinking
// can stay nocturnal and cheap while the asking happens at 09:00 ET, when an answer is plausible.
//
// GET ?preview=1  → build the batch and send nothing. For checking what she WOULD ask.
// GET ?force=1    → send one item now, ignoring the daily budget. Signed-in humans only.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { runMorningAsk, buildBatch, expireStaleAsks, askSettings, recipients } from '@/lib/eve/ask'
import { expireUnanswered } from '@/lib/eve/ralph'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function signedIn(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const allowed = cronAllowed(req)
  if (!allowed.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const preview = url.searchParams.get('preview') === '1'
  const force = url.searchParams.get('force') === '1'
  const human = await signedIn()

  // Costs nothing and sends nothing: anyone allowed this far may look.
  if (preview) {
    const s = await askSettings()
    const to = await recipients()
    const batch = await buildBatch(Math.max(s.maxPerDay, 5))
    return NextResponse.json({
      ok: true, preview: true, settings: s,
      recipients: to.map(r => r.email),
      would_ask: batch.map(b => ({ type: b.type, title: b.title, rank: b.rank, body: b.body })),
    })
  }

  // Forcing past the budget is a human action, not something an unauthenticated caller may do.
  if (force && !allowed.viaSecret && !human) {
    return NextResponse.json({ error: 'sign in to force an ask' }, { status: 401 })
  }

  // Without CRON_SECRET this route is open (see lib/cron-auth.ts), so the run ledger is what stops
  // a refresh-happy browser turning into six messages before breakfast.
  if (!allowed.viaSecret && !force) {
    const skip = await tooSoon('eve-ask', 12 * 60)
    if (skip) return NextResponse.json({ ok: true, ...skip })
  }

  const expired = await expireStaleAsks()
  // A question Ralphbot never answered stops being one after two days, so the reply-matching window
  // cannot drift onto a question from last week.
  const ralphExpired = await expireUnanswered(48).catch(() => 0)
  const run = await runMorningAsk({ force })

  await recordRun({
    name: 'eve-ask',
    ok: run.ok,
    itemCount: run.sent,
    detail: run.skipped ? { skipped: run.skipped, expired, ralphExpired } : { items: run.items, expired, ralphExpired },
  })

  return NextResponse.json({ ...run, expired, ralphExpired })
}
