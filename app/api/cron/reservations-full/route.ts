// THE DAILY FULL RESERVATION RESYNC — on its own bare path, because it has to be.
//
// This used to be scheduled as "/api/cron/reservations?full=1". A VERCEL CRON WITH A QUERY STRING
// NEVER FIRES, so the full resync has silently not run since the day it was added. The incremental
// job next door already carries the same warning in its own header — the trap was documented and
// then walked into anyway, which is exactly why this is now a path and not a parameter.
//
// Difference from the incremental cron: no watermark. It re-reads an 80-day window outright, which
// is what repairs anything the incremental pass missed (a booking edited outside its window, a run
// that errored, a gap after an outage).
import { NextRequest, NextResponse } from 'next/server'
import { syncReservations } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  try {
    const n = await syncReservations(80, null)
    return NextResponse.json({ ranAt: new Date().toISOString(), mode: 'full-window', reservations: n, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
