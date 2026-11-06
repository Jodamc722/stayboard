// NO-SERVICE BUILDINGS — where Lighthouse never drafts, auto-creates or nags about inspections or
// welcome calls (Jon, 2026-11-06: "We do not need to do any inspections or welcome calls for any
// Botanica units. So don't draft them or auto create them."). The rule lives in lib/no-service.
// Gated like its neighbour /api/settings/task-automation: GET any admin, PUT owner only.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getNoService, saveNoService, NO_SERVICE_DEFAULTS } from '@/lib/no-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  return NextResponse.json({ ok: true, config: await getNoService(), defaults: NO_SERVICE_DEFAULTS })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change this.' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const body = await req.json().catch(() => ({} as any))
  const c = body?.config && typeof body.config === 'object' ? body.config : {}
  // Comma-separated text or an array, either way; an empty list is a real choice and is kept.
  const list = (v: any): string[] => Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : []
  const r = await saveNoService({ inspections: list(c.inspections), welcomeCalls: list(c.welcomeCalls) }, access.email || null)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, config: r.value })
}
