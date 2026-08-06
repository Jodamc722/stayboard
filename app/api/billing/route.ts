// BILLABLE HOURS board data. GET ?month=YYYY-MM returns the month's tasks with billing detail,
// owner grouping and our adjustment overlay merged in (lib/billing), plus the per-person labor
// cost rates (app_settings 'labor_cost_rates') the Labor tab compares against actual hours.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth } from '@/lib/billing'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const month = String(req.nextUrl.searchParams.get('month') || '').slice(0, 7)
  try {
    const [data, rates] = await Promise.all([
      billingMonth(month),
      getSetting<Record<string, number>>('labor_cost_rates', {}),
    ])
    return NextResponse.json({ ok: true, month, ...data, laborRates: rates })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
