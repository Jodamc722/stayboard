import { NextRequest, NextResponse } from 'next/server'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'
import { syncBreezewayComments } from '@/lib/breezeway-comment-sync'
import { runBehindAlert } from '@/lib/ops-behind'
import { revalidateTag } from 'next/cache'
import { bustOpsDay } from '@/lib/ops-day'
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
async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const result = await syncBreezewayTasks(250000)
  // Field replies written inside Breezeway come back into the app threads and notify whoever
  // is following that task. Best effort - a comment failure must never fail the task mirror.
  let comments: any = null
  try { comments = await syncBreezewayComments(120) } catch (e) { comments = { error: String((e as any)?.message || e).slice(0, 120) } }
  try { revalidateTag('schedule') } catch {}
  bustOpsDay()
  // The mirror is now fresh, so this is the right moment to ask "are the cleans running behind?"
  // and tell the ops team once (see lib/ops-behind.ts for the clock rule and the once-a-day gate).
  // Best effort - an alert failure must never fail the task mirror.
  let alert: any = null
  try { alert = await runBehindAlert() } catch (e) { alert = { error: String((e as any)?.message || e).slice(0, 120) } }
  // Vendor buildings go to the vendor (Jon, 2026-09-23: Capri, Lucerne and Amrit are Opal's). Any
  // unassigned open task there is handed to the Opal Works account; see lib/vendor-assign.
  let vendors: any = null
  try { vendors = await assignVendorTasks() } catch (e) { vendors = { error: String((e as any)?.message || e).slice(0, 120) } }
  // THE GARDEN HOTEL rides this line (Jon, 2026-09-28: a separate business on Cloudbeds; see
  // lib/garden). Its own tables, its own ledger; not connected is a quiet no-op, never an error here.
  let garden: any = null
  try { if (!(await tooSoon('garden-sync', 20))) garden = await receipted('garden-sync', () => syncGarden(), r => ({ itemCount: r.reservations ?? 0, detail: { rooms: r.rooms, cleans: r.cleans, errors: r.errors } })) } catch (e) { garden = { error: String((e as any)?.message || e).slice(0, 120) } }
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result, comments, alert, vendors, garden })
}

const withReceipt = withRouteReceipt<NextRequest>('breezeway-tasks', run)
export async function GET(req: NextRequest) {
  return withReceipt(req)
}

export async function POST(req: NextRequest) {
  return withReceipt(req)
}
