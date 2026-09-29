// /api/kpi — the KPI home board. All of the work happens in lib/kpi.ts.
//
// CACHED FOR TWO MINUTES (2026-09-28 audit). The board re-read two windows of reservations, Breezeway
// tasks, sentiment and glitches on every load — and on every tab refocus. The cache key is the
// resolved query (window + scope + today's Eastern date, lib/kpi kpiQuery) plus whether the viewer
// sees dollars: the payload is redacted INSIDE the build, so the two money states are two entries
// and a viewer without the money perm can never be served the owner's copy. Tag 'kpi' drops it.
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { getAccess, canSeeMoney } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { buildKpiFor, kpiQuery } from '@/lib/kpi'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cachedKpi = unstable_cache(
  async (query: string, showMoney: boolean) => buildKpiFor(new URLSearchParams(query), showMoney),
  ['kpi-board-v1'], { revalidate: 120, tags: ['kpi'] },
)

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  try {
    return NextResponse.json(await cachedKpi(kpiQuery(req.nextUrl.searchParams), canSeeMoney(access)))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }, { status: 500 })
  }
}
