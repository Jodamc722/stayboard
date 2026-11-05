// THE GARAGE'S DAILY EMAIL + same-day updates for new reservations (lib/parking-vendor-email).
// Every 30 minutes; the lib decides whether anything is due.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { runVendorEmail } from '@/lib/parking-vendor-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await runVendorEmail()
  return NextResponse.json({ ok: !r.error, ...r, count: r.count || 0 })
}
const receipted = withRouteReceipt<NextRequest>('parking-vendor-email', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
