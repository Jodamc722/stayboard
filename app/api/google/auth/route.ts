// Google OAuth kickoff for Send-to-Drive (P6). Redirects the logged-in team member to
// Google's consent screen with the per-file drive.file scope (least-privilege: the app can
// only see files it creates). Callback stores the refresh token in google_tokens.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID not set in env' }, { status: 500 })
  const host = req.headers.get('host') || ''
  const redirect = 'https://' + host + '/api/google/callback'
  const url = 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirect)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/drive.file')
    + '&access_type=offline'
    + '&prompt=consent'
  return NextResponse.redirect(url)
}
