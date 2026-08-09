// BILLABLE HOURS board data. GET ?month=YYYY-MM returns the month's tasks with billing detail,
// owner grouping and our adjustment overlay merged in (lib/billing), plus the per-person labor
// cost rates (app_settings 'labor_cost_rates') the Labor tab compares against actual hours.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth, listingNames, monthRange } from '@/lib/billing'
import { getTimecards } from '@/lib/homebase-labor'
import { getSetting } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
    // Unit list for "Add task" — every active Breezeway property (a new task must exist there).
    let units: { id: string; name: string }[] = []
    try {
      const { data: props } = await supabaseAdmin().from('breezeway_properties')
        .select('reference_property_id, status').limit(1000)
      const ids = ((props || []) as any[])
        .filter(p => String(p.status || '').toLowerCase() === 'active')
        .map(p => String(p.reference_property_id || '')).filter(Boolean)
      const names = await listingNames(ids)
      units = ids.map(id => ({ id, name: (names[id] && names[id].unit) || id })).sort((a, b) => a.name.localeCompare(b.name))
    } catch { /* Add-task select just stays empty */ }
    // MAINTENANCE PAYROLL FOR THE MONTH (Jon, 2026-08-09: "make sure payroll for maintenance is
    // also pulled and displayed on billable review"). Billable answers what the OWNER pays us;
    // this answers what the WORK cost us, so the review screen can show the margin instead of only
    // one side of it. Homebase is the source — Breezeway carries no pay. Best-effort: if Homebase
    // is unreachable the board renders exactly as before, just without the cost column.
    let maintenancePayroll: { cost: number; hours: number; people: number; source: string } | null = null
    try {
      const { from, to } = monthRange(monthKey)
      const tc = await getTimecards(from, to)
      const isMaint = (r: any) => /maint|tech|repair|handy/i.test(String(r || ''))
      const mine = tc.filter((t: any) => isMaint(t.role))
      if (mine.length) {
        maintenancePayroll = {
          cost: Math.round(mine.reduce((a: number, t: any) => a + (Number(t.laborCost) || 0), 0) * 100) / 100,
          hours: Math.round(mine.reduce((a: number, t: any) => a + (Number(t.hours) || 0), 0) * 10) / 10,
          people: new Set(mine.map((t: any) => String(t.name))).size,
          source: 'Homebase clocked payroll',
        }
      }
    } catch { /* payroll column simply absent */ }
    return NextResponse.json({ ok: true, month: monthKey, ...data, laborRates: rates, defaultRate: Number.isFinite(defaultRate) ? defaultRate : 40, reviews, units, maintenancePayroll })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
