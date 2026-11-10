// DOES THE BRAIN AGREE WITH REVENUE CENTER? (admin, read-only)
//
// GET /api/brain/reconcile?month=YYYY-MM — guest nights, owner nights and net accommodation for that
// month, per building and in total, from fact_unit_day and from Revenue Center's own rules, with the
// difference and the stays behind the three biggest gaps (lib/brain/reconcile). Defaults to last month.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/access'
import { reconcileMonth } from '@/lib/brain/reconcile'
import { todayET, addDays } from '@/lib/brain/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const lastMonth = addDays(todayET().slice(0, 8) + '01', -1).slice(0, 7)
  const month = String(req.nextUrl.searchParams.get('month') || lastMonth).trim()
  try {
    const r = await reconcileMonth(month)
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: /YYYY-MM|not started/.test(String(e?.message)) ? 400 : 500 })
  }
}
