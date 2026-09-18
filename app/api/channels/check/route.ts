// RUN THE CHANNEL CHECK NOW (Jon, 2026-09-18: "creates a trigger if a listing is suspended").
//
// POST from the Refresh button on /channels (full access on the tab), or from the listings sync
// (app/api/cron/guesty-catalog chains into runChannelCheck directly — it does not go through HTTP).
// A cron bearer is accepted too so the job can be kicked by hand from a terminal.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { cronAllowed } from '@/lib/cron-auth'
import { runChannelCheck } from '@/lib/channel-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const viaCron = cronAllowed(req).viaSecret || !!req.headers.get('x-vercel-cron')
  if (!viaCron) {
    const g = await requireLevel('channels', 'full')
    if (!g.ok) return g.res
  }
  try {
    const r = await runChannelCheck()
    return NextResponse.json(r)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
