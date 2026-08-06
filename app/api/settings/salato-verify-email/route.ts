// Salato verification notifications — who gets the completion email (with details, ID/selfie/
// signature images, and the PDF record). Editable in App settings. Stored in app_settings.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'

export const SALATO_NOTIFY_KEY = 'salato_verify_notify'
type NotifyCfg = { emails: string; enabled: boolean; from?: string; cc?: string }
const DEFAULT_FROM = 'jon@stay-hospitality.com'
const DEFAULT_CFG: NotifyCfg = { emails: '', enabled: true, from: DEFAULT_FROM, cc: '' }

// Split a free-text list ("a@x.com, b@y.com; c@z.com") into clean, de-duped, valid-looking emails.
export function parseEmails(s: string): string[] {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const parts = String(s || '').split(/[,;\s]+/)
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i].trim()
    if (!e) continue
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) continue
    const k = e.toLowerCase()
    if (seen[k]) continue
    seen[k] = true
    out.push(e)
  }
  return out
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const cfg = await getSetting<NotifyCfg>(SALATO_NOTIFY_KEY, DEFAULT_CFG)
  return NextResponse.json({ ok: true, emails: cfg.emails || '', cc: cfg.cc || '', enabled: cfg.enabled !== false, from: cfg.from || DEFAULT_FROM, valid: parseEmails(cfg.emails || ''), validCc: parseEmails(cfg.cc || '') })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  try {
    const body: any = await req.json().catch(() => ({}))

    // "Send test to me" — email a sample verification notice to the signed-in admin only, using the
    // configured Send-from mailbox. Proves the Gmail connection + scope end to end without needing a
    // real guest verification or any recipient configured.
    if (body?.test === true) {
      const cfg = await getSetting<NotifyCfg>(SALATO_NOTIFY_KEY, DEFAULT_CFG)
      const fromEmail = (parseEmails(cfg.from || '')[0]) || DEFAULT_FROM
      const me = String(access.email || '').trim()
      if (!me) return NextResponse.json({ ok: false, error: 'Could not determine your email.' }, { status: 400 })
      const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:560px;margin:0 auto">'
        + '<div style="background:#111827;color:#fff;border-radius:14px;padding:18px 20px;margin-bottom:16px"><div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#fcd34d;font-weight:700">Stay Hospitality</div><div style="font-size:20px;font-weight:800;margin-top:4px">Salato verification — test email</div></div>'
        + '<p style="font-size:14px">This is a test of the Salato verification email pipeline. If you can read this, sending through Gmail works.</p>'
        + '<p style="font-size:13px;color:#6b7280">Sent from <b>' + fromEmail + '</b> to you (' + me + '). Real verification emails also attach the ID, selfie, signature and a PDF record.</p></div>'
      const send = await sendGmail({ fromEmail, to: [me], subject: 'Salato verification — test email', html })
      if (!send.ok) return NextResponse.json({ ok: false, error: send.error || 'Send failed' }, { status: 502 })
      return NextResponse.json({ ok: true, sentTest: true, to: me, from: fromEmail })
    }

    const emails = String(body?.emails == null ? '' : body.emails).slice(0, 1000)
    const cc = String(body?.cc == null ? '' : body.cc).slice(0, 1000)
    const enabled = body?.enabled !== false
    const from = (parseEmails(String(body?.from == null ? '' : body.from))[0]) || DEFAULT_FROM
    const valid = parseEmails(emails)
    const validCc = parseEmails(cc)
    const res = await setSetting(SALATO_NOTIFY_KEY, { emails, enabled, from, cc } as NotifyCfg, access.email || null)
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || 'Could not save' }, { status: 500 })
    return NextResponse.json({ ok: true, emails, cc, enabled, from, valid, validCc })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
