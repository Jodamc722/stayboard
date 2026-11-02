// WALK REPORTS (lib/walk-reports) — the webhook's safety net and the Monday roll-up.
//   every pass   finished program tasks from the last 3 days with no report yet get one (filed,
//                fix tasks raised, owners emailed as the program says);
//   Monday       the week's roll-up for every program with a weekly report, once per program.
// Manual: ?dry=1 shows the week's roll-up without sending; ?weekly=1 sends it on any day;
// ?sweep=0 skips the sweep.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { sweepFinishedWalks, sendWeeklyDigests } from '@/lib/walk-reports'
import { ymdET } from '@/lib/site-programs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const dry = sp.get('dry') === '1'
  const today = ymdET(new Date())
  const monday = new Date(today + 'T12:00:00Z').getUTCDay() === 1
  const sweep = sp.get('sweep') === '0' || dry ? null : await sweepFinishedWalks(3)
  const weekly = monday || sp.get('weekly') === '1' || dry ? await sendWeeklyDigests({ dryRun: dry, force: sp.get('weekly') === '1' || dry, today }) : null
  const count = (sweep ? sweep.filed.length : 0) + (weekly ? weekly.sent.length : 0)
  return NextResponse.json({ ok: (!sweep || !sweep.errors.length) && (!weekly || weekly.ok), today, sweep, weekly, count })
}
const receipted = withRouteReceipt<NextRequest>('walk-reports', run, { skipWhen: (req) => req.nextUrl.searchParams.get('dry') === '1' })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
