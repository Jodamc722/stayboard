import { NextRequest, NextResponse } from 'next/server'
import { syncReservations } from '@/lib/guesty'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// KEEP THE BOOKING FEED FRESH.
//
// Why this route exists at all: the same job was first wired as a cron on
// "/api/sync/guesty?only=reservations&fast=1". That cron never fired — the working crons in this
// repo all point at a bare path, and the booking feed sat 65 minutes stale while the Breezeway one
// (a bare path, same schedule style) stayed at 5 minutes. A stale booking feed is how a walk-in
// reaches the property before the sheet does, so this gets its own plain path.
//
// Auth matches the Breezeway cron exactly: enforce the bearer token when CRON_SECRET is set,
// otherwise run open so the schedule works without extra configuration.
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  const full = new URL(req.url).searchParams.get('full') === '1'
  let since: string | null = null
  if (!full) {
    const sb = supabaseAdmin()
    const { data: st } = await sb.from('guesty_sync_status')
      .select('last_sync_at,last_error').eq('entity', 'reservations').maybeSingle()
    // 30-minute overlap so a booking that lands mid-run is never skipped. A previous error means the
    // watermark cannot be trusted, so fall back to the full window.
    if (st && st.last_sync_at && !st.last_error) since = new Date(new Date(st.last_sync_at).getTime() - 30 * 60_000).toISOString()
  }
  try {
    const n = await syncReservations(since ? 20 : 80, since)
    return NextResponse.json({ ranAt: new Date().toISOString(), mode: since ? 'incremental' : 'full-window', reservations: n, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
