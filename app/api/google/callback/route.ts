// Google OAuth callback for Send-to-Drive (P6). Exchanges the auth code for tokens and
// upserts the refresh token into google_tokens keyed by the logged-in user's email.
// Run supabase/migrations/012_google_tokens.sql once before first use.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function page(msg: string): NextResponse {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:90vh;background:#FAF6EF;color:#102A43">'
    + '<div style="text-align:center"><p style="font-size:18px;font-weight:700">' + msg + '</p>'
    + '<p style="font-size:13px;color:#6b7c8d">You can close this window and go back to the report.</p></div>'
    + '<script>try { window.close() } catch (e) {}</script></body></html>'
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
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
  // STORE UNDER THE GOOGLE ACCOUNT THAT ACTUALLY AUTHORIZED, not the app login. The old code keyed
  // the token to whoever was signed into Lighthouse — which made connecting a shared mailbox like
  // support@ impossible, and could silently file support@'s token under jon@. The id_token carries
  // the authorized account's email (we ask for the openid+email scopes); decode it, key on that.
  // Fallback to the app login only when the id_token is absent (older consent screens).
  let googleEmail = ''
  try {
    const idt = String(d.id_token || '')
    const payload = idt.split('.')[1]
    if (payload) {
      const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
      if (claims && typeof claims.email === 'string') googleEmail = claims.email.trim().toLowerCase()
    }
  } catch { /* fall through to app login */ }
  const storeAs = googleEmail || String(user.email).toLowerCase()
  const wanted = String(sp.get('state') || '').trim().toLowerCase()
  const { error } = await supabaseAdmin().from('google_tokens').upsert({
    user_email: storeAs,
    refresh_token: d.refresh_token,
    updated_at: new Date().toISOString(),
  })
  if (error) return page('Could not save the Google connection (run migration 012_google_tokens.sql?).')
  // If they meant to connect support@ but authorized a personal account, say so — the drafts
  // button would keep failing and nothing on screen would explain why.
  if (wanted && googleEmail && wanted !== googleEmail) {
    return page('Connected ' + googleEmail + ' — but you meant to connect ' + wanted + '. Sign into Google as ' + wanted + ' and connect again.')
  }
  return page('Google connected for ' + storeAs + ' ✓')
}
