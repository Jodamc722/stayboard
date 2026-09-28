// GARDEN HOTEL SYNC — Cloudbeds → garden_* every half hour.
//
// No vercel.json line of its own (the cron cap): the breezeway-tasks cron (:04 and :34) calls
// syncGarden() after the VR mirror, throttled to once per 25 minutes here. This route exists for a
// signed-in "Sync now" and for a future dedicated cron line. ?full=1 ignores modified-since.
import { NextRequest, NextResponse } from 'next/server'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { createClient } from '@/lib/supabase-server'
import { syncGarden } from '@/lib/garden/sync'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = cronAllowed(req)
  if (!gate.ok) {
    let user: any = null
    try { user = (await createClient().auth.getUser()).data.user } catch {}
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const full = req.nextUrl.searchParams.get('full') === '1'
  if (!full && !gate.viaSecret) { const skip = await tooSoon('garden-sync', 20); if (skip) return NextResponse.json({ ok: true, ...skip }) }
  const r = await syncGarden({ full })
  return NextResponse.json({ ranAt: new Date().toISOString(), ...r })
}

const withReceipt = withRouteReceipt<NextRequest>('garden-sync', run)
export async function GET(req: NextRequest) { return withReceipt(req) }
export async function POST(req: NextRequest) { return withReceipt(req) }
