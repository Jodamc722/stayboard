// WHO TEACHES EVE — the app_settings key `eve_teachers` (Jon, 2026-11-05: "She can learn from any CCS
// agent, she can also learn from Roberto, Karla & Bernadette"). GET → { ok, value: { emails, slackIds,
// names, ccs, ccsRoles }, me: { teacher, tier, maxWeight } }. POST { value } saves it — Jon only,
// because the list decides whose word outranks whose.
import { NextRequest, NextResponse } from 'next/server'
import { eveGate } from '../../agent/route'
import { isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getTeachers, saveTeachers, teacherFor, identityOfAccess, TEACHER_WEIGHT } from '@/lib/eve/teachers'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET() {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const [value, me] = await Promise.all([getTeachers(true), teacherFor(identityOfAccess(gate.access as any)).catch(() => null)])
  return NextResponse.json({ ok: true, value, weights: TEACHER_WEIGHT, canEdit: isSuperadmin(gate.access.email), me: me ? { teacher: me.teacher, tier: me.tier, maxWeight: me.maxWeight } : null })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  if (!isSuperadmin(gate.access.email)) return NextResponse.json({ error: 'Only Jon can change who teaches Eve.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const r = await saveTeachers(body?.value, String(gate.access.email || ''))
  return NextResponse.json(r.ok ? { ok: true, value: r.value } : { error: r.error || 'could not save' }, { status: r.ok ? 200 : 500 })
}
