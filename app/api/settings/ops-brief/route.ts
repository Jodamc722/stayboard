// Morning Ops Brief settings — recipients per variant, sender mailbox, on/off.
// GET: any admin. PUT: owner only, same rule as ops presets — this decides who a daily company
// email goes to, which is an owner-level control. Stored in app_settings key 'ops_brief'.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEY = 'ops_brief'
const DEFAULTS = { enabled: false, fromEmail: 'jon@stay-hospitality.com', miami: [] as string[], broward: [] as string[], full: [] as string[] }

const cleanEmails = (v: any): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 30)

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const stored = await getSetting<any>(KEY, null)
  const s = stored && typeof stored === 'object' ? stored : {}
  return NextResponse.json({
    ok: true,
    config: {
      enabled: s.enabled === true,
      fromEmail: typeof s.fromEmail === 'string' && s.fromEmail ? s.fromEmail : DEFAULTS.fromEmail,
      miami: cleanEmails(s.miami), broward: cleanEmails(s.broward), full: cleanEmails(s.full),
      vendors: { botanica: cleanEmails(s.vendors?.botanica), pt: cleanEmails(s.vendors?.pt), north: cleanEmails(s.vendors?.north) },
    },
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change who receives the brief.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const c = body?.config && typeof body.config === 'object' ? body.config : {}
  const config = {
    enabled: c.enabled === true,
    fromEmail: typeof c.fromEmail === 'string' && /@/.test(c.fromEmail) ? c.fromEmail.trim().toLowerCase() : DEFAULTS.fromEmail,
    miami: cleanEmails(c.miami), broward: cleanEmails(c.broward), full: cleanEmails(c.full),
    vendors: { botanica: cleanEmails(c.vendors?.botanica), pt: cleanEmails(c.vendors?.pt), north: cleanEmails(c.vendors?.north) },
  }
  const res = await setSetting(KEY, config, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, config })
}
