// OUR HOMES AGAINST THE MARKET — GET /api/reports/edge?market=Miami
// The sales deck's "why owners switch" slide. See lib/sales-edge for the two populations and why
// each is the one it is.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { etToday } from '@/lib/owner-report'
import { measureEdge } from '@/lib/sales-edge'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reports', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const market = String(sp.get('market') || '').trim()
  const toIn = String(sp.get('to') || '')
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toIn) ? toIn : etToday()
  if (!market) return NextResponse.json({ error: 'Which market? Pass ?market=Miami or ?market=Broward.' }, { status: 400 })
  const edge = await measureEdge({ market, to })
  if (!edge) return NextResponse.json({ error: 'No published benchmark for ' + market + ' yet — Miami and Broward only.' }, { status: 404 })
  return NextResponse.json({ ok: true, ...edge })
}
