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
// EACH LEG REPORTS (2026-11-09 audit): both failures used to be swallowed and the button said
// "synced" over data that had not moved. The cache is still busted either way; the board now says
// which source did not refresh.
const guesty: { ok: boolean; error?: string } = { ok: true }
const breezeway: { ok: boolean; error?: string } = { ok: true }
try { await syncReservations() } catch (e: any) { guesty.ok = false; guesty.error = String(e?.message || e).slice(0, 160) }
// Re-pull the Breezeway task mirror (soonest checkouts first) so assignments made in Breezeway
// moments ago show immediately on Refresh — the board was otherwise stale until the 30-min cron.
try {
  const b = await syncBreezewayTasks(35000)
  // 'not configured' is not a failure — the board already says Breezeway is off.
  if (b && b.ok === false && b.reason !== 'not configured') { breezeway.ok = false; breezeway.error = String(b.error || b.reason || 'did not finish').slice(0, 160) }
} catch (e: any) { breezeway.ok = false; breezeway.error = String(e?.message || e).slice(0, 160) }
revalidateTag('schedule')
  return NextResponse.json({ ok: true, guesty, breezeway, syncedAt: new Date().toISOString() })
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
