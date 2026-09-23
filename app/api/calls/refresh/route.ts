// PULL THE BOOKINGS NOW (Jon, 2026-09-23: "also need a refresh button on call desk, new
// reservation came in").
//
// The desk renders from the Guesty mirror, and the mirror is filled by a cron. When a booking
// lands between runs the guest is real, the call is owed, and the page shows nothing — which is the
// one moment somebody is standing there wanting to act. This route is that person pressing sync:
// an incremental Guesty pull (the same one the cron runs), then the page reloads itself.
//
// INCREMENTAL, ALWAYS. A full window takes minutes and this is a button someone may press twice.
// The 30-minute overlap is the same one the cron uses, so a booking that landed mid-run is never
// skipped.
import { NextResponse } from 'next/server'
import { syncReservations } from '@/lib/guesty'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const started = Date.now()
  try {
    const sb = supabaseAdmin()
    const { data: st } = await sb.from('guesty_sync_status')
      .select('last_sync_at,last_error').eq('entity', 'reservations').maybeSingle()
    let since: string | null = null
    if (st && st.last_sync_at && !st.last_error) since = new Date(new Date(st.last_sync_at).getTime() - 30 * 60_000).toISOString()
    const n = await syncReservations(since ? 20 : 80, since)
    return NextResponse.json({ ok: true, reservations: n, mode: since ? 'incremental' : 'full-window', elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
