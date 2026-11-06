// INSPECTION SCORES → TRAINING (Jon, 2026-11-05: "It should read those scores and use it in database
// for training"). Hourly at :27, read the answers of finished HK Post Clean / PM / Arrival
// inspections (lib/inspection-results) into inspection_results. The scheduler reads the last 3 days;
// a signed-in admin may pass ?days= (≤ 60) for a backfill. BARE PATH ON PURPOSE — a Vercel cron
// pointed at a path with a query string never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { syncInspectionResults } from '@/lib/inspection-results'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  // Only a person (an admin session) may widen the window; the scheduler always reads 3 days.
  const asked = Number(new URL(req.url).searchParams.get('days'))
  const days = gate.access && Number.isFinite(asked) && asked > 0 ? Math.min(Math.round(asked), 60) : 3
  const r = await syncInspectionResults({ days, max: days > 3 ? 120 : 60, deadline: Date.now() + 50_000 })
  return NextResponse.json({ ...r, count: r.stored }, { status: r.ok || r.needsMigration ? 200 : 500 })
}
const receipted = withRouteReceipt('inspection-results', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
