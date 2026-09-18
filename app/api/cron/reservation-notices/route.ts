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
// Auth matches the other crons: enforce the bearer token when CRON_SECRET is set, otherwise run
// open so the schedule works without extra configuration.
import { NextRequest, NextResponse } from 'next/server'
import { pullNotices } from '@/lib/reservation-pull'
import { runNoticeDrafts } from '@/lib/notice-drafts'
import { getTaskAutomation } from '@/lib/auto-inspections'

// GMAIL DRAFTS RIDE THIS CRON (2026-09-18). vercel.json sits at the 40-cron Pro cap and Eve's
// weekly review needed a line, so /api/cron/notice-drafts lost its own schedule. It used to fire at
// 03:06, 11:06, 15:06, 19:06 and 23:06 UTC; this hourly job now runs it in those same five hours,
// right after the queue it drafts from has been refilled. Off by default (Settings → Task
// automation), exactly-once per notice via reservation_notices.draft_created_at, and a failure
// here never fails the queue fill.
const DRAFT_HOURS_UTC = [3, 11, 15, 19, 23]

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  try {
    // 30 days ahead: far enough that a long-lead booking is on the desk well before its lead-time
    // window opens, short enough that the list stays about today rather than about next quarter.
    const res = await pullNotices(30)
    let drafts: any = undefined
    if (DRAFT_HOURS_UTC.indexOf(new Date().getUTCHours()) >= 0) {
      try {
        const on = (await getTaskAutomation()).noticeDrafts.enabled
        drafts = on ? await runNoticeDrafts({}) : { skipped: 'notice drafts are off' }
      } catch (e: any) { drafts = { ok: false, error: String(e?.message || e).slice(0, 160) } }
    }
    return NextResponse.json({ ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started, ...res, ...(drafts !== undefined ? { drafts } : {}) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
