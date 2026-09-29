// THE DAILY FULL RESERVATION RESYNC — on its own bare path, because it has to be.
//
// This used to be scheduled as "/api/cron/reservations?full=1". A VERCEL CRON WITH A QUERY STRING
// NEVER FIRES, so the full resync has silently not run since the day it was added. The incremental
// job next door already carries the same warning in its own header — the trap was documented and
// then walked into anyway, which is exactly why this is now a path and not a parameter.
//
// Difference from the incremental cron: no watermark. It re-reads every booking checking out from
// 45 DAYS AGO onward outright, which is what repairs anything the incremental pass missed (a
// booking edited outside its window, a run that errored, a gap after an outage) — including the
// folio adjustments, refunds and owner-stay reclassifications that land on stays already over.
// (2026-09-28 audit #13: the window was 3 days, so those were never repaired.)
//
// It does NOT move the incremental watermark: a window pull has not read every change since it,
// so only the 5-minute incremental run stamps `reservations` (lib/guesty syncReservations).
import { NextRequest, NextResponse } from 'next/server'
import { syncReservations } from '@/lib/guesty'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
// 300, not 60: the 45-day window is tens of pages of full rows, and a function killed at 60s
// finished nothing and recorded nothing.
export const maxDuration = 300

const WINDOW_DAYS = 45

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const started = Date.now()
  try {
    const n = await syncReservations(80, null, { windowDays: WINDOW_DAYS })
    return NextResponse.json({ ranAt: new Date().toISOString(), mode: 'full-window', windowDays: WINDOW_DAYS, reservations: n, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

const receipted = withRouteReceipt<NextRequest>('reservations-full', run, { count: (b) => (typeof b.reservations === 'number' ? b.reservations : undefined) })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
