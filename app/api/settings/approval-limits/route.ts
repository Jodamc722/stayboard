// GM pre-auth spend limits — the dollar ceiling under which an order line is approved
// automatically instead of waiting on the owner. Portfolio default plus per-owner overrides.
// Admin reads, owner-only writes: this decides how much money moves without a human looking.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { APPROVAL_LIMITS_KEY, DEFAULT_LIMITS, mergeLimits } from '@/lib/approval'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  const limits = mergeLimits(await getSetting<any>(APPROVAL_LIMITS_KEY, null))
  return NextResponse.json({ ok: true, limits, defaults: DEFAULT_LIMITS })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change spend limits.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const limits = mergeLimits(body && body.limits)
  const r = await setSetting(APPROVAL_LIMITS_KEY, limits, access.email)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save the limits.' }, { status: 500 })
  return NextResponse.json({ ok: true, limits })
}
