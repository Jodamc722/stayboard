// /api/kpi — the KPI home board. All of the work happens in lib/kpi.ts.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { buildKpi } from '@/lib/kpi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await buildKpi(req.nextUrl.searchParams, access))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 })
  }
}
