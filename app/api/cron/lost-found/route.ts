// READ THE LOST-AND-FOUND SLACK CHANNEL EVERY 15 MINUTES (lib/lost-found-slack). New posts only;
// each find becomes a row on /lost-found. BARE PATH ON PURPOSE — a Vercel cron pointed at a path
// with a query string never fires.
import { NextRequest, NextResponse } from 'next/server'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { scanLostFound } from '@/lib/lost-found-slack'
import { syncSent } from '@/lib/lost-found-pay'
import { autoToss } from '@/lib/lost-found-cleanup'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const r = await scanLostFound()
  // Delivery tasks completed in Breezeway → the item shows Sent (lib/lost-found-pay).
  let sent = 0
  try { sent = await syncSent() } catch { /* next run */ }
  // 30 days, not collected or requested → Discarded (lib/lost-found-cleanup).
  let tossed = 0
  try { tossed = await autoToss() } catch { /* next run */ }
  return NextResponse.json({ ok: r.ok, count: r.added, sent, tossed, ...(r.error ? { error: r.error } : {}) })
}
const receipted = withRouteReceipt('lost-found', run)
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
