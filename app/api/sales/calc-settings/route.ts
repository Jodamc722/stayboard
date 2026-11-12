// The projections calculator's adjustments, edited on Sales → Projections library → Calculator.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getSettingFresh, setSetting } from '@/lib/app-settings'
import { normProjCalc, PROJ_CALC_KEY, DEFAULT_PROJ_CALC } from '@/lib/projection-calc'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireLevel('sales', 'view')
  if (!g.ok) return g.res
  return NextResponse.json({ ok: true, settings: normProjCalc(await getSettingFresh<any>(PROJ_CALC_KEY, null)), defaults: DEFAULT_PROJ_CALC })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('sales', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const s = normProjCalc(b?.settings)
  s.updatedAt = new Date().toISOString(); s.updatedBy = g.access.email || undefined
  const w = await setSetting(PROJ_CALC_KEY, s, g.access.email || null)
  return w.ok ? NextResponse.json({ ok: true, settings: s }) : NextResponse.json({ ok: false, error: w.error || 'Could not save.' }, { status: 500 })
}
