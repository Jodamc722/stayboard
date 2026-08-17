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
import { checkSupportDrafts, autoDraftTodaysNotices } from '@/lib/support-drafts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    // AFTER the pull: reconcile Gmail (drafts that were sent mark their notices sent), then
    // auto-draft today's arrivals into support@'s Drafts (Jon, 2026-08-17: "auto draft them for
    // the day of arrival"). Both best-effort — the pull result stands even if Gmail is down.
    const swept = await checkSupportDrafts().catch(() => null)
    const drafts = await autoDraftTodaysNotices().catch(() => null)
    return NextResponse.json({ ranAt: new Date().toISOString(), elapsed_ms: Date.now() - started, ...res, swept, autoDrafts: drafts })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
