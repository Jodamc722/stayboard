import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { runSyncAlert } from '@/lib/slack-alerts'

export const dynamic = 'force-dynamic'
// 2026-08-20: this was 30 — the LOWEST maxDuration of any cron in the app, set back when the
// route did two trivial queries. On 08-19 it gained the review-content pulse and the Slack
// outbox path, and every run since has hit FUNCTION_INVOCATION_TIMEOUT. The one job whose
// entire purpose is to notice a dead feed was itself dead, silently, and by design nothing was
// watching it. 60 matches the other Slack-posting crons.
export const maxDuration = 60

// SYNC WATCHDOG.
//
// The failure that started this: the Guesty cron had been rejected on every run for weeks and
// nothing said so. A board that is quietly frozen looks exactly like a quiet day. So one job now
// does nothing but ask "did each feed actually run?" and says so out loud when the answer is no.
//
// It alerts at most once every 6 hours per feed, and posts a single recovery line when a feed comes
// back, so a broken sync cannot turn into background noise people learn to ignore.

type Feed = { key: string; label: string; maxMin: number }
const FEEDS: Feed[] = [
  { key: 'reservations', label: 'Bookings (Guesty)', maxMin: 20 },   // pulls every 5 min
  { key: 'listings', label: 'Listings (Guesty)', maxMin: 24 * 60 },
  { key: 'reviews', label: 'Reviews (Guesty)', maxMin: 24 * 60 },
  { key: 'breezeway_tasks', label: 'Tasks (Breezeway)', maxMin: 60 }, // pulls every 15 min
  // Not a job — a data pulse. Fires when NO new review has arrived in 4 days even though the sync
  // itself is green, which at this portfolio's ~8-reviews/day baseline means the channel feed into
  // Guesty (usually Airbnb) has stalled, not us.
  { key: 'reviews_content', label: 'New guest reviews (none arriving — check Guesty’s channel connections, likely Airbnb)', maxMin: 4 * 24 * 60 },
]
const ALERT_KEY = 'sync_watchdog_state'
const REALERT_MIN = 6 * 60

function minsSince(iso: any): number | null {
  const t = new Date(String(iso || '')).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}
function human(m: number | null): string { return m == null ? 'never' : m < 90 ? m + ' min' : Math.round(m / 60) + ' h' }

// A health check must never die because the thing it notifies is slow. Slack gets a hard budget;
// if it overruns, the feed verdict below still comes back and the response says Slack was the
// part that failed. Losing the alert is bad. Losing the diagnosis as well is how you end up not
// knowing anything is wrong for a day.
const SLACK_BUDGET_MS = 20_000
function withBudget<T>(work: Promise<T>, ms: number, whenLate: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const late = new Promise<T>(resolve => { timer = setTimeout(() => resolve(whenLate), ms) })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}


async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const db = supabaseAdmin()
  const [gs, bz] = await Promise.all([
    db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(50),
    db.from('breezeway_tasks_sync').select('synced_at').order('synced_at', { ascending: false }).limit(1),
  ])
  const ages: Record<string, { age: number | null; error: string | null }> = {}
  for (const r of ((gs.data || []) as any[])) {
    ages[String(r.entity)] = { age: minsSince(r.last_sync_at), error: String(r.last_error || '') || null }
  }
  ages['breezeway_tasks'] = { age: minsSince(((bz.data || []) as any[])[0]?.synced_at), error: null }

  // CONTENT FRESHNESS, not just cadence (Jon, 2026-08-19: "make sure reviews are populating").
  // The Aug-2026 incident: the review sync ran perfectly every 2 hours — and mirrored a Guesty
  // that had stopped receiving Airbnb reviews around Aug 14. "Did the job run" was green while
  // the data quietly starved. So the watchdog now also asks "did anything NEW actually arrive":
  // the newest review's own date, at roughly 8/day baseline, going 4+ days silent is an upstream
  // problem (usually the Guesty↔channel connection), and someone should hear about it.
  try {
    const { data: nr } = await db.from('guesty_reviews').select('created_at').order('created_at', { ascending: false }).limit(1)
    ages['reviews_content'] = { age: minsSince(((nr || []) as any[])[0]?.created_at), error: null }
  } catch { ages['reviews_content'] = { age: null, error: null } }

  const state = await getSetting<Record<string, { since: string; alertedAt: string }>>(ALERT_KEY, {})
  const next: Record<string, { since: string; alertedAt: string }> = {}
  const nowIso = new Date().toISOString()
  const alerts: string[] = []
  const recovered: string[] = []
  const report: any[] = []

  for (const f of FEEDS) {
    const a = ages[f.key] || { age: null, error: null }
    const bad = a.age == null || a.age > f.maxMin || !!a.error
    report.push({ feed: f.key, ageMin: a.age, limit: f.maxMin, error: a.error, healthy: !bad })
    const prev = state[f.key]
    if (bad) {
      const since = prev?.since || nowIso
      const lastAlert = prev?.alertedAt ? minsSince(prev.alertedAt) : null
      const due = lastAlert == null || lastAlert >= REALERT_MIN
      next[f.key] = { since, alertedAt: due ? nowIso : (prev?.alertedAt || nowIso) }
      if (due) {
        alerts.push('*' + f.label + '* has not run for ' + human(a.age) +
          ' (limit ' + human(f.maxMin) + ')' + (a.error ? ' — error: ' + a.error.slice(0, 140) : '') + '.')
      }
    } else if (prev) {
      recovered.push('*' + f.label + '* is running again (last run ' + human(a.age) + ' ago).')
    }
  }

  // Goes through the Slack outbox, not a raw webhook: it lands in the right channel, gets a copy
  // in the firehose, and shows in Command Center. This is the ONE alert that never waits for
  // approval — a dead feed is not a judgement call (lib/slack-rules, events.sync.approval=false).
  let slack: any = 'not-needed'
  if (alerts.length || recovered.length) {
    slack = await withBudget(
      runSyncAlert(alerts, recovered).catch((e: any) => ({ error: String(e && e.message) })),
      SLACK_BUDGET_MS,
      { error: 'slack did not answer within ' + (SLACK_BUDGET_MS / 1000) + 's — the feed verdict below is still accurate' },
    )
  }
  try { await setSetting(ALERT_KEY, next, 'watchdog') } catch {}

  return NextResponse.json({
    ranAt: nowIso, healthy: !alerts.length && !Object.keys(next).length,
    feeds: report, alerts, recovered, slack,
    hint: slack && slack.reason ? String(slack.reason) : undefined,
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
