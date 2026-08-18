// app/api/labor/plan/route.ts — the margin-first staffing plan for a Sunday-start week.
//
//   GET /api/labor/plan                     -> this week
//   GET /api/labor/plan?weekStart=YYYY-MM-DD -> that week (snapped to its Sunday)
//
// Dollar amounts are gated exactly like the labor board: the owner (and anyone switched on at
// /users -> Dollar amounts) sees revenue and payroll; everyone else gets hours, clean counts and
// margin percentages — enough to build the schedule, nothing priced. Redaction happens here on
// the server so the dollars never reach the client at all.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, canSeeMoney } from '@/lib/access'
import { buildWeekPlan } from '@/lib/labor-plan'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const showMoney = canSeeMoney(access)
  try {
    const ws = req.nextUrl.searchParams.get('weekStart') || undefined
    const plan = await buildWeekPlan(ws)
    if (showMoney) return NextResponse.json({ ...plan, moneyHidden: false })
    // Strip every dollar figure; keep hours, counts and percentages.
    const days = plan.days.map(d => ({
      ...d,
      revenue: null, scheduledPayroll: null,
      byMarket: d.byMarket.map(m => ({ ...m, revenue: null })),
    }))
    const totals = { ...plan.totals, revenue: null as any, scheduledPayroll: null as any }
    const redactedMarkets: Record<string, any> = {}
    for (const k of Object.keys(plan.calibration.markets)) {
      const m: any = (plan.calibration.markets as any)[k]
      redactedMarkets[k] = { ...m, feePerClean: null, wage: null }
    }
    const calibration = { ...plan.calibration, markets: redactedMarkets }
    return NextResponse.json({ ...plan, days, totals, calibration, moneyHidden: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
