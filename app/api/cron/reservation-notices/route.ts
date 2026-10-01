// KEEP THE RESERVATION-EMAIL DESK FILLED.
//
// A notice that nobody typed in is a building that never gets told, which is exactly how three
// Elser bookings passed unsent in July. This files every upcoming arrival for the switched-on
// properties so the only human job left is pressing send.
//
// BARE PATH ON PURPOSE — a Vercel cron pointed at a path WITH A QUERY STRING never fires (proved
// on the booking feed, which sat 65 minutes stale behind "?only=reservations&fast=1"). Anything
// this route needs to vary must be a default here, not a parameter in vercel.json.
//
// Auth: the scheduler's bearer, or a signed-in admin (lib/cron-auth requireCron).
import { NextRequest, NextResponse } from 'next/server'
import { pullNotices } from '@/lib/reservation-pull'
import { runNoticeDrafts } from '@/lib/notice-drafts'
import { getTaskAutomation } from '@/lib/auto-inspections'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'
import { checkSupportDrafts, sweepSentInGmail, sweepGuestyFlag, closePastArrivals } from '@/lib/support-drafts'

// GMAIL DRAFTS RIDE THIS CRON (2026-09-18). /api/cron/notice-drafts lost its own schedule then
// (and was deleted 2026-09-28). It used to fire at 03:06, 11:06, 15:06, 19:06 and 23:06 UTC; this
// hourly job now runs it in those same five hours, right after the queue it drafts from has been
// refilled. Off by default (Settings → Task automation), exactly-once per notice via
// reservation_notices.draft_created_at, and a failure here never fails the queue fill.
const DRAFT_HOURS_UTC = [3, 11, 15, 19, 23]

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  // The Gmail drafting this cron carries runs only on the scheduler's own call (the bearer), in its
  // five drafting hours — an admin pressing "Run now" refills the desk and nothing more.
  const isCron = gate.viaSecret
  const started = Date.now()
  try {
    // 30 days ahead: far enough that a long-lead booking is on the desk well before its lead-time
    // window opens, short enough that the list stays about today rather than about next quarter.
    const res = await pullNotices(30)
    // SENT IS TRACKED EVERY HOUR (Jon, 2026-10-01: "make sure if sent it's tracked"): the same
    // reconcile the desk runs on open — watched drafts that left Drafts, support@'s Sent folder,
    // Guesty's sent flag, then past arrivals nobody can account for — so a notice sent by hand from
    // the inbox is marked sent whether or not anyone opens the page. Best-effort, never fails the fill.
    let sent: any = undefined
    try {
      const a = await checkSupportDrafts().catch(() => null)
      const g = await sweepGuestyFlag({}).catch(() => null)
      const m = await sweepSentInGmail({}).catch(() => null)
      const past = await closePastArrivals().catch(() => null)
      sent = { drafts: a, guesty: g, gmail: m, pastArrivals: past }
    } catch (e: any) { sent = { error: String(e?.message || e).slice(0, 160) } }
    let drafts: any = undefined
    if (isCron && DRAFT_HOURS_UTC.indexOf(new Date().getUTCHours()) >= 0) {
      try {
        const on = (await getTaskAutomation()).noticeDrafts.enabled
        drafts = on ? await runNoticeDrafts({}) : { skipped: 'notice drafts are off' }
      } catch (e: any) { drafts = { ok: false, error: String(e?.message || e).slice(0, 160) } }
    }
    // An `error` beside ok:true is a configuration note ("no properties are switched on"), not a
    // failure — carried as `note` so the run receipt stays honest in both directions.
    const body: any = { ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started, ...res, sentTracking: sent, ...(drafts !== undefined ? { drafts } : {}) }
    if (body.ok !== false && body.error) { body.note = body.error; delete body.error }
    // A drafting pass that failed (only possible when notice drafts are switched on) fails the run.
    if (drafts && drafts.ok === false) {
      body.ok = false
      body.error = 'notice drafts: ' + String((Array.isArray(drafts.errors) && drafts.errors[0]) || drafts.error || 'failed').slice(0, 200)
    }
    return NextResponse.json(body)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// RECEIPT (2026-09-28): one row per run with the notices filed.
const receipted = withRouteReceipt<NextRequest>('reservation-notices', run, { count: (b) => (typeof b.created === 'number' ? b.created : undefined) })
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
