import { NextRequest, NextResponse } from 'next/server'
import { syncReservations } from '@/lib/guesty'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { bustOpsDay } from '@/lib/ops-day'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
// 300, not 60 (2026-09-28 audit #13): a recovery pass pages up to 80 times; a function killed at
// 60s writes nothing, so a feed stuck in recovery would never have cleared its own error.
export const maxDuration = 300

// KEEP THE BOOKING FEED FRESH.
//
// Why this route exists at all: the same job was first wired as a cron on
// "/api/sync/guesty?only=reservations&fast=1". That cron never fired — the working crons in this
// repo all point at a bare path, and the booking feed sat 65 minutes stale while the Breezeway one
// (a bare path, same schedule style) stayed at 5 minutes. A stale booking feed is how a walk-in
// reaches the property before the sheet does, so this gets its own plain path.
//
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const started = Date.now()
  const full = new URL(req.url).searchParams.get('full') === '1'
  let since: string | null = null
  let mode: 'incremental' | 'recovery' | 'bootstrap' | 'full-window' = 'full-window'
  if (!full) {
    const sb = supabaseAdmin()
    const { data: st, error: stErr } = await sb.from('guesty_sync_status')
      .select('last_sync_at,last_error').eq('entity', 'reservations').maybeSingle()
    if (st && st.last_sync_at) {
      // 30-minute overlap so a booking that lands mid-run is never skipped. A recorded error means
      // the watermark cannot be trusted to the minute — but it is still a floor, so the overlap
      // widens to 6 hours instead of falling back to the whole 80-page window on every 5-minute run
      // (which is how one bad error could wedge the feed: every run too long, the error never
      // cleared).
      mode = st.last_error ? 'recovery' : 'incremental'
      const backMin = st.last_error ? 6 * 60 : 30
      since = new Date(new Date(st.last_sync_at).getTime() - backMin * 60_000).toISOString()
    } else if (!stErr) {
      // No watermark at all yet: one full-window run that is allowed to set it.
      mode = 'bootstrap'
    }
  }
  try {
    const n = await syncReservations(mode === 'incremental' ? 20 : 80, since, { stamp: mode !== 'full-window' })
    // SALATO BOOKING WATCH (Jon, 2026-09-24): every new Salato booking into #vr-customercareteam with
    // @channel, and a one-night booking flagged as not permitted and chased until it is canceled.
    // Right after the sync, so the post is minutes behind Guesty. See lib/salato-watch.ts.
    let salato: any = null
    try { const { runSalatoWatch } = await import('@/lib/salato-watch'); const w = await runSalatoWatch({ fromCron: true }); salato = { announced: w.announced, oneNight: w.oneNight, nudged: w.nudged, resolved: w.resolved, error: w.error, skipped: w.skipped } } catch (e: any) { salato = { error: String(e?.message || e).slice(0, 120) } }
    return NextResponse.json({ ranAt: new Date().toISOString(), mode, reservations: n, salato, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// RECEIPT (2026-09-28): every run, so "did the booking feed run" has an answer that is not an
// inference from guesty_sync_status.
const receipted = withRouteReceipt<NextRequest>('reservations', run, { count: (b) => (typeof b.reservations === 'number' ? b.reservations : undefined) })
// Bust the day only when a run actually brought bookings in (2026-09-29): this used to purge it on
// every call — an anonymous 401 and a quiet 0-booking run included — and each purge is a full
// Command Center / Today in Ops rebuild for the next viewer.
async function runAndBust(req: NextRequest) {
  const res = await receipted(req)
  if (res.ok) {
    const b = await res.clone().json().catch(() => null)
    if (!b || b.reservations !== 0) bustOpsDay()
  }
  return res
}
export async function GET(req: NextRequest) { return runAndBust(req) }
export async function POST(req: NextRequest) { return runAndBust(req) }
