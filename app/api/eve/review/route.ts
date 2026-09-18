// THE OPERATOR'S REVIEW — read the latest few, or run one now.
//
// GET  ?n=5            the most recent reviews, newest first, plus the latest one's open plans.
// POST {"focus": "…"}  run a review now (trigger 'manual'); focus is optional.
import { NextRequest, NextResponse } from 'next/server'
import { listReviews, latestReviewPlans, runReview } from '@/lib/eve/review'
import { recordRun } from '@/lib/automation-runs'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get('n')) || 5, 1), 20)
  const [reviews, open] = await Promise.all([listReviews(n), latestReviewPlans()])
  return NextResponse.json({ ok: true, reviews, open })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const focus = String(body?.focus || '').trim().slice(0, 300)
  const res = await runReview({ trigger: 'manual', focus: focus || undefined, by: String(gate.access.email || '') })
  await recordRun({ name: 'eve-review', ok: res.ok, itemCount: res.ok ? res.review.plans.length : 0, error: res.ok ? undefined : res.error, detail: res.ok ? { id: res.id, headline: res.review.headline, focus, by: gate.access.email } : { focus } })
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}
