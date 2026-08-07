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
    const monthKey = /^\d{4}-\d{2}$/.test(month) ? month : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
    const [data, rates, def, reviews] = await Promise.all([
      billingMonth(month),
      getSetting<Record<string, number>>('labor_cost_rates', {}),
      getSetting<{ rate: number }>('billing_default_rate', { rate: 40 }),
      getSetting<Record<string, { by: string; at: string }>>('billing_review:' + monthKey, {}),
    ])
    const defaultRate = Number(def?.rate)
    return NextResponse.json({ ok: true, month: monthKey, ...data, laborRates: rates, defaultRate: Number.isFinite(defaultRate) ? defaultRate : 40, reviews })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
