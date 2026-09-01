import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { runSyncAlert } from '@/lib/slack-alerts'
import { sendGmail } from '@/lib/gmail-send'

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

type Feed = { key: string; label: string; maxMin: number; silent?: boolean }
type Ages = Record<string, { age: number | null; error: string | null }>
const FEEDS: Feed[] = [
  { key: 'reservations', label: 'Bookings (Guesty)', maxMin: 20 },   // pulls every 5 min
  { key: 'listings', label: 'Listings (Guesty)', maxMin: 24 * 60 },
  { key: 'reviews', label: 'Reviews (Guesty)', maxMin: 24 * 60 },
  { key: 'breezeway_tasks', label: 'Tasks (Breezeway)', maxMin: 60 }, // pulls every 15 min
  // Not a job — a data pulse. Fires when NO new review has arrived in 4 days even though the sync
  // itself is green, which at this portfolio's ~8-reviews/day baseline means the channel feed into
  // Guesty (usually Airbnb) has stalled, not us.
  // SILENT IN SLACK (Jon, 2026-08-22: "get rid of the airbnb review messages"): a stalled review
  // channel is a known, slow-moving upstream problem — repeating it every 6 hours forever teaches
  // people to ignore the channel that also carries real dead-sync alarms. It stays in this
  // route's JSON report (Eve and the boards can read it); it never posts to Slack again.
  { key: 'reviews_content', label: 'New guest reviews (none arriving — check Guesty’s channel connections, likely Airbnb)', maxMin: 4 * 24 * 60, silent: true },
]
const ALERT_KEY = 'sync_watchdog_state'
const REALERT_MIN = 6 * 60

function minsSince(iso: any): number | null {
  const t = new Date(String(iso || '')).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}
function human(m: number | null): string { return m == null ? 'never' : m < 90 ? m + ' min' : Math.round(m / 60) + ' h' }


// PER-CHANNEL REVIEW FRESHNESS — because a portfolio-wide pulse cannot see one channel die.
//
// 2026-08-21: Airbnb, which is 78% of every review this portfolio has ever received, stopped on
// Aug 14. This route reported "healthy" for the whole week, because Booking.com trickled in one
// review every few days and that kept the portfolio-wide newest-review date inside its 4-day
// window. An aggregate is exactly the wrong statistic for spotting one channel going dark: the
// bigger the dead channel, the longer the survivors can hide it.
//
// Each channel is judged against its OWN rate. Roughly: speak up once about six reviews' worth
// of time has passed in silence, never sooner than 3 days and never later than 14. So Airbnb at
// ~10/day is called after 3 quiet days, Vrbo at ~0.5/day gets 11, and a channel too sparse to
// have a rhythm is not guessed about at all.
function staleLimitDays(perDay: number): number {
  return Math.min(14, Math.max(3, Math.ceil(6 / perDay)))
}

async function reviewChannelFeeds(db: any): Promise<{ feeds: Feed[]; ages: Ages }> {
  const feeds: Feed[] = []
  const ages: Ages = {}
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  let rows: any[] = []
  for (let i = 0; i < 4; i++) {   // PostgREST caps ANY single request at 1000 rows — page it.
    const { data, error } = await db.from('guesty_reviews')
      .select('channel,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(i * 1000, i * 1000 + 999)
    if (error) return { feeds, ages }
    rows = rows.concat(data || [])
    if (!data || data.length < 1000) break
  }
  const by: Record<string, { n: number; newest: string }> = {}
  for (const r of rows) {
    const c = String(r.channel || '').trim()
    if (!c) continue
    const at = String(r.created_at || '')
    const cur = (by[c] ||= { n: 0, newest: '' })
    cur.n++
    if (at > cur.newest) cur.newest = at
  }
  for (const [channel, v] of Object.entries(by)) {
    const perDay = v.n / 90
    if (perDay < 0.2) continue    // fewer than one a fortnight: no rhythm to miss
    const limitDays = staleLimitDays(perDay)
    const key = 'reviews_channel:' + channel
    feeds.push({
      key,
      maxMin: limitDays * 24 * 60,
      // silent: tracked and reported, never posted to Slack (Jon, 2026-08-22).
      silent: true,
      label: channel + ' reviews have stopped arriving (normally ~' + perDay.toFixed(1) +
             '/day) — the sync is fine, so check that channel\u2019s connection inside Guesty',
    })
    ages[key] = { age: minsSince(v.newest), error: null }
  }
  return { feeds, ages }
}

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
  const ages: Ages = {}
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

  // ...and the same question asked once per channel, which is the version that actually works.
  const perChannel = await reviewChannelFeeds(db).catch(() => ({ feeds: [] as Feed[], ages: {} as Ages }))
  Object.assign(ages, perChannel.ages)

  const state = await getSetting<Record<string, { since: string; alertedAt: string }>>(ALERT_KEY, {})
  const next: Record<string, { since: string; alertedAt: string }> = {}
  const nowIso = new Date().toISOString()
  const alerts: string[] = []
  const emailAlerts: string[] = []
  const recovered: string[] = []
  const report: any[] = []

  for (const f of FEEDS.concat(perChannel.feeds)) {
    const a = ages[f.key] || { age: null, error: null }
    const bad = a.age == null || a.age > f.maxMin || !!a.error
    report.push({ feed: f.key, ageMin: a.age, limit: f.maxMin, error: a.error, healthy: !bad })
    const prev = state[f.key]
    if (bad) {
      const since = prev?.since || nowIso
      const lastAlert = prev?.alertedAt ? minsSince(prev.alertedAt) : null
      const due = lastAlert == null || lastAlert >= REALERT_MIN
      next[f.key] = { since, alertedAt: due ? nowIso : (prev?.alertedAt || nowIso) }
      if (due && !f.silent) {
        alerts.push('*' + f.label + '* has not run for ' + human(a.age) +
          ' (limit ' + human(f.maxMin) + ')' + (a.error ? ' — error: ' + a.error.slice(0, 140) : '') + '.')
      }
      // SILENT MUST NOT MEAN INVISIBLE (Jon, 2026-09-01: "don't see any Airbnb or VRBO in a
      // while — just want to make sure we are getting the review data"). These feeds were muted
      // out of Slack on 2026-08-22 and that muting removed them from EVERYWHERE — the per-channel
      // review pulse fired for Vrbo days before Jon asked, into a JSON response nobody reads. A
      // quiet channel now sends ONE EMAIL per re-alert window (6h) to the owner instead: off
      // Slack, but never off the record.
      if (due && f.silent) {
        emailAlerts.push(f.label + ' — quiet for ' + human(a.age) + ' (its own limit is ' + human(f.maxMin) + ').')
      }
    } else if (prev && !f.silent) {
      recovered.push('*' + f.label + '* is running again (last run ' + human(a.age) + ' ago).')
    }
  }

  if (emailAlerts.length) {
    const esc = (x: any) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendGmail({
      fromEmail: 'jon@stay-hospitality.com', to: ['jon@stay-hospitality.com'],
      subject: '🔕 Quiet data feeds: ' + emailAlerts.length + ' need a look',
      html: '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;max-width:640px">' +
        '<p style="font-size:14px;line-height:1.6">These feeds are silent-by-design in Slack, but they have been quiet longer than their own normal rhythm allows:</p>' +
        '<ul style="font-size:13px;line-height:1.8">' + emailAlerts.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
        '<p style="font-size:12px;color:#6b7280">Our sync is pulling everything Guesty has (checked on every run) — a quiet review channel almost always means the channel&rsquo;s connection INSIDE Guesty stopped delivering. Guesty &rarr; Integrations &rarr; that channel, or ask Guesty support what happened after the date above. This email repeats at most every 6 hours while the silence lasts.</p></div>',
    }).catch(() => null)
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
