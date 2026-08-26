// SYSTEM CHECK — why a settings panel you just filled in is not doing anything.
//
// Jon, 2026-08-26: "we need this to be operated without the need of Claude." A large share of the
// times somebody needed me, the actual problem was not the setting — it was that the feature behind
// the setting had no key, no token, or no table, and NOTHING in the app said so. You could
// configure the Vault all afternoon and every save would 503 because VAULT_KEY was never set on the
// server, and the screen would never mention it.
//
// So this reports, in one place: which server-side secrets are present, which background jobs have
// actually run recently, and which optional tables exist. It answers "is this thing alive?" without
// anyone reading a log or opening Vercel.
//
// IT NEVER RETURNS A SECRET. Every env check is `!!process.env.X` — a boolean and a name, never a
// value. That is deliberate and must stay that way: this endpoint is read by a browser.
import { NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Check = {
  key: string
  label: string
  ok: boolean
  area: string          // which settings panel this powers, so a red row points somewhere
  breaks: string        // what stops working, in the operator's words
  fix: string           // what a human does about it
}

const has = (...names: string[]) => names.every(n => !!process.env[n])

export async function GET() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  const env: Check[] = [
    {
      key: 'vault', label: 'Vault encryption key', ok: has('VAULT_KEY'), area: 'Vault',
      breaks: 'Saving or revealing any stored credential fails. The Vault opens but every write returns an error.',
      fix: 'Generate one with `openssl rand -hex 32`, add it in Vercel as VAULT_KEY, redeploy. Keep a copy somewhere safe — losing it makes existing secrets unreadable.',
    },
    {
      key: 'homebase', label: 'Homebase (timeclock)', ok: has('HOMEBASE_API_KEY', 'HOMEBASE_LOCATION_UUID'), area: 'Labor & billable hours',
      breaks: 'Every hours, labor-cost and payroll number. Billable Hours and the labor brief go blank.',
      fix: 'Homebase → API access. Add HOMEBASE_API_KEY and HOMEBASE_LOCATION_UUID in Vercel, redeploy.',
    },
    {
      key: 'email', label: 'Outbound email', ok: has('RESEND_API_KEY', 'NOTIFY_FROM_EMAIL'), area: 'Morning brief, front-desk notices',
      breaks: 'No email leaves the building — briefs, notices and digests only appear on the in-app bell.',
      fix: 'Verify the domain at resend.com, then add RESEND_API_KEY and NOTIFY_FROM_EMAIL in Vercel and redeploy. Full steps on the Integrations page.',
    },
    {
      key: 'slack', label: 'Slack', ok: has('SLACK_BOT_TOKEN'), area: 'Slack alerts & rules',
      breaks: 'Alerts have nowhere to go and the channel pickers come up empty.',
      fix: 'Connect Slack from the Integrations page, or set SLACK_BOT_TOKEN in Vercel.',
    },
    {
      key: 'ai', label: 'AI (Eve, replies, listing copy)', ok: has('ANTHROPIC_API_KEY'), area: 'Eve, Review voice, Listing AI',
      breaks: 'Eve, review replies, listing copy and every other AI feature return an error.',
      fix: 'Add ANTHROPIC_API_KEY in Vercel and redeploy.',
    },
    {
      key: 'cron', label: 'Scheduled jobs secret', ok: has('CRON_SECRET'), area: 'All automations',
      breaks: 'Nothing breaks outright, but the scheduled jobs are reachable without the shared secret.',
      fix: 'Set CRON_SECRET in Vercel to any long random string and redeploy.',
    },
    {
      key: 'guesty', label: 'Guesty', ok: has('GUESTY_CLIENT_ID', 'GUESTY_CLIENT_SECRET'), area: 'Reservations, calendar',
      breaks: 'Reservations, listings and calendar blocks stop syncing — the whole board goes stale.',
      fix: 'Guesty → integrations → create an API app. Add GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET in Vercel, redeploy.',
    },
    {
      key: 'breezeway', label: 'Breezeway', ok: has('BREEZEWAY_CLIENT_ID', 'BREEZEWAY_CLIENT_SECRET'), area: 'Today in Ops, task automation',
      breaks: 'No tasks, no assignment, no templates. Today in Ops has nothing to show.',
      fix: 'Breezeway → API credentials. Add BREEZEWAY_CLIENT_ID and BREEZEWAY_CLIENT_SECRET in Vercel, redeploy.',
    },
  ]

  // ── DID THE JOBS ACTUALLY RUN? A key being present is not the same as the thing working. ──────
  const db = supabaseAdmin()
  const jobs: Check[] = []
  try {
    const { data } = await db.from('guesty_sync_status').select('entity,last_sync_at').limit(20)
    for (const r of ((data || []) as any[])) {
      const at = r.last_sync_at ? new Date(String(r.last_sync_at)) : null
      const hrs = at ? (Date.now() - at.getTime()) / 3600000 : Infinity
      jobs.push({
        key: 'sync:' + r.entity, label: 'Guesty sync — ' + String(r.entity),
        ok: hrs < 6, area: 'Integrations',
        breaks: at ? 'Last synced ' + Math.round(hrs) + 'h ago. Anything newer than that is missing from every board.' : 'Never synced.',
        fix: 'Check the Guesty credentials above, then re-run the sync from the Integrations page.',
      })
    }
  } catch { /* the table is optional; its absence is not a finding worth shouting about */ }

  // ── REVIEWS, PER CHANNEL. THE ONE THAT ACTUALLY BIT US ──────────────────────────────────────
  //
  // Airbnb is ~78% of every review this portfolio has ever received, and it stopped on 2026-08-14.
  // The sync ran perfectly every two hours the whole time — it was faithfully mirroring a Guesty
  // that had stopped receiving them. "Did the job run" stayed green while the data starved.
  //
  // A per-channel detector was built for exactly this on 2026-08-21 and its Slack alerts were
  // switched off the next day at Jon's request ("get rid of the airbnb review messages"). That was
  // the right call about Slack and it left the finding with nowhere to land. So it lands here, on
  // the screen someone opens when they are asking why something is not working — no new noise in a
  // channel, and no silence either.
  //
  // Per channel, because a portfolio-wide "newest review" is exactly the number that stayed healthy
  // through the outage: Booking.com trickled in one every few days and covered for the silence.
  const reviewChecks: Check[] = []
  try {
    const since = new Date(Date.now() - 60 * 86400000).toISOString()
    const { data } = await db.from('guesty_reviews').select('channel,created_at').gte('created_at', since).limit(4000)
    const newest: Record<string, string> = {}
    for (const r of ((data || []) as any[])) {
      const ch = String(r.channel || 'Other')
      const at = String(r.created_at || '')
      if (at && (!newest[ch] || at > newest[ch])) newest[ch] = at
    }
    for (const ch of Object.keys(newest).sort()) {
      const days = Math.floor((Date.now() - new Date(newest[ch]).getTime()) / 86400000)
      // Airbnb runs daily here; the smaller channels genuinely go quiet for a week without anything
      // being wrong. One bar would either cry wolf on Vrbo or stay silent on Airbnb.
      const limit = /airbnb/i.test(ch) ? 4 : 14
      reviewChecks.push({
        key: 'reviews:' + ch, label: 'Reviews arriving — ' + ch, ok: days <= limit, area: 'Reviews',
        breaks: 'Nothing new from ' + ch + ' for ' + days + ' day' + (days === 1 ? '' : 's') +
          '. The sync is running; the reviews are not reaching Guesty, so nothing downstream of them fires either — no reply drafts, no bad-review inspections.',
        fix: 'Check the ' + ch + ' connection inside Guesty (channel integrations) and compare against the ' + ch +
          ' host dashboard. If reviews exist there and not in Guesty, it is the channel link that needs re-authorising — nothing in this app will fix it.',
      })
    }
    // ── OURS OR THEIRS ────────────────────────────────────────────────────────────────────────
    // The question that took a week to answer in August was whether reviews were missing because
    // Guesty never received them or because we never fetched them. Reading our own table can never
    // answer it — both look identical from here. So ask Guesty for the first page of reviews and
    // compare its newest against ours. It is one API call, and it turns a week of argument into a
    // line of text.
    try {
      const { guestyConfigured, listRecentReviews } = await import('@/lib/guesty')
      if (guestyConfigured()) {
        const theirs = await listRecentReviews(200)
        const theirNewest: Record<string, string> = {}
        for (const r of theirs) {
          const ch = String(r.channel || 'Other')
          const at = String(r.createdAt || '')
          if (at && (!theirNewest[ch] || at > theirNewest[ch])) theirNewest[ch] = at
        }
        for (const ch of Object.keys(theirNewest)) {
          const mine = newest[ch] || ''
          const behind = !mine || theirNewest[ch] > mine
          if (!behind) continue
          const gap = mine
            ? Math.max(0, Math.floor((new Date(theirNewest[ch]).getTime() - new Date(mine).getTime()) / 86400000))
            : null
          reviewChecks.push({
            key: 'reviews:gap:' + ch, label: 'Reviews we have not pulled in — ' + ch, ok: false, area: 'Reviews',
            breaks: 'Guesty already has ' + ch + ' reviews newer than anything in our database' +
              (gap != null ? ' (by about ' + gap + ' day' + (gap === 1 ? '' : 's') + ')' : '') +
              '. This is our sync, not the channel — the reviews arrived and we did not store them.',
            fix: 'Run the review sync now: open /api/cron/sync-reviews while signed in. If it comes back completeSweep:false it ran out of time before finishing; if the gap persists after a complete sweep, send me its output.',
          })
        }
      }
    } catch { /* the comparison is a bonus; never let it take the health screen down */ }

    if (!Object.keys(newest).length) {
      reviewChecks.push({
        key: 'reviews:none', label: 'Reviews arriving', ok: false, area: 'Reviews',
        breaks: 'No review has landed from any channel in 60 days.',
        fix: 'Check the Guesty credentials above, then run a sync from the Integrations page.',
      })
    }
  } catch { /* the table is hand-created; its absence is not a finding worth shouting about */ }

  // ── OPTIONAL TABLES. A missing migration reads as a broken feature to everyone but a developer. ──
  const tables: { t: string; label: string; area: string; breaks: string }[] = [
    { t: 'user_activity', label: 'Activity log table', area: 'Vault → Activity', breaks: 'Per-user activity cannot be recorded or read.' },
    { t: 'app_roles', label: 'Roles table', area: 'Roles', breaks: 'Roles cannot be created or edited; everyone falls back to legacy access.' },
    { t: 'vault_items', label: 'Vault table', area: 'Vault', breaks: 'Stored credentials have nowhere to live.' },
  ]
  const tableChecks: Check[] = []
  await Promise.all(tables.map(async x => {
    try {
      const { error } = await db.from(x.t).select('*', { count: 'exact', head: true }).limit(1)
      const missing = !!error && /does not exist|could not find the table/i.test(String(error.message))
      tableChecks.push({
        key: 'table:' + x.t, label: x.label, ok: !missing, area: x.area,
        breaks: x.breaks,
        fix: 'Run the migration for this table in Supabase (supabase/migrations in the repo), then reload.',
      })
    } catch { /* treat an unknown failure as "not a finding" rather than crying wolf */ }
  }))

  const all = env.concat(jobs).concat(reviewChecks).concat(tableChecks)
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    healthy: all.filter(c => c.ok).length,
    total: all.length,
    checks: all,
  })
}
