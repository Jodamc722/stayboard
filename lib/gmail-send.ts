// Send email through the Gmail API using a teammate's stored Google connection.
//
// WHY GMAIL AND NOT A MAIL VENDOR. The company's existing daily financial brief already arrives
// from a plain @stay-hospitality.com Gmail, deliverability inside the domain is a non-issue, and
// the app ALREADY holds Google OAuth refresh tokens (google_tokens, migration 012) for
// Send-to-Drive. Extending that grant with gmail.send means: no DNS records, no new vendor, no
// new secret — one consent click by the mailbox owner.
//
// The refresh token never leaves the server; failures return a reason string, never throw, so a
// broken mailbox can't take down the cron that was trying to use it.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

async function accessTokenFor(email: string): Promise<{ token?: string; error?: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return { error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set' }
  try {
    const { data } = await supabaseAdmin().from('google_tokens').select('refresh_token').eq('user_email', email.toLowerCase()).maybeSingle()
    if (!data?.refresh_token) return { error: `No Google connection for ${email} — connect it (with the Gmail permission) first.` }
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: data.refresh_token, grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    })
    const d: any = await r.json()
    if (!r.ok || !d.access_token) return { error: `Google token refresh failed: ${String(d.error_description || d.error || r.status)}` }
    // If the stored grant predates the Gmail scope, the send below will 403 — the caller surfaces
    // that as "reconnect Google with the Gmail permission".
    return { token: String(d.access_token) }
  } catch (e: any) { return { error: String(e?.message || e) } }
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sendGmail(opts: {
  fromEmail: string           // whose mailbox sends (must have a google_tokens row with gmail.send)
  to: string[]
  subject: string
  html: string
}): Promise<{ ok: boolean; error?: string }> {
  const to = opts.to.map(t => String(t || '').trim()).filter(Boolean)
  if (!to.length) return { ok: false, error: 'no recipients' }
  const { token, error } = await accessTokenFor(opts.fromEmail)
  if (!token) return { ok: false, error }
  // RFC822 with an HTML body. Gmail sets From to the authenticated mailbox itself.
  const msg =
    `To: ${to.join(', ')}\r\n` +
    `Subject: ${opts.subject.replace(/[\r\n]+/g, ' ')}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset="UTF-8"\r\n\r\n` +
    opts.html
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(msg) }),
      cache: 'no-store',
    })
    if (r.ok) return { ok: true }
    const body = await r.text().catch(() => '')
    // Two very different 403s: scope missing on the TOKEN vs Gmail API disabled on the PROJECT.
    // Never collapse them — the fix for each is different and misdiagnosis costs a day.
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
      return { ok: false, error: 'The Google connection has no Gmail permission — reconnect Google (it will ask for "Send email on your behalf").' }
    }
    if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(body)) {
      const m = body.match(/https:\/\/console\.developers\.google\.com[^"\\\s]*/)
      return { ok: false, error: 'The Gmail API is not enabled on the Google Cloud project — enable it' + (m ? ' at ' + m[0] : ' (APIs & Services → Library → Gmail API → Enable)') + ', wait a minute, then retry.' }
    }
    return { ok: false, error: `Gmail send failed (${r.status}): ${body.slice(0, 300)}` }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}
