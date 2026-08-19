// Slack alert rules — the editable rulebook behind every message this app sends.
//
// Jon, 2026-08-19: "This should be editable in user settings, ect where we can set rules."
//
// GET returns the rules PLUS the Slack directory (people and channels), because the admin screen
// needs both to render pickers rather than making anyone paste raw Slack ids. Admin reads,
// owner-only writes: these rules decide who gets pinged about what, which is not a shared toy.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSlackRules, saveSlackRules, DEFAULT_RULES, EVENT_LABELS } from '@/lib/slack-rules'
import { getDirectory, whoAmI, botConnected } from '@/lib/slack'
import { KNOWN_BUILDINGS } from '@/lib/segments'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin' && !isSuperadmin(access.email)) {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  }
  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  const [rules, connected] = await Promise.all([getSlackRules(), botConnected()])
  const dir = connected ? await getDirectory(refresh) : { users: [], channels: [], fetchedAt: '' }
  const who = connected ? await whoAmI() : { ok: false, error: 'not connected' }
  return NextResponse.json({
    ok: true,
    connected,
    bot: who,
    rules,
    defaults: DEFAULT_RULES,
    eventLabels: EVENT_LABELS,
    buildings: KNOWN_BUILDINGS.map(b => ({ label: b.label, market: b.market, vendor: b.vendor })),
    users: dir.users.map(u => ({ id: u.id, name: u.name, email: u.email, title: u.title })),
    channels: dir.channels,
    directoryFetchedAt: dir.fetchedAt,
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email) && access.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can change the alert rules.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({} as any))
  const res = await saveSlackRules(body && body.rules, access.email || 'admin')
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save the rules.' }, { status: 500 })
  return NextResponse.json({ ok: true, rules: res.rules })
}
