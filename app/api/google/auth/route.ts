// Google OAuth kickoff — Drive + Gmail for the app's sender mailboxes.
//
// ?mailbox=support@stay-hospitality.com preselects that Google account on the consent screen
// (login_hint) and carries it through state so the callback can warn when somebody authorizes a
// DIFFERENT account than the one they meant to connect. Without a mailbox param it behaves as
// before: connect whatever account you pick.
//
// Scopes: drive.file (Send-to-Drive, least-privilege) + gmail.send (the Morning Ops Brief) +
// gmail.compose (create drafts — the front-desk "Add to drafts" button; compose can draft and
// send as the connected mailbox but still cannot READ any mail) + openid email (so the callback
// knows which Google account actually authorized, instead of guessing).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID not set in env' }, { status: 500 })
  const sp = new URL(req.url).searchParams
  const mailbox = String(sp.get('mailbox') || '').trim().toLowerCase()
  const host = req.headers.get('host') || ''
  const redirect = 'https://' + host + '/api/google/callback'
  let url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose')
    + '&access_type=offline'
    + '&prompt=consent'
  if (mailbox && /@/.test(mailbox)) {
    url += '&login_hint=' + encodeURIComponent(mailbox)
    url += '&state=' + encodeURIComponent(mailbox)
  }
  return NextResponse.redirect(url)
}
