// WEEKLY PROPERTY EXTERIOR WALKTHROUGHS (lib/standing-walkthroughs). Daily at 7am ET; idempotent per
// week, so only the first run of each week creates. ?dry=1 shows what it would do (admin or cron).
// BARE PATH ON PURPOSE for the scheduler — the dry run is for people.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { runWalkthroughs } from '@/lib/standing-walkthroughs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  // MOVED TO UPKEEP → PROGRAMS (Jon, 2026-11-02: every recurring task is managed there). The
  // program of the same name now creates these tasks; this route stays so an old link answers.
  if (req.nextUrl.searchParams.get('legacy') !== '1') return NextResponse.json({ ok: true, moved: 'Upkeep → Programs', count: 0 })
  const r = await runWalkthroughs({ dryRun: req.nextUrl.searchParams.get('dry') === '1' })
  return NextResponse.json({ ...r, count: r.created })
}
const receipted = withRouteReceipt<NextRequest>('walkthroughs', run, { skipWhen: (req) => req.nextUrl.searchParams.get('dry') === '1' })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
