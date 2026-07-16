// Resync for the share links. Password-gated AND throttled to once every 30 minutes, so a
// vendor mashing the button can never hammer the Guesty API. Pulls INCREMENTALLY (only what
// changed since the last sync) so it returns in seconds instead of sweeping every reservation.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncReservations } from '@/lib/guesty'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WINDOW_MS = 30 * 60 * 1000

export async function POST() {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const { data: st } = await db.from('guesty_sync_status').select('last_sync_at').eq('entity', 'reservations').maybeSingle()
    const last = st && st.last_sync_at ? new Date(st.last_sync_at) : null
    if (last && Date.now() - last.getTime() < WINDOW_MS) {
      const nextAt = new Date(last.getTime() + WINDOW_MS).toISOString()
      return NextResponse.json({ ok: false, throttled: true, lastSync: last.toISOString(), nextAt, error: 'Synced recently' }, { status: 429 })
    }
    // incremental: only reservations updated since the last sync (5-min overlap for safety)
    const since = last ? new Date(last.getTime() - 5 * 60 * 1000).toISOString() : null
    const n = await syncReservations(20, since)
    return NextResponse.json({ ok: true, synced: n, lastSync: new Date().toISOString() })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
