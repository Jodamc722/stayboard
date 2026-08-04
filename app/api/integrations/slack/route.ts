// Slack connection: read status, send a test message, disconnect.
//
// GET    → public (secret-free) status + whether a Slack app is configured at all.
// POST   → send a test message, so "is it really working?" is one click, not a four-day outage.
// DELETE → forget the webhook. Also tell the person to remove the app in Slack if they want it gone
//          on that side too — deleting our copy stops us posting, which is the part we control.
import { NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { pageAllowed } from '@/lib/features'
import { getConnections, publicView, postSlack, setSlackConnection, slackAppConfigured } from '@/lib/integrations'

export const dynamic = 'force-dynamic'

async function gate() {
  const access = await getAccess()
  if (!access.user || !access.email) return { err: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access: null }
  const allowed = isSuperadmin(access.email) || pageAllowed(access.workspace, access.features, 'integrations')
  if (!allowed) return { err: NextResponse.json({ error: 'You do not have access to integrations.' }, { status: 403 }), access: null }
  return { err: null, access }
}

export async function GET() {
  const { err, access } = await gate()
  if (err) return err
  const view = publicView(await getConnections())
  return NextResponse.json({ ok: true, appConfigured: slackAppConfigured(), slack: view.slack, you: access!.email })
}

export async function POST() {
  const { err, access } = await gate()
  if (err) return err
  const status = await postSlack(
    `:satellite_antenna: *Lighthouse test* — connection is live. Sent by ${access!.email}.\n` +
    'Sync failures, ops alerts and shared reviews will arrive here.'
  )
  if (status === 'no-webhook') return NextResponse.json({ ok: false, error: 'Slack is not connected yet.' }, { status: 400 })
  if (status === 'failed') return NextResponse.json({ ok: false, error: 'Slack rejected the message. The channel may have been deleted, or the app removed — try reconnecting.' }, { status: 502 })
  return NextResponse.json({ ok: true, sent: true })
}

export async function DELETE() {
  const { err, access } = await gate()
  if (err) return err
  const res = await setSlackConnection(null, access!.email || 'unknown')
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error || 'Could not disconnect.' }, { status: 500 })
  return NextResponse.json({ ok: true, disconnected: true, note: process.env.SLACK_WEBHOOK_URL ? 'A SLACK_WEBHOOK_URL is still set in Vercel, so alerts will keep going there.' : undefined })
}
