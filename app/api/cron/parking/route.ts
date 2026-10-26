// PARKING — THE HOUR IS UP (Jon, 2026-10-26: "they get 1 hour or the car will be towed. It then
// drafts a message via email to our tow company"). Every 15 minutes: any flagged car whose notice
// deadline has passed and has no tow draft yet gets the email drafted in the notice mailbox. A
// person still presses send. The same step also runs lazily whenever someone opens the lot, so
// the cron is the backstop for a quiet afternoon, not the only path.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { processDueTows } from '@/lib/parking-lots'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await processDueTows()
  return NextResponse.json({ ok: true, ...r, count: r.drafted })
}
const receipted = withRouteReceipt<NextRequest>('parking-tows', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
