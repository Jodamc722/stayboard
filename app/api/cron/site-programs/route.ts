// PROPERTY PROGRAMS (lib/site-programs) — the Upkeep page's scheduled templates. Each run: per place,
// the open task is kept (moved to today if it is from an earlier day), cleaners there today are added,
// and a task is created only on the place's days when none is open. ?dry=1 shows what it would do.
// BARE PATH ON PURPOSE for the scheduler — the dry run is for people.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { runPrograms } from '@/lib/site-programs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await runPrograms({ dryRun: req.nextUrl.searchParams.get('dry') === '1' })
  return NextResponse.json({ ...r, plans: undefined, count: r.created + r.moved + r.updated + r.cancelled })
}
const receipted = withRouteReceipt<NextRequest>('site-programs', run, { skipWhen: (req) => req.nextUrl.searchParams.get('dry') === '1' })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
