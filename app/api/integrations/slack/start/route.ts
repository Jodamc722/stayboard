// Step 1 of connecting Slack: send the teammate to Slack to authorise.
//
// SCOPES. This used to ask for `incoming-webhook` alone — one webhook, one channel, no mentions,
// no DMs. Jon asked on 2026-08-19 for per-building channels, tagged cleaners, supervisor DMs and
// an approve-from-Slack flow, none of which a webhook can do, so the install now also requests a
// BOT token. Each scope is here for exactly one reason:
//
//   incoming-webhook   keeps the old single-channel path working, and the picker hands us a
//                      sensible default channel on day one
//   chat:write         post as Lighthouse
//   chat:write.public  ...into a PUBLIC channel without being invited first. PRIVATE channels
//                      still need the bot /invite'd — no scope gets around that
//   users:read         build the people directory, so a cleaner can actually be @-mentioned
//   users:read.email   match a Slack account to a Lighthouse/Homebase person by email
//   im:write           open a DM (supervisor alerts, the approval DM, the personal brief)
//   channels:read      list public channels for the admin picker
//   groups:read        ...and the private ones the bot has been invited to
//
// READ SCOPES ADDED 2026-08-19 (Jon: "do the slack one now") so Eve can actually learn from the
// operational conversation instead of only broadcasting into it:
//
//   channels:history   read messages in PUBLIC channels the bot is in
//   groups:history     read messages in PRIVATE channels the bot has been invited to
//   channels:join      let the bot add itself to a public channel, so the #vr-* channels do not
//                      each need a manual invite. Private ones still do — no scope avoids that.
//
// WHAT IS DELIBERATELY STILL NOT REQUESTED, and why it matters:
//   im:history / mpim:history  — DMs and group DMs. Jon's explicit choice was "their channels only,
//                                NO DMs". A bot token with no im:history is STRUCTURALLY incapable
//                                of reading a direct message, which is a far stronger guarantee than
//                                a policy note saying we won't.
//   search:read                — Slack only honours search.messages on a USER token, and a user
//                                token searches everything that person can see, DMs included. That
//                                is exactly the exposure Jon ruled out, so Eve searches by scanning
//                                the channels the bot is in instead. Slower, strictly bounded.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { pageAllowed } from '@/lib/features'
import { oauthState, slackAppConfigured } from '@/lib/integrations'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'incoming-webhook',
  'chat:write',
  'chat:write.public',
  'users:read',
  'users:read.email',
  'im:write',
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
  'channels:join',
].join(',')

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
  auth.searchParams.set('scope', SCOPES)
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('state', oauthState(access.email))
  return NextResponse.redirect(auth.toString())
}
