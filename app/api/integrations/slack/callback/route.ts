// Step 2 of connecting Slack: Slack sends the teammate back here with a one-time code.
//
// We verify the `state` we signed on the way out (so this can't be someone else's redirect aimed at
// this account), exchange the code for the incoming webhook, and store it. The code is single-use
// and the exchange happens server-side, so the webhook URL never touches the browser.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { pageAllowed } from '@/lib/features'
import { oauthStateValid, setSlackConnection, slackAppConfigured } from '@/lib/integrations'

export const dynamic = 'force-dynamic'

const back = (req: NextRequest, status: string) =>
  NextResponse.redirect(new URL('/command?slack=' + encodeURIComponent(status), req.url))

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user || !access.email) return NextResponse.redirect(new URL('/login', req.url))
  const allowed = isSuperadmin(access.email) || pageAllowed(access.workspace, access.features, 'integrations')
  if (!allowed) return back(req, 'forbidden')
  if (!slackAppConfigured()) return back(req, 'unconfigured')

  const sp = new URL(req.url).searchParams
  if (sp.get('error')) return back(req, 'declined')

  const code = sp.get('code') || ''
  const state = sp.get('state') || ''
  if (!code) return back(req, 'nocode')
  // The state must be the one WE signed for THIS signed-in user.
  if (!oauthStateValid(access.email, state)) return back(req, 'badstate')

  try {
    const redirectUri = `${new URL(req.url).origin}/api/integrations/slack/callback`
    const body = new URLSearchParams({
      code,
      client_id: String(process.env.SLACK_CLIENT_ID),
      client_secret: String(process.env.SLACK_CLIENT_SECRET),
      redirect_uri: redirectUri,
    })
    const r = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })
    const j: any = await r.json()
    if (!j?.ok) return back(req, 'exchange_failed')

    const hook = j.incoming_webhook || {}
    if (!hook.url) return back(req, 'no_webhook')

    const res = await setSlackConnection({
      teamName: String(j.team?.name || 'Slack'),
      channel: String(hook.channel || 'channel'),
      webhookUrl: String(hook.url),
      connectedBy: access.email,
      connectedAt: new Date().toISOString(),
    }, access.email)
    if (!res.ok) return back(req, 'save_failed')

    return back(req, 'connected')
  } catch {
    return back(req, 'exchange_failed')
  }
}
