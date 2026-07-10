// Force-refresh the Turnover Schedule. Revalidates the 'schedule' cache tag so the next load recomputes
// from current Guesty reservations + Breezeway tasks. POST = the in-app Sync button (logged-in users).
// GET = Vercel cron (fires at 6am + noon ET, see vercel.json) so the schedule locks in the morning and
// re-runs at noon without anyone opening the page.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'
import { syncReservations } from '@/lib/guesty'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function doSync() {
  // Pull the Guesty reservations DELTA first so altered/canceled stays don't linger as phantom
// cleans (a reservation changed in Guesty otherwise sat stale until the 2h Guesty cron).
try { await syncReservations() } catch { /* Guesty hiccup - still refresh from cached data */ }
// Re-pull the Breezeway task mirror (soonest checkouts first) so assignments made in Breezeway
// moments ago show immediately on Refresh — the board was otherwise stale until the 30-min cron.
try { await syncBreezewayTasks(35000) } catch { /* mirror refresh is best-effort */ }
revalidateTag('schedule')
  return NextResponse.json({ ok: true, syncedAt: new Date().toISOString() })
}

// Cron (GET). If CRON_SECRET is set, require it; otherwise allow (Vercel cron calls are internal).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return doSync()
}

// In-app Sync button (POST) — logged-in users only.
export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return doSync()
}
