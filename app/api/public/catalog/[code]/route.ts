// PUBLIC approved-catalog data (Jon, 2026-10-27). The code IS the capability: an unknown code is a
// 404 and nothing else is computed. Read-only — there is no POST here; approving happens signed in.
import { NextRequest, NextResponse } from 'next/server'
import { readShared } from '@/lib/ffe-approved-catalog'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const r = await readShared(String(params.code || ''))
  if (!r) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, catalog: r.catalog, decisions: r.decisions, canEdit: false }, { headers: { 'Cache-Control': 'no-store' } })
}
