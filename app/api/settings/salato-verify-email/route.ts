// Salato verification notifications — who gets the completion email (with details, ID/selfie/
// signature images, and the PDF record). Editable in App settings. Stored in app_settings.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'

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
