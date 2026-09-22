// WHO MAY ASK EVE A QUESTION IN SLACK — read for the admin screen, owner-only to change.
//
// GET returns the list PLUS the Slack directory, so the screen renders a picker of real people
// rather than asking anyone to paste a raw U… id. Same shape as /api/settings/slack-rules, which
// solved this problem first.
//
// Deciding who may interrogate the company's records in a shared room is not a shared toy, so
// writes are owner-only while reads are open to admins.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getEveAskers, saveEveAskers } from '@/lib/eve/slack-askers'
import { getDirectory, botConnected } from '@/lib/slack'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin' && !isSuperadmin(access.email)) {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  }
  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  const [askers, connected] = await Promise.all([getEveAskers(), botConnected()])
  const dir = connected ? await getDirectory(refresh) : { users: [], channels: [], fetchedAt: '' }
  return NextResponse.json({
    ok: true,
    connected,
    askers,
    // EMPTY MEANS EVERYONE, and the screen has to say so out loud — a list that reads as a
    // restriction while behaving as an open door is how a permission gets misunderstood.
    openToEveryone: askers.slackIds.length + askers.emails.length === 0,
    users: dir.users.map((u: any) => ({ id: u.id, name: u.name, email: u.email, title: u.title })),
    directoryFetchedAt: dir.fetchedAt,
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Owner only.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const askers = await saveEveAskers(body?.askers ?? body, String(access.email || 'owner'))
  return NextResponse.json({
    ok: true, askers,
    openToEveryone: askers.slackIds.length + askers.emails.length === 0,
  })
}
