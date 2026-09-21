// THE OPERATOR'S REVIEW, on a schedule — Monday 10:30 UTC (06:30 ET), before Jon's week starts.
//
// GET            → run the weekly review. Cron (bearer when CRON_SECRET is set) or a signed-in
//                  admin. Without a secret the run ledger keeps it to once every six hours, so an
//                  anonymous fetch can only trigger the run that was about to happen anyway — the
//                  same shape as every other Eve cron (lib/cron-auth.ts).
// GET ?focus=…   → steer the review ("labor per clean in Broward"). Recorded as trigger 'manual'.
import { NextRequest, NextResponse } from 'next/server'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'
import { runReview } from '@/lib/eve/review'
import { runLearningAudit } from '@/lib/eve/learning-audit'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  const allowed = cronAllowed(req)
  let human: string | null = null
  if (!allowed.ok) {
    const gate = await eveGate()
    if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    human = String(gate.access.email || '')
  } else if (!allowed.viaSecret) {
    const gate = await eveGate()
    if (gate.ok) human = String(gate.access.email || '')
    else {
      const skip = await tooSoon('eve-review', 6 * 60)
      if (skip) return NextResponse.json({ ok: true, ...skip })
    }
  }

  const focus = String(new URL(req.url).searchParams.get('focus') || '').trim().slice(0, 300)
  const res = await runReview({ trigger: (focus || human) ? 'manual' : 'weekly', focus: focus || undefined, by: human || 'cron' })
  // THE WEEKLY LEARNING RUN rides with the review (2026-09-21): the Monday number for "is she
  // learning", with the same four parts as the nightly one, so the Learning tab has a weekly point
  // whatever the nightly pass did. Never fails the review.
  let learning: any = null
  if (!focus) {
    try { const r = await runLearningAudit({ kind: 'weekly', limit: 15, by: human || 'cron' }); learning = r.ok ? { score: r.run?.score, probes: r.run?.probes, failed: r.run?.failed } : { error: r.error } }
    catch (e: any) { learning = { error: String(e?.message || e).slice(0, 160) } }
  }
  await recordRun({
    name: 'eve-review', ok: res.ok, itemCount: res.ok ? res.review.plans.length : 0,
    error: res.ok ? undefined : res.error,
    detail: res.ok ? { id: res.id, headline: res.review.headline, plans: res.persisted.plans, questions: res.persisted.questions, retired: res.persisted.retired, packTokens: res.pack.tokens, learning } : { pack: res.pack, learning },
  })
  return NextResponse.json({ ...res, learning }, { status: res.ok ? 200 : 500 })
}
