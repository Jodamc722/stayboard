// Step 1 of connecting Slack: send the teammate to Slack to authorise.
//
// We ask for exactly one scope — `incoming-webhook` — which lets Slack show a channel picker and
// hand back a webhook for the ONE channel they choose. We get no ability to read messages, list
// users, or post anywhere else. That is the least this can possibly be and still work.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { pageAllowed } from '@/lib/features'
import { oauthState, slackAppConfigured } from '@/lib/integrations'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user || !access.email) return NextResponse.redirect(new URL('/login', req.url))
  const allowed = isSuperadmin(access.email) || pageAllowed(access.workspace, access.features, 'integrations')
  if (!allowed) return NextResponse.redirect(new URL('/command?slack=forbidden', req.url))

  if (!slackAppConfigured()) {
    return NextResponse.redirect(new URL('/integrations?slack=unconfigured', req.url))
  }

  const redirectUri = `${new URL(req.url).origin}/api/integrations/slack/callback`
  const auth = new URL('https://slack.com/oauth/v2/authorize')
  auth.searchParams.set('client_id', String(process.env.SLACK_CLIENT_ID))
  auth.searchParams.set('scope', 'incoming-webhook')
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('state', oauthState(access.email))
  return NextResponse.redirect(auth.toString())
}
