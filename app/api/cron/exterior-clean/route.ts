// PROPERTY EXTERIOR CLEAN IN BREEZEWAY (lib/exterior-clean-task). Creates each building's task on its days
// (maintenance + the cleaners there today); later runs only ADD cleaners assigned since.
// BARE PATH ON PURPOSE for the scheduler — the dry run is for people.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { runExteriorCleans } from '@/lib/exterior-clean-task'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await runExteriorCleans({ dryRun: req.nextUrl.searchParams.get('dry') === '1' })
  return NextResponse.json({ ...r, count: r.created + r.updated })
}
const receipted = withRouteReceipt<NextRequest>('exterior-clean', run, { skipWhen: (req) => req.nextUrl.searchParams.get('dry') === '1' })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
