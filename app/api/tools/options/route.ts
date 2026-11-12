// What the projections calculator asks: the amenity and view choices as the sales team has set them
// (labels only; the percentages stay on the server).
import { NextResponse } from 'next/server'
import { getSetting } from '@/lib/app-settings'
import { normProjCalc, PROJ_CALC_KEY } from '@/lib/projection-calc'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = normProjCalc(await getSetting<any>(PROJ_CALC_KEY, null))
  return NextResponse.json({ ok: true, amenities: s.amenities.map(a => ({ key: a.key, label: a.label })), views: (Object.keys(s.viewLabel) as (keyof typeof s.viewLabel)[]).map(k => ({ key: k, label: s.viewLabel[k] })) }, { headers: { 'Cache-Control': 'no-store' } })
}
