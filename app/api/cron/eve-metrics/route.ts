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
import { recordRun } from '@/lib/automation-runs'
import { cronAllowed, tooSoon } from '@/lib/cron-auth'
import { isSuperadmin } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  // AUTH (fixed 2026-08-26). This used to be: bearer-or-a-logged-in-session. With CRON_SECRET
  // unset — which it has always been — Vercel's scheduler had no bearer, failed the session check,
  // and got a 401 on every single run. See lib/cron-auth.ts for the whole story.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const viaCron = !!secret && auth === `Bearer ${secret}`
  const allowed = cronAllowed(req)
  let human = false
  // With CRON_SECRET set, a request without the bearer used to stop here, which meant an admin could
  // no longer run this by hand ("Run now") at all. A signed-in admin passes; anyone else still does not.
  if (!allowed.ok) {
    const g = await eveGate()
    const admin = g.ok && (isSuperadmin(g.access.email) || g.access.role === 'admin')
    if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    human = true
  }
  const sp = new URL(req.url).searchParams

  // THREE JOBS ON ONE CRON LINE (2026-09-23). vercel.json is at its cron cap, so this line fires at
  // 07:43, 08:43 and 09:43 UTC and the hour picks the job: baselines first, then the living mind
  // (lib/eve/brain.ts: grade yesterday's calls, tidy beliefs, reflect, make today's calls), then the
  // dossiers (lib/eve/dossiers.ts). An admin can run any of them by hand with ?phase=.
  const hourUtc = new Date().getUTCHours()
  const asked = String(sp.get('phase') || '')
  const phase = ['metrics', 'brain', 'dossiers'].includes(asked) ? asked : hourUtc === 8 ? 'brain' : hourUtc === 9 ? 'dossiers' : 'metrics'
  const job = phase === 'metrics' ? 'eve-metrics' : phase === 'brain' ? 'eve-brain' : 'eve-dossiers'
  if (!allowed.viaSecret && !human) {
    // No secret configured: a signed-in admin runs it on demand, anyone else gets the scheduled
    // cadence and no more.
    const gate = await eveGate()
    human = gate.ok
    if (!human) {
      const skip = await tooSoon(job, 720)
      if (skip) return NextResponse.json({ ok: true, phase, ...skip })
    }
  }
  if (phase !== 'metrics') {
    const t0 = Date.now()
    try {
      const out: any = phase === 'brain'
        ? await (await import('@/lib/eve/brain')).runBrain({ force: human && sp.get('force') === '1' })
        : await (await import('@/lib/eve/dossiers')).buildDossiers()
      const ms = Date.now() - t0
      recordRun({ name: job, ok: out?.ok !== false, itemCount: phase === 'brain' ? (out?.calls?.made ?? undefined) : (out?.written ?? undefined), detail: out, ms })
      return NextResponse.json({ ok: true, phase, ...out, ms })
    } catch (e: any) {
      recordRun({ name: job, ok: false, detail: { error: String(e?.message || e).slice(0, 300) }, ms: Date.now() - t0 })
      return NextResponse.json({ ok: false, phase, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
    }
  }

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
  recordRun({ name: 'eve-metrics', ok: true, itemCount: results?.state?.rows ?? undefined, detail: results, ms: results.ms })
  return NextResponse.json({ ok: true, ...results })
}
