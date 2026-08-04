// Connected apps — live status for Slack and outbound email, plus the freshness of every
// background feed. Read-only and deliberately boring: this route NEVER returns a webhook URL,
// an API key, or any other secret. It only answers "is it wired up, and is it working right now".
//
// Access: signed in AND the `integrations` page must be allowed for that user (same gate the nav
// and middleware use), so this can't be read by someone who can't see the page. Setup instructions
// — the part that names environment variables — are owner-only.
import { NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { pageAllowed } from '@/lib/features'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// How stale each feed may get before we call it unhealthy. Mirrors the watchdog's limits.
const FEEDS: { key: string; label: string; maxMin: number }[] = [
  { key: 'reservations', label: 'Bookings (Guesty)', maxMin: 20 },
  { key: 'listings', label: 'Listings (Guesty)', maxMin: 24 * 60 },
  { key: 'reviews', label: 'Reviews (Guesty)', maxMin: 24 * 60 },
  { key: 'conversations', label: 'Messages (Guesty)', maxMin: 24 * 60 },
]

function minsSince(iso: any): number | null {
  const t = new Date(String(iso || '')).getTime()
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const owner = isSuperadmin(access.email)
  if (!owner && !pageAllowed(access.workspace, access.features, 'integrations')) {
    return NextResponse.json({ error: 'You do not have access to integrations.' }, { status: 403 })
  }

  // Presence checks only — the values themselves never leave the server.
  const slackOn = !!process.env.SLACK_WEBHOOK_URL
  const emailKey = process.env.RESEND_API_KEY || ''
  const emailFrom = process.env.NOTIFY_FROM_EMAIL || ''

  let feeds: any[] = []
  try {
    const db = supabaseAdmin()
    const { data } = await db.from('guesty_sync_status').select('entity,last_sync_at,last_error').limit(50)
    const byEntity: Record<string, any> = {}
    for (const r of ((data || []) as any[])) byEntity[String(r.entity)] = r
    feeds = FEEDS.map(f => {
      const r = byEntity[f.key]
      const age = r ? minsSince(r.last_sync_at) : null
      const error = r && r.last_error ? String(r.last_error) : null
      return {
        key: f.key, label: f.label, ageMin: age, limitMin: f.maxMin,
        error: error ? error.slice(0, 300) : null,
        healthy: age != null && age <= f.maxMin && !error,
      }
    })
  } catch {
    feeds = []   // fail-open: a status page must never be the thing that breaks
  }

  return NextResponse.json({
    ok: true,
    owner,
    integrations: [
      {
        key: 'slack',
        label: 'Slack',
        connected: slackOn,
        summary: slackOn
          ? 'Alerts post to your Slack channel.'
          : 'Not connected — sync failures and ops alerts are being generated but nobody is being told.',
        // What already routes here the moment it is connected. No code change needed.
        uses: [
          'Sync watchdog — tells you when a Guesty feed stops updating',
          'Ops behind-schedule alerts — cleans not started against the 4pm deadline',
          'Share a guest review to the team',
        ],
        setup: owner ? {
          envVar: 'SLACK_WEBHOOK_URL',
          steps: [
            'api.slack.com/apps → Create New App → From scratch → pick your workspace',
            'Incoming Webhooks → toggle on → Add New Webhook to Workspace → choose a channel',
            'Copy the https://hooks.slack.com/services/... URL',
            'Vercel → stayboard → Settings → Environment Variables → add SLACK_WEBHOOK_URL → Production → redeploy',
          ],
        } : null,
      },
      {
        key: 'email',
        label: 'Outbound email',
        connected: !!(emailKey && emailFrom),
        summary: (emailKey && emailFrom)
          ? 'Notifications can be delivered by email.'
          : 'Not connected — notifications only appear on the in-app bell. Nothing leaves the building.',
        uses: [
          'Ops alerts to the people who need them, without opening the app',
          'Daily digests (e.g. owner performance to investigate)',
          'Anything that today only lands on the bell icon',
        ],
        setup: owner ? {
          envVar: 'RESEND_API_KEY + NOTIFY_FROM_EMAIL',
          steps: [
            'resend.com → add stay-hospitality.com as a domain',
            'Add the DKIM/SPF DNS records it gives you, then wait for Verified',
            'Create an API key',
            'Vercel → add RESEND_API_KEY and NOTIFY_FROM_EMAIL (e.g. lighthouse@stay-hospitality.com) → redeploy',
          ],
        } : null,
      },
    ],
    feeds,
  })
}
