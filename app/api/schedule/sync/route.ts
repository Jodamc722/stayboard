// Force-refresh the Turnover Schedule. Revalidates the 'schedule' cache tag so the next load recomputes
// from current Guesty reservations + Breezeway tasks. POST = the in-app Sync button (anyone who can see
// the Scheduler). GET = a manual "Run now" (the scheduler's bearer or a signed-in admin); it is not on
// a schedule — vercel.json has no line for it.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { requireCron } from '@/lib/cron-auth'
import { syncReservations } from '@/lib/guesty'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function doSync() {
  // Pull the Guesty reservations DELTA first so altered/canceled stays don't linger as phantom
// cleans (a reservation changed in Guesty otherwise sat stale until the next 5-minute reservations pass).
try { await syncReservations() } catch { /* Guesty hiccup - still refresh from cached data */ }
// Re-pull the Breezeway task mirror (soonest checkouts first) so assignments made in Breezeway
// moments ago show immediately on Refresh — the board was otherwise stale until the 30-min cron.
try { await syncBreezewayTasks(35000) } catch { /* mirror refresh is best-effort */ }
revalidateTag('schedule')
  return NextResponse.json({ ok: true, syncedAt: new Date().toISOString() })
}

// GET: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron). Not on a schedule
// today — the Sync buttons below are its only callers.
export async function GET(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  return doSync()
}

// In-app Sync button (POST) on the Turnover Schedule and its Weekly tab — anyone who can see that
// board (was: any Supabase session, a disabled employee's included).
export async function POST() {
  const g = await requireLevel('schedule', 'view')
  if (!g.ok) return g.res
  return doSync()
}
