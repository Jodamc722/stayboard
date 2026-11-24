// THE LISTING WATCH, EACH MORNING (lib/listing-watch; Jon, 2026-11-24). Eve tells the leadership room
// which properties have no cleaning fee and which listings are offline on Airbnb: once a morning while
// anything is on either list, nothing when both are empty. The same watch also runs after each listings
// sync (app/api/cron/guesty-catalog), where it only speaks about a listing that is new to a list.
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runListingWatch } from '@/lib/listing-watch'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  // ?dry=1 (a signed-in admin, by hand): the two messages as they would read now. Posts nothing.
  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const r = await runListingWatch({ reminder: true, dry, by: 'listing-watch' })
  return NextResponse.json(r)
}
export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
