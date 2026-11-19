// Every few hours: open the public Airbnb and Vrbo page of listings Guesty calls connected, and mark the ones whose
// page is gone (lib/channel-live). When anything changed, the channel check re-runs so the boards and the alert see it.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { runLiveCheck } from '@/lib/channel-live'
import { runChannelCheck } from '@/lib/channel-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const g = await requireCron(req); if (!g.ok) return g.res!
  const n = Math.max(1, Math.min(400, Number(req.nextUrl.searchParams.get('limit')) || 160))
  const r = await runLiveCheck(n)
  let rechecked = false
  if (r.newlyGone.length || r.backLive) { try { await runChannelCheck(); rechecked = true } catch { /* the next listings sync runs it */ } }
  return NextResponse.json({ ...r, rechecked })
}
