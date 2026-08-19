import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { runSyncAlert } from '@/lib/slack-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
]
const ALERT_KEY = 'sync_watchdog_state'
const REALERT_MIN = 6 * 60

function minsSince(iso: any): number | null {
  const t = new Date(String(iso || '')).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}
function human(m: number | null): string { return m == null ? 'never' : m < 90 ? m + ' min' : Math.round(m / 60) + ' h' }


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

  // A dead feed is not a judgement call, so this is the one alert that skips the approval queue
  // and goes straight out (see lib/slack-rules — events.sync.approval is false by default).
  // It still records a row in slack_outbox, so the Command Center shows it and the firehose
  // channel gets its copy like everything else.
  let slack: any = 'not-needed'
  if (alerts.length || recovered.length) {
    slack = await runSyncAlert(alerts, recovered).catch((e: any) => ({ error: String(e && e.message) }))
  }
  try { await setSetting(ALERT_KEY, next, 'watchdog') } catch {}

  return NextResponse.json({
    ranAt: nowIso, healthy: !alerts.length && !Object.keys(next).length,
    feeds: report, alerts, recovered, slack,
    // If this reports no bot token, nobody is being told — connect Slack from the Command Center.
    hint: slack && slack.reason ? String(slack.reason) : undefined,
  })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
