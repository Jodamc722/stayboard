// Nightly: snapshot today's baselines, then grade any recommendation that has come due.
//
// AUTH IS DELIBERATELY DUAL. Vercel crons authenticate with CRON_SECRET — which is still unset in
// this project, and is exactly why the owner-statements cron silently 401'd for weeks. So this route
// also accepts a logged-in admin, which means Jon can run it by hand from /eve today and the
// scheduled version starts working the moment he sets the secret. A job that cannot run until an
// env var appears is a job that quietly never runs.
import { NextRequest, NextResponse } from 'next/server'
import { computeRange, computeToday, saveMetrics } from '@/lib/eve/metrics'
import { gradeDue } from '@/lib/eve/recommendations'
import { todayET, shiftDay } from '@/lib/eve/ctx'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const viaCron = !!secret && auth === `Bearer ${secret}`
  if (!viaCron) {
    const gate = await eveGate()
    if (!gate.ok) return gate.res
  }

  const sp = new URL(req.url).searchParams
  const backfill = Math.min(Math.max(Number(sp.get('backfill')) || 0, 0), 365)
  const started = Date.now()
  const today = todayET()
  const results: any = { ranBy: viaCron ? 'cron' : 'admin', today }

  try {
    if (backfill > 0) {
      // One pass over the whole window rather than a query per day — the naive version times out.
      const from = shiftDay(today, -backfill)
      const to = shiftDay(today, -1)
      const rows = await computeRange(from, to)
      const saved = await saveMetrics(rows)
      results.backfill = { from, to, rows: rows.length, ...saved }
    } else {
      // Normal nightly: recompute the last 3 complete days. Late-arriving reviews, finished tasks
      // and cancellations all mutate a day AFTER it ends, so a single-day snapshot goes stale.
      const from = shiftDay(today, -3)
      const to = shiftDay(today, -1)
      const rows = await computeRange(from, to)
      const saved = await saveMetrics(rows)
      results.daily = { from, to, rows: rows.length, ...saved }
    }

    // Point-in-time state can only be captured now.
    const state = await computeToday()
    const savedState = await saveMetrics(state)
    results.state = { rows: state.length, ...savedState }

    // Grade whatever has come due.
    results.grading = await gradeDue(40)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300), results }, { status: 500 })
  }

  results.ms = Date.now() - started
  return NextResponse.json({ ok: true, ...results })
}
