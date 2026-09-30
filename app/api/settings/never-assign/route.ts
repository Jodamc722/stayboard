// NEVER ASSIGN IN BREEZEWAY — the list of people who must never be handed a Breezeway task
// (owners, office staff). app_settings 'breezeway_never_assign' = { people: [{ name, personId? }] }.
// GET: any admin — the list, plus who each entry matches on Breezeway's roster right now.
// PUT: owner only, same as the rest of Task automation. A name that matches exactly ONE Breezeway
// person is saved with that person's id, so a later spelling change in Breezeway cannot let them back
// through. See lib/never-assign.ts for everywhere the list is enforced.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getNeverAssign, saveNeverAssign, resolveNeverAssign } from '@/lib/never-assign'
import { normNeverAssignList } from '@/lib/never-assign-match'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const people = await getNeverAssign()
  return NextResponse.json({ ok: true, people, resolved: await resolveNeverAssign(people) })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change who is never assigned.' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const body = await req.json().catch(() => ({} as any))
  const list = normNeverAssignList(body?.people ?? body)
  // Pin the id where the roster gives exactly one answer; leave it off where it is ambiguous or
  // missing — the name still blocks, and the panel shows the match count beside it.
  const resolved = await resolveNeverAssign(list)
  const pinned = list.map((e, i) => (e.personId == null && resolved[i]?.matches.length === 1 ? { ...e, personId: resolved[i].matches[0].id } : e))
  const r = await saveNeverAssign(pinned, access.email)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, people: r.people, resolved: await resolveNeverAssign(r.people) })
}
