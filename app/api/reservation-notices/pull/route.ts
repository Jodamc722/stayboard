// Pull upcoming Guesty arrivals onto the reservation-emails desk, on demand.
//
// The cron at /api/cron/reservation-notices runs the same function on a schedule; this is the
// button for when someone wants the desk current right now (a booking that just landed, a building
// switched on a minute ago).
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { pullNotices } from '@/lib/reservation-pull'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const days = Number(req.nextUrl.searchParams.get('days') || 30)
  try {
    const res = await pullNotices(Number.isFinite(days) ? days : 30)
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
