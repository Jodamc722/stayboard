// Daily labor report settings — who gets it, which mailbox sends it, on/off.
// GET: any admin. PUT: owner only, same rule as the ops brief — this decides who receives a daily
// email carrying payroll figures, which is an owner-level control. app_settings key 'labor_daily'.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEY = 'labor_daily'
const OWNER = 'jon@stay-hospitality.com'
const cleanEmails = (v: any): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase())
    .filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 30)

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const s = (await getSetting<any>(KEY, null)) || {}
  return NextResponse.json({
    ok: true,
    config: {
      // Jon asked for this one BY NAME ("send daily labor report to me every morning"), so unlike
      // the team-wide briefs it defaults ON to the owner alone. An explicit false still turns it
      // off, and any recipient list saved here replaces the default.
      enabled: s.enabled !== false,
      fromEmail: typeof s.fromEmail === 'string' && s.fromEmail ? s.fromEmail : OWNER,
      to: cleanEmails(s.to).length ? cleanEmails(s.to) : [OWNER],
    },
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change who receives this report.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const c = body?.config && typeof body.config === 'object' ? body.config : {}
  const config = {
    enabled: c.enabled !== false,
    fromEmail: typeof c.fromEmail === 'string' && /@/.test(c.fromEmail) ? c.fromEmail.trim().toLowerCase() : OWNER,
    to: cleanEmails(c.to),
  }
  const res = await setSetting(KEY, config, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, config })
}
