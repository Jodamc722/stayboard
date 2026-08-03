// BACKFILL the booking mirror by CREATION date.
//
// Why this exists: the routine reservations sync pulls stays that haven't finished (checkOut >=
// now-3d). Perfect for operations, wrong for history — a booking made in March for a stay that
// ended in April was never imported, so the marketing board's month-by-month trend had to mark
// everything before the mirror started as "partial". This fills the gap properly.
//
// Paged by the caller so a single request never runs past the serverless ceiling:
//   /api/sync/reservations-backfill?from=2026-01-01&to=2026-02-01&skip=0&pages=20
// Returns { fetched, nextSkip, done } — call again with nextSkip until done is true.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { backfillReservationsByCreated } from '@/lib/guesty'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// app_settings key holding the earliest date the booking table has been backfilled to.
const BACKFILL_KEY = 'reservations_backfilled_from'

export async function GET(req: NextRequest) {
  // Signed-in team only, OR the cron secret. This writes to the booking table, so it is never open.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  let allowed = !!(secret && auth === 'Bearer ' + secret)
  if (!allowed) {
    try {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      allowed = !!user
    } catch { allowed = false }
  }
  if (!allowed) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const from = String(url.searchParams.get('from') || '').slice(0, 10)
  const to = String(url.searchParams.get('to') || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'from and to must be YYYY-MM-DD' }, { status: 400 })
  }
  const skip = Math.max(0, Number(url.searchParams.get('skip') || 0) || 0)
  const pages = Math.max(1, Math.min(30, Number(url.searchParams.get('pages') || 20) || 20))

  const started = Date.now()
  try {
    const r = await backfillReservationsByCreated(from + 'T00:00:00.000Z', to + 'T00:00:00.000Z', skip, pages)

    // Record how far back the booking table is now genuinely complete. Without this the marketing
    // timeline keeps calling backfilled months "not tracked yet" — its coverage floor is derived
    // from min(synced_at), and a row imported today carries today's synced_at, not its own history.
    try {
      const db = supabaseAdmin()
      const { data: cur } = await db.from('app_settings').select('value').eq('key', BACKFILL_KEY).maybeSingle()
      const prev = cur && cur.value ? String(cur.value).slice(0, 10) : ''
      if (!prev || from < prev) {
        await db.from('app_settings').upsert({ key: BACKFILL_KEY, value: from }, { onConflict: 'key' })
      }
    } catch { /* the import still counts even if the marker fails to save */ }

    return NextResponse.json({ ok: true, from, to, ...r, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300), skip, elapsed_ms: Date.now() - started }, { status: 500 })
  }
}
