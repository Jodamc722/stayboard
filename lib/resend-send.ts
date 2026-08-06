// Minimal Resend sender with attachment + inline-image (cid) support.
// Uses the app's existing email config: RESEND_API_KEY + NOTIFY_FROM_EMAIL. Never throws —
// returns a reason string so a broken mailbox can't take down the verification submit.
import 'server-only'

export type MailAttachment = { filename: string; content: Buffer; contentType?: string; contentId?: string }

export async function sendResendEmail(opts: {
  to: string[]
  subject: string
  html: string
  attachments?: MailAttachment[]
  replyTo?: string
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const key = process.env.RESEND_API_KEY || ''
  const from = process.env.NOTIFY_FROM_EMAIL || ''
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  if (!from) return { ok: false, error: 'NOTIFY_FROM_EMAIL not set' }
  const to = (opts.to || []).map(t => String(t || '').trim()).filter(Boolean)
  if (!to.length) return { ok: false, error: 'no recipients' }
  const body: any = { from, to, subject: opts.subject, html: opts.html }
  if (opts.replyTo) body.reply_to = opts.replyTo
  if (opts.attachments && opts.attachments.length) {
    body.attachments = opts.attachments.map(a => {
      const o: any = { filename: a.filename, content: a.content.toString('base64') }
      if (a.contentType) o.content_type = a.contentType
      if (a.contentId) o.content_id = a.contentId
      return o
    })
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: String((j && (j.message || j.error)) || ('HTTP ' + r.status)) }
    return { ok: true, id: j && j.id }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}
