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

// A raw-message payload can contain non-ASCII bytes (an accented guest name in the HTML). We keep
// the raw string as latin1 so every byte survives the final base64url pass unchanged.
function rawToB64url(raw: string): string {
  return Buffer.from(raw, 'latin1').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// RFC 2047 encoded-word for a header value that may contain non-ASCII (e.g. the subject line).
function encodeHeader(s: string): string {
  const v = String(s || '').replace(/[\r\n]+/g, ' ')
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(v)) return v
  return '=?UTF-8?B?' + Buffer.from(v, 'utf8').toString('base64') + '?='
}

// Base64 body wrapped at 76 chars per line, per RFC 2045.
function b64Wrapped(buf: Buffer): string {
  const b = buf.toString('base64')
  const lines: string[] = []
  for (let i = 0; i < b.length; i += 76) lines.push(b.slice(i, i + 76))
  return lines.join('\r\n')
}

let boundarySeq = 0
function boundary(tag: string): string {
  boundarySeq += 1
  return '==_' + tag + '_' + boundarySeq + '_' + Math.random().toString(36).slice(2, 12) + '=='
}

export type GmailAttachment = {
  filename: string
  content: Buffer | Uint8Array
  contentType: string
  contentId?: string   // present -> inline image referenced from the HTML as cid:<contentId>
}

// Build the RFC822 message. HTML-only stays a single text/html part (unchanged wire shape). With
// attachments we nest: multipart/mixed [ multipart/related [ html, inline images ], files... ].
function buildRaw(opts: { to: string[]; cc?: string[]; subject: string; html: string; attachments?: GmailAttachment[] }): string {
  const headTo = `To: ${opts.to.join(', ')}\r\n`
  const cc = (opts.cc || []).map(c => String(c || '').trim()).filter(Boolean)
  const headCc = cc.length ? `Cc: ${cc.join(', ')}\r\n` : ''
  const headSubj = `Subject: ${encodeHeader(opts.subject)}\r\n`
  const atts = (opts.attachments || []).filter(a => a && a.content)

  const htmlPart =
    `Content-Type: text/html; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    b64Wrapped(Buffer.from(opts.html, 'utf8'))

  if (!atts.length) {
    // Base64-encode the HTML so accented characters survive intact.
    return headTo + headCc + headSubj + `MIME-Version: 1.0\r\n` + htmlPart
  }

  const inline: GmailAttachment[] = []
  const files: GmailAttachment[] = []
  for (let i = 0; i < atts.length; i++) { (atts[i].contentId ? inline : files).push(atts[i]) }

  const filePart = (a: GmailAttachment): string => {
    const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)
    const name = String(a.filename || 'attachment').replace(/[\r\n"]+/g, '')
    return (
      `Content-Type: ${a.contentType}; name="${name}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-Disposition: attachment; filename="${name}"\r\n\r\n` +
      b64Wrapped(buf)
    )
  }
  const inlinePart = (a: GmailAttachment): string => {
    const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)
    const name = String(a.filename || 'image').replace(/[\r\n"]+/g, '')
    const cid = String(a.contentId).replace(/[\r\n<>]+/g, '')
    return (
      `Content-Type: ${a.contentType}\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-ID: <${cid}>\r\n` +
      `Content-Disposition: inline; filename="${name}"\r\n\r\n` +
      b64Wrapped(buf)
    )
  }

  // The HTML plus any inline images form a multipart/related unit.
  let relatedBlock: string
  if (inline.length) {
    const relB = boundary('rel')
    let s = `Content-Type: multipart/related; boundary="${relB}"\r\n\r\n`
    s += `--${relB}\r\n` + htmlPart + `\r\n`
    for (let i = 0; i < inline.length; i++) s += `--${relB}\r\n` + inlinePart(inline[i]) + `\r\n`
    s += `--${relB}--`
    relatedBlock = s
  } else {
    relatedBlock = htmlPart
  }

  // If there are no separate file attachments and no inline images, we already returned above.
  // With only inline images we still need a mixed wrapper is unnecessary — related is enough — but
  // keeping a single mixed wrapper for both cases keeps the structure simple and valid.
  const mixB = boundary('mix')
  let body = `MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${mixB}"\r\n\r\n`
  body += `--${mixB}\r\n` + relatedBlock + `\r\n`
  for (let i = 0; i < files.length; i++) body += `--${mixB}\r\n` + filePart(files[i]) + `\r\n`
  body += `--${mixB}--`
  return headTo + headCc + headSubj + body
}

/**
 * Create a DRAFT in the mailbox instead of sending (Jon, 2026-08-18: "auto draft messages for the
 * reservation front desk notices in the inbox the day of arrival"). Same MIME builder as
 * sendGmail; hits /drafts so the message sits in Drafts for a human to review and press send.
 * NOTE: drafts.create needs the gmail.compose scope — if the Google connection was granted
 * send-only, this returns a reconnect message rather than failing cryptically.
 */
export async function draftGmail(opts: {
  fromEmail: string
  to: string[]
  cc?: string[]
  subject: string
  html: string
  attachments?: GmailAttachment[]
}): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  const to = opts.to.map(t => String(t || '').trim()).filter(Boolean)
  const cc = (opts.cc || []).map(t => String(t || '').trim()).filter(Boolean)
  if (!to.length && !cc.length) return { ok: false, error: 'no recipients' }
  const { token, error } = await accessTokenFor(opts.fromEmail)
  if (!token) return { ok: false, error }
  const raw = buildRaw({ to, cc, subject: opts.subject, html: opts.html, attachments: opts.attachments })
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: rawToB64url(raw) } }),
      cache: 'no-store',
    })
    if (r.ok) {
      const j = await r.json().catch(() => ({} as any))
      return { ok: true, draftId: String(j?.id || '') }
    }
    const body = await r.text().catch(() => '')
    if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
      return { ok: false, error: 'The Google connection cannot create drafts — reconnect Google and approve the compose/draft permission.' }
    }
    return { ok: false, error: `Gmail draft failed (${r.status}): ${body.slice(0, 300)}` }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

export async function sendGmail(opts: {
  fromEmail: string           // whose mailbox sends (must have a google_tokens row with gmail.send)
  to: string[]
  cc?: string[]               // carbon-copy recipients (also delivered to; shown as Cc)
  subject: string
  html: string
  attachments?: GmailAttachment[]
}): Promise<{ ok: boolean; error?: string }> {
  const to = opts.to.map(t => String(t || '').trim()).filter(Boolean)
  const cc = (opts.cc || []).map(t => String(t || '').trim()).filter(Boolean)
  if (!to.length && !cc.length) return { ok: false, error: 'no recipients' }
  const { token, error } = await accessTokenFor(opts.fromEmail)
  if (!token) return { ok: false, error }
  const raw = buildRaw({ to, cc, subject: opts.subject, html: opts.html, attachments: opts.attachments })
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawToB64url(raw) }),
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

// ---- Back-compat shims (2026-08-19) -----------------------------------------------------------
// createGmailDraft/checkGmailDraftExists were dropped when this file was rewritten around
// draftGmail/sendGmail, but two callers still import them — app/api/reservation-notices/draft and
// lib/support-drafts — so `next build` has been failing on the type check since that upload, which
// means NOTHING has deployed. These are thin wrappers over the new API, additive only: the new
// names stay the ones to write against, and whoever owns the notices feature can delete these once
// both callers are moved over.
export async function createGmailDraft(opts: {
  fromEmail: string
  to: string[]
  cc?: string[]
  subject: string
  html: string
  attachments?: GmailAttachment[]
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await draftGmail(opts)
  return { ok: r.ok, id: r.draftId, error: r.error }
}

// 'gone' = the draft is no longer in Drafts, which the support-draft sweep reads as "a human sent
// it". Anything we cannot prove (no token, network blip, unexpected status) returns 'unknown' so
// the notice stays on the watch list rather than being falsely stamped as sent.
export async function checkGmailDraftExists(fromEmail: string, draftId: string): Promise<'present' | 'gone' | 'unknown'> {
  const id = String(draftId || '').trim()
  if (!id) return 'unknown'
  const { token } = await accessTokenFor(fromEmail)
  if (!token) return 'unknown'
  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/' + encodeURIComponent(id) + '?format=minimal', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (r.status === 404) return 'gone'
    if (r.ok) return 'present'
    return 'unknown'
  } catch { return 'unknown' }
}
