// GARDEN REVENUE & DISTRIBUTION (lib/garden/revenue). GET ?from=&to=&ahead=&scope=all|garden|botanica  (&depth=1 → the in-depth report)
//   POST { from, to }  → read that stretch (16 days at most) from Cloudbeds into the mirror, for a period
//                        before the hotel was connected (lib/garden/sync backfillReservations).
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { gardenRevenue } from '@/lib/garden/revenue'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const D = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const gate = await requireGarden('reports', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const sc = sp.get('scope'), scope = sc === 'garden' || sc === 'botanica' ? sc : 'all'
  const from = D.test(sp.get('from') || '') ? sp.get('from')! : undefined, to = D.test(sp.get('to') || '') ? sp.get('to')! : undefined
  try {
    // ?depth=1 → the in-depth report for the period and scope (lib/garden/report-depth).
    if (sp.get('depth') && from && to) { const { gardenDepth } = await import('@/lib/garden/report-depth'); return NextResponse.json({ ok: true, ...(await gardenDepth(from, to >= from ? to : from, scope)) }) }
    return NextResponse.json({ ok: true, ...(await gardenRevenue({ from, to, ahead: Number(sp.get('ahead')) || undefined, scope })) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('reports', 'view')
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  const from = String(b?.from || ''), to = String(b?.to || '')
  if (!D.test(from) || !D.test(to) || to < from) return NextResponse.json({ ok: false, error: 'from and to (YYYY-MM-DD) required' }, { status: 400 })
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 16) return NextResponse.json({ ok: false, error: 'Ask for 16 days at most at a time.' }, { status: 400 })
  try { const { backfillReservations } = await import('@/lib/garden/sync'); return NextResponse.json({ ok: true, ...(await backfillReservations(from, to)) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
