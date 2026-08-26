// THE SIDEBAR LAYOUT — read and write.
//
// See lib/nav-layout.ts for the shape and for why this is an override rather than a full copy of
// the nav. This route is deliberately small: it validates, it saves, it never decides anything.
//
// WRITE IS ADMIN. Rearranging the sidebar changes what the whole company sees when they log in, so
// it is not a per-person preference — but it is also not a permission, so it does not need the
// owner. Any admin can do it, and getting it wrong is one click from undone.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { NAV_LAYOUT_KEY, normNavLayout, type NavLayout } from '@/lib/nav-layout'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const layout = await getSetting<any>(NAV_LAYOUT_KEY, null).catch(() => null)
  return NextResponse.json({ ok: true, layout: normNavLayout(layout) })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const layout: NavLayout = normNavLayout(body?.layout)
  layout.updatedAt = new Date().toISOString()
  layout.updatedBy = access.email || null
  const res = await setSetting(NAV_LAYOUT_KEY, layout, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, layout })
}

// Back to the shipped sidebar. Clearing the override is the whole undo — nothing to reconstruct,
// because the defaults were never overwritten in the first place.
export async function DELETE() {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const res = await setSetting(NAV_LAYOUT_KEY, {}, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not reset.' }, { status: 500 })
  return NextResponse.json({ ok: true, layout: {} })
}
