// TODAY IN OPS — thin route over lib/ops-day.ts (the builder moved there 2026-09-02 so the
// Command Center can read the same day in-process). Optional ?date=YYYY-MM-DD.
import { NextRequest, NextResponse } from 'next/server'
import { buildOpsDay } from '@/lib/ops-day'
import { requireVrUser } from '@/lib/vr-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const day = await buildOpsDay(req.nextUrl.searchParams.get('date'), { fresh: req.nextUrl.searchParams.get('refresh') === '1' })
    // The cached day carries the listing directory and the capacity picture for the Command Center,
    // which reads them in-process. The board uses neither (it fetches /api/capacity for the crew
    // strip), so they stay off the wire — they are most of the payload.
    const { listingMeta: _meta, picture: _picture, ...board } = day
    return NextResponse.json(board)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
