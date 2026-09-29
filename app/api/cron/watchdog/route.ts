import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { runSyncAlert } from '@/lib/slack-alerts'
import { requireCron } from '@/lib/cron-auth'
import { withRouteReceipt } from '@/lib/automation-runs'

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

// title/detail/fix: what a SILENT feed's System health finding says. Absent = the review wording.
type Feed = { key: string; label: string; maxMin: number; silent?: boolean; title?: string; detail?: string; fix?: string }
type Ages = Record<string, { age: number | null; error: string | null }>
const FEEDS: Feed[] = [
  { key: 'reservations', label: 'Bookings (Guesty)', maxMin: 20 },   // pulls every 5 min
  { key: 'listings', label: 'Listings (Guesty)', maxMin: 24 * 60 },
  { key: 'reviews', label: 'Reviews (Guesty)', maxMin: 24 * 60 },
  // Judged from the job's own receipt, not max(synced_at) — see breezewayAge() below.
  { key: 'breezeway_tasks', label: 'Tasks (Breezeway)', maxMin: 60 }, // pulls every 30 min
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
  if (!iso) return null
  const t = new Date(String(iso)).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}
function human(m: number | null): string { return m == null ? 'never' : m < 90 ? m + ' min' : Math.round(m / 60) + ' h' }
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ── MORE FEEDS (2026-09-28 audit #10) ──────────────────────────────────────────────────────────
// This judged four feeds and loaded — then ignored — the rest. The guest conversations and
// messages Eve answers from, the owner ledger, the Revenue App mirror and the Talkroute call feed
// could all stop without a word. Each is added only when its source can be read: a table or
// setting that does not exist yet is skipped silently, never reported as a dead feed. The guest
// feeds are loud (Slack, like bookings and tasks); the back-office ones are silent — they go to
// System health, where a finding stays open until someone deals with it.
async function extraFeeds(db: any, gsRows: any[]): Promise<{ feeds: Feed[]; ages: Ages }> {
  const feeds: Feed[] = []
  const ages: Ages = {}
  const row = (entity: string) => gsRows.find(r => str(r.entity) === entity)

  const conv = row('conversations')
  if (conv) {
    feeds.push({ key: 'conversations', label: 'Guest conversations (Guesty)', maxMin: 60 })   // every 30 min
    ages['conversations'] = { age: minsSince(conv.last_sync_at), error: str(conv.last_error) || null }
  }
  const msg = row('messages')
  if (msg) {
    // "partial: 40/60 conversations in budget" is a run that resumes next time, not an error.
    const err = str(msg.last_error)
    feeds.push({ key: 'messages', label: 'Guest messages (Guesty)', maxMin: 120 })
    ages['messages'] = { age: minsSince(msg.last_sync_at), error: err && !/^partial/i.test(err) ? err : null }
  }
  const cf = row('custom_fields')
  if (cf) {
    feeds.push({
      key: 'custom_fields', label: 'Guesty custom fields', maxMin: 26 * 60, silent: true,
      title: 'Guesty custom fields have not synced in over a day',
      detail: 'The field definitions door codes, welcome calls and order links are written through are refreshed by the twice-daily catalog sync (/api/cron/guesty-catalog).',
      fix: 'Run /api/cron/guesty-catalog while signed in as an admin and read its errors.',
    })
    ages['custom_fields'] = { age: minsSince(cf.last_sync_at), error: str(cf.last_error) || null }
  }

  // The owner ledger's CURRENT month — what the Owner Audit tie-out reads during the month.
  try {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
    const { data, error } = await db.from('guesty_ledger_months').select('status,last_error,updated_at').eq('month', month).maybeSingle()
    if (!error && data) {
      const err = str(data.last_error)
      feeds.push({
        key: 'owner_ledger', label: 'Owner ledger (Guesty accounting)', maxMin: 26 * 60, silent: true,
        title: 'The owner ledger has not synced in over a day',
        detail: 'The current month of Guesty owner-ledger rows (guesty_ledger_months ' + month + ') has not been touched by the twice-daily sweep, so the Owner Audit tie-out is reading an old copy.',
        fix: 'Run /api/sync/owner-statements while signed in as an admin; its swept[] says which month failed and why.',
      })
      // A sweep that paused at its deadline ('deadline reached at skip=N') resumes; not an error.
      ages['owner_ledger'] = { age: minsSince(data.updated_at), error: str(data.status) === 'error' && err && !/deadline reached/i.test(err) ? err : null }
    }
  } catch { /* table not there — skip */ }

  // The boss's Revenue App mirror (every 4h). The newest feed that came back OK.
  try {
    const { data, error } = await db.from('rev_sync_status').select('feed,last_ok_at').limit(50)
    if (!error && Array.isArray(data) && data.length) {
      let newest = ''
      for (const r of data as any[]) { const t = str(r.last_ok_at); if (t > newest) newest = t }
      feeds.push({
        key: 'revenue_app', label: 'Revenue App mirror', maxMin: 8 * 60, silent: true,
        title: 'The Revenue App mirror has not synced in over 8 hours',
        detail: 'No Revenue App feed has come back OK recently, so revenue, budget and projections on /revenue are an old copy (they override our own numbers everywhere).',
        fix: 'Open /revenue/reconcile and press Sync now; the per-feed status says which feed is failing.',
      })
      ages['revenue_app'] = { age: minsSince(newest || null), error: null }
    }
  } catch { /* table not there — skip */ }

  // Talkroute calls (the Calls desk's proof a welcome call happened). Only when connected.
  try {
    const { talkrouteConfigured, getTalkrouteSettings } = await import('@/lib/talkroute')
    if (await talkrouteConfigured()) {
      const s = await getTalkrouteSettings()
      feeds.push({
        key: 'talkroute_calls', label: 'Phone calls (Talkroute)', maxMin: 60, silent: true,
        title: 'Talkroute calls have not synced in over an hour',
        detail: 'The call feed that completes welcome calls on the Calls desk has not finished a sync' + (s.lastError ? ' (last error: ' + str(s.lastError).slice(0, 160) + ')' : '') + '.',
        fix: 'Check the Talkroute key on Users & admin → Talkroute, then run /api/cron/talkroute while signed in as an admin.',
      })
      ages['talkroute_calls'] = { age: minsSince(s.lastCallSyncAt), error: null }
    }
  } catch { /* not connected / settings unreadable — skip */ }

  return { feeds, ages }
}

// BREEZEWAY FROM ITS RECEIPT, NOT FROM max(synced_at). The nightly billing-detail job rewrites
// synced_at and the webhook keeps writing rows, so a dead 30-minute poller could look fresh for
// hours. The question is "did a run finish and write something": the newest breezeway-tasks
// receipt that is ok with item_count > 0. Falls back to the mirror while no receipt can be read.
async function breezewayAge(db: any): Promise<{ age: number | null; error: string | null }> {
  try {
    const [good, last] = await Promise.all([
      db.from('automation_runs').select('ran_at').eq('name', 'breezeway-tasks').eq('ok', true).gt('item_count', 0)
        .order('ran_at', { ascending: false }).limit(1),
      db.from('automation_runs').select('ran_at,ok,error').eq('name', 'breezeway-tasks')
        .order('ran_at', { ascending: false }).limit(1),
    ])
    if (!good.error && !last.error) {
      const g = ((good.data || []) as any[])[0]
      const l = ((last.data || []) as any[])[0]
      const age = minsSince(g && g.ran_at)
      // The last run's error only explains a stale feed; one failed run inside the window is not
      // itself a dead feed.
      const stale = age == null || age > 60
      return { age, error: stale && l && l.ok === false ? (str(l.error) || 'the last run failed') : null }
    }
  } catch { /* fall back */ }
  const { data } = await db.from('breezeway_tasks_sync').select('synced_at').order('synced_at', { ascending: false }).limit(1)
  return { age: minsSince(((data || []) as any[])[0]?.synced_at), error: null }
}


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
  const gate = await requireCron(req)
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  const [gs, bz] = await Promise.all([
    db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(50),
    breezewayAge(db),
  ])
  const ages: Ages = {}
  const gsRows = (gs.data || []) as any[]
  for (const r of gsRows) {
    ages[String(r.entity)] = { age: minsSince(r.last_sync_at), error: String(r.last_error || '') || null }
  }
  ages['breezeway_tasks'] = bz
  const extra = await extraFeeds(db, gsRows).catch(() => ({ feeds: [] as Feed[], ages: {} as Ages }))
  Object.assign(ages, extra.ages)

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
  /** Quiet silent-feed findings for the System health tab. */
  const quiet: { key: string; label: string; line: string; title?: string; detail?: string; fix?: string }[] = []
  const recovered: string[] = []
  const report: any[] = []
  const allFeeds = FEEDS.concat(extra.feeds, perChannel.feeds)

  for (const f of allFeeds) {
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
      // out of Slack on 2026-08-22 and that muting removed them from EVERYWHERE.
      //
      // The fix then was an email every six hours. Jon, 2026-09-15: "let's kill the emails that
      // are not briefs ... have a tab in the app that shares some of that performance." He is
      // right — a repeating email about a data feed is a notification that trains you to archive
      // it, and by the third one it has stopped being information. It goes to the System health
      // tab instead, where it sits open until somebody actually deals with it, and where it is
      // still there next week if nobody did. Off Slack, out of the inbox, still never off the
      // record.
      if (f.silent && (a.age == null || a.age > f.maxMin)) {
        quiet.push({
          key: f.key,
          label: f.label,
          line: f.label + ' — quiet for ' + human(a.age) + ' (its own limit is ' + human(f.maxMin) + ').',
          title: f.title, detail: f.detail, fix: f.fix,
        })
      }
    } else if (prev && !f.silent) {
      recovered.push('*' + f.label + '* is running again (last run ' + human(a.age) + ' ago).')
    }
  }

  // The findings, written where they can be seen and acted on. `ext:` marks them as owned by this
  // cron rather than by runAudit, so the daily audit does not resolve them out from under us.
  try {
    const db = supabaseAdmin()
    const nowStamp = new Date().toISOString()
    if (quiet.length) {
      await db.from('eve_audits').upsert(quiet.map(q => ({
        id: 'ext:feed:' + q.key,
        area: 'pipeline',
        severity: 'warn',
        title: q.title || (q.label + ' has stopped arriving'),
        detail: q.detail ? q.line + ' ' + q.detail : q.line + ' Our sync pulls everything Guesty has on every run, so a quiet review channel'
          + " almost always means that channel's connection INSIDE Guesty stopped delivering.",
        fix: q.fix || 'Guesty → Integrations → that channel, or ask Guesty support what happened after the date above.',
        count: 1,
        status: 'open',
        last_seen_at: nowStamp,
      })), { onConflict: 'id' })
    }
    // A feed that started talking again closes its own finding. Nothing else will.
    const quietIds = new Set(quiet.map(q => 'ext:feed:' + q.key))
    const allSilent = allFeeds.filter(f => f.silent).map(f => 'ext:feed:' + f.key)
    const healed = allSilent.filter(id => !quietIds.has(id))
    if (healed.length) {
      await db.from('eve_audits').update({ status: 'resolved', resolved_at: nowStamp })
        .in('id', healed).eq('status', 'open')
    }
  } catch { /* the watchdog must never fail on its own reporting */ }

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

// ITS OWN RECEIPT (2026-09-28). The one job that notices dead jobs was itself dead from 08-19 to
// 08-20 and nothing could say so. Now every run is recorded; itemCount = feeds judged unhealthy.
const receipted = withRouteReceipt<NextRequest>('watchdog', run, {
  count: (b) => (Array.isArray(b.feeds) ? b.feeds.filter((f: any) => f && f.healthy === false).length : undefined),
})
export async function GET(req: NextRequest) { return receipted(req) }
export async function POST(req: NextRequest) { return receipted(req) }
