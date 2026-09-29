import { NextRequest, NextResponse } from 'next/server'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'
import { syncBreezewayComments } from '@/lib/breezeway-comment-sync'
import { runBehindAlert } from '@/lib/ops-behind'
import { revalidateTag } from 'next/cache'
import { bustOpsDay } from '@/lib/ops-day'
import { bustBoards } from '@/lib/bust'
import { withRouteReceipt, withReceipt as receipted } from '@/lib/automation-runs'
import { assignVendorTasks } from '@/lib/vendor-assign'
import { syncGarden } from '@/lib/garden/sync'
import { requireCron, tooSoon } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Scheduled refresh of the Breezeway task mirror (assignees) so the scheduler
// stays current without waiting on webhooks. Wired to a Vercel cron in
// vercel.json (every 30 minutes). Auth: the scheduler's bearer, or a signed-in
// admin (lib/cron-auth requireCron).
//
// ONE DEADLINE FOR THE WHOLE RUN (2026-09-28 audit #6). The task loop had a 250s budget of its own
// and everything after it — 120 comment threads, the behind alert, vendor assignment, the Garden
// sync — ran on the same 300s function with none. A killed run writes no receipt, and vendor
// assignment and the Garden sync starved behind the comments. Now: one deadline 270s after the
// start; the task loop stops early enough to leave RESERVE_MS for the alert, vendors and Garden;
// the comment sweep goes LAST and takes whatever is left.
const RUN_BUDGET_MS = 270_000
const RESERVE_MS = 50_000
/** Never START a step with less time than this left before the deadline. */
const MIN_STEP_MS = 15_000

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const started = Date.now()
  const deadline = started + RUN_BUDGET_MS
  const left = () => deadline - Date.now()
  const outOfTime = { skipped: 'out of time this run — next run picks it up' }

  const result = await syncBreezewayTasks(Math.max(30_000, left() - RESERVE_MS))
  try { revalidateTag('schedule') } catch {}
  bustOpsDay()
  // The mirror is now fresh, so this is the right moment to ask "are the cleans running behind?"
  // and tell the ops team once (see lib/ops-behind.ts for the clock rule and the once-a-day gate).
  // Best effort - an alert failure must never fail the task mirror.
  let alert: any = null
  try { alert = await runBehindAlert() } catch (e) { alert = { error: String((e as any)?.message || e).slice(0, 120) } }
  // Vendor buildings go to the vendor (Jon, 2026-09-23: Capri, Lucerne and Amrit are Opal's). Any
  // unassigned open task there is handed to the Opal Works account; see lib/vendor-assign.
  let vendors: any = outOfTime
  if (left() > MIN_STEP_MS) {
    try { vendors = await assignVendorTasks() } catch (e) { vendors = { error: String((e as any)?.message || e).slice(0, 120) } }
    // Vendor assignment writes assignees to the mirror AFTER the bust above; bust again so a board
    // read in between does not keep "Unassigned" for the length of its cache.
    bustBoards()
  }
  // THE GARDEN HOTEL rides this line (Jon, 2026-09-28: a separate business on Cloudbeds; see
  // lib/garden). Its own tables, its own ledger; not connected is a quiet no-op, never an error here.
  let garden: any = outOfTime
  if (left() > MIN_STEP_MS) {
    garden = null
    try { if (!(await tooSoon('garden-sync', 20))) garden = await receipted('garden-sync', () => syncGarden(), r => ({ itemCount: r.reservations ?? 0, detail: { rooms: r.rooms, cleans: r.cleans, errors: r.errors } })) } catch (e) { garden = { error: String((e as any)?.message || e).slice(0, 120) } }
  }
  // Field replies written inside Breezeway come back into the app threads and notify whoever
  // is following that task. Best effort - a comment failure must never fail the task mirror.
  let comments: any = null
  try { comments = await syncBreezewayComments(120, { deadline }) } catch (e) { comments = { error: String((e as any)?.message || e).slice(0, 120) } }
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result, comments, alert, vendors, garden, ms: Date.now() - started })
}

const withReceipt = withRouteReceipt<NextRequest>('breezeway-tasks', run)
export async function GET(req: NextRequest) {
  return withReceipt(req)
}

export async function POST(req: NextRequest) {
  return withReceipt(req)
}
