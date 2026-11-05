// CONNECTING DOORS (lib/connecting-doors). Capri 115/116 booked as one unit: an "Open connecting door"
// task on the clean before arrival, a "Close connecting door" task on the checkout clean, and a note on
// each departure clean's title. ?dry=1 shows what it would do.
// BARE PATH ON PURPOSE for the scheduler — the dry run is for people.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { runDoors } from '@/lib/connecting-doors'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await runDoors({ dryRun: req.nextUrl.searchParams.get('dry') === '1' })
  return NextResponse.json({ ...r, count: r.created + r.updated + r.titled })
}
const receipted = withRouteReceipt<NextRequest>('connecting-doors', run, { skipWhen: (req) => req.nextUrl.searchParams.get('dry') === '1' })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
