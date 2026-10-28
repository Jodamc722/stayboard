// A real owner statement for the sales deck, names removed — see lib/sales-statement.
// GET /api/reports/sales-statement?skip=0&bedrooms=2
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { etToday } from '@/lib/owner-report'
import { realStatement } from '@/lib/sales-statement'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reports', 'view')
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const skip = Math.max(0, Number(sp.get('skip')) || 0)
  const brIn = sp.get('bedrooms')
  const bedrooms = brIn != null && brIn !== '' && Number.isFinite(Number(brIn)) ? Number(brIn) : null
  const st = await realStatement({ asOf: etToday(), skip, bedrooms })
  if (!st) return NextResponse.json({ error: 'No completed statement fits yet.' }, { status: 404 })
  return NextResponse.json({ ok: true, statement: st })
}
