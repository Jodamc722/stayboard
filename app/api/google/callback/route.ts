// Google OAuth callback for Send-to-Drive (P6). Exchanges the auth code for tokens and
// upserts the refresh token into google_tokens keyed by the logged-in user's email.
// Run supabase/migrations/012_google_tokens.sql once before first use.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function page(msg: string): NextResponse {
  const html = '<!doctype html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;background:#FAF6EF;color:#102A43">'
    + '<div style="text-align:center"><p style="font-size:18px;font-weight:700">' + msg + '</p>'
    + '<p style="font-size:13px;color:#6b7c8d">You can close this window and go back to the report.</p></div>'
    + '<script>try { window.close() } catch (e) {}</script></body></html>'
  return new NextResponse(html, { headers: { 'content-type': 'text/html' } })
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const code = sp.get('code')
  if (!code) return page('Google authorization was cancelled.')
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return page('Google credentials are not configured.')
  const host = req.headers.get('host') || ''
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: 'https://' + host + '/api/google/callback',
    grant_type: 'authorization_code',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok || !d?.refresh_token) return page('Google connection failed — try again.')
  const { error } = await supabaseAdmin().from('google_tokens').upsert({
    user_email: user.email,
    refresh_token: d.refresh_token,
    updated_at: new Date().toISOString(),
  })
  if (error) return page('Could not save the Google connection (run migration 012_google_tokens.sql?).')
  return page('Google Drive connected ✓')
}
