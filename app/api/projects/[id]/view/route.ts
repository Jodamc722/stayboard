// HOW I READ THIS BOARD — my own copy, not the board's.
//
// Jon, 2026-09-16, asked who should see a view change: "My view is mine."
//
// WHY THIS IS ITS OWN ROUTE rather than another case in the project's action switch. That switch
// sits behind requireLevel('projects', 'edit'), which is correct for everything in it — those
// actions all change the board. Choosing list-or-board changes nothing anybody else can see, so
// gating it on edit would mean a viewer is stuck with whatever layout the last editor preferred.
// A separate route can ask for 'view' honestly instead of loosening the switch for everyone.
//
// The write is keyed by the caller's own session email and can reach no other row, so "may I see
// this project" is the only question worth asking.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, isSuperadmin } from '@/lib/access'
import { getProject, canSee, saveViewPrefs, getViewPrefs } from '@/lib/projects'

export const dynamic = 'force-dynamic'

async function maySee(id: string, email: string | null, superadmin: boolean) {
  const p = await getProject(id).catch(() => null)
  if (!p) return false
  return canSee(p.members, { email, superadmin }, p.kind)
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '')
  if (!(await maySee(params.id, email, isSuperadmin(email)))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, viewPrefs: await getViewPrefs(params.id, email) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const email = String(g.access.email || '')
  if (!(await maySee(params.id, email, isSuperadmin(email)))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const b = await req.json().catch(() => ({} as any))
  const r = await saveViewPrefs(params.id, email, b?.prefs || {})
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, viewPrefs: r.prefs })
}
