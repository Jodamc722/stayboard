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
import { requireAdmin } from '@/lib/access'
import { GOOGLE_READ_SCOPES } from '@/lib/google-read'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin('admin')
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID not set in env' }, { status: 500 })
  const sp = new URL(req.url).searchParams
  const mailbox = String(sp.get('mailbox') || '').trim().toLowerCase()
  // ?scopes=read — Eve's learning consent (2026-09-18). Adds gmail/drive/calendar READ-ONLY on top
  // of the usual grant, and marks the state so the callback records it. Owner only: this is the
  // company's mail, and only Jon gets to hand it to her.
  const wantRead = sp.get('scopes') === 'read'
  if (wantRead && gate.access.email !== 'jon@stay-hospitality.com') {
    return NextResponse.json({ error: 'forbidden', message: 'Only the owner can grant Eve read access to Google.' }, { status: 403 })
  }
  const host = req.headers.get('host') || ''
  const redirect = 'https://' + host + '/api/google/callback'
  let url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose' + (wantRead ? ' ' + GOOGLE_READ_SCOPES.join(' ') : ''))
    + '&access_type=offline'
    + '&prompt=consent'
  if (wantRead) url += '&include_granted_scopes=true'
  // state carries the intended mailbox and, for the read grant, a marker the callback reads.
  const state = [mailbox && /@/.test(mailbox) ? mailbox : '', wantRead ? 'scopes=read' : ''].filter(Boolean).join(';')
  if (mailbox && /@/.test(mailbox)) url += '&login_hint=' + encodeURIComponent(mailbox)
  if (state) url += '&state=' + encodeURIComponent(state)
  return NextResponse.redirect(url)
}
