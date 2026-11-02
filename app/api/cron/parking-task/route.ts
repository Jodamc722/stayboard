// DAILY PARKING CHECK IN BREEZEWAY (lib/parking-daily-task). Morning run creates the day's task at
// Eden (supervisors + the housekeepers cleaning there today, link + passcode in the description);
// later runs only ADD housekeepers assigned since. ?dry=1 shows what it would do.
// BARE PATH ON PURPOSE for the scheduler — the dry run is for people.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { runParkingTasks } from '@/lib/parking-daily-task'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  // MOVED TO UPKEEP → PROGRAMS (Jon, 2026-11-02: every recurring task is managed there). The
  // program of the same name now creates these tasks; this route stays so an old link answers.
  if (req.nextUrl.searchParams.get('legacy') !== '1') return NextResponse.json({ ok: true, moved: 'Upkeep → Programs', count: 0 })
  const r = await runParkingTasks({ dryRun: req.nextUrl.searchParams.get('dry') === '1' })
  return NextResponse.json({ ...r, count: r.created + r.updated })
}
const receipted = withRouteReceipt<NextRequest>('parking-task', run, { skipWhen: (req) => req.nextUrl.searchParams.get('dry') === '1' })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
