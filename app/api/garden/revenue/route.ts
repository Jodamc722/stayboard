// GARDEN REVENUE & DISTRIBUTION (lib/garden/revenue). GET ?from=&to=&ahead=
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { gardenRevenue } from '@/lib/garden/revenue'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const D = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const gate = await requireGarden('reports', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  try {
    return NextResponse.json({ ok: true, ...(await gardenRevenue({ from: D.test(sp.get('from') || '') ? sp.get('from')! : undefined, to: D.test(sp.get('to') || '') ? sp.get('to')! : undefined, ahead: Number(sp.get('ahead')) || undefined })) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}
