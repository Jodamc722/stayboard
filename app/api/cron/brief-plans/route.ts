// THE BRIEFS, EACH MORNING (lib/brief-plans; Jon, 2026-11-25). Sends each plan that is switched to go
// out on its own (Briefs page, per plan, OFF until someone turns it on), once a day, with the note and
// the changes made on the page. A plan that is off, has no addresses, or already went today is skipped.
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runPlanSends } from '@/lib/brief-plans'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  return NextResponse.json(await runPlanSends())
}
