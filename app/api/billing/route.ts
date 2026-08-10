// BILLABLE HOURS board data. GET ?month=YYYY-MM returns the month's tasks with billing detail,
// owner grouping and our adjustment overlay merged in (lib/billing), plus the per-person labor
// cost rates (app_settings 'labor_cost_rates') the Labor tab compares against actual hours.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth, listingNames, monthRange } from '@/lib/billing'
import { getTimecards } from '@/lib/homebase-labor'
import { marketOf } from '@/lib/segments'
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
    let maintenancePayroll: { cost: number; hours: number; people: number; source: string; roster?: { name: string; hours: number; cost: number }[] } | null = null
    // BY MARKET (Jon, 2026-08-09: "the way we bill in Miami is different"). Billable splits exactly —
    // every task belongs to a listing and the listing belongs to a market. Payroll does not split:
    // Homebase is one location with no market on a timecard, so it stays a single measured total
    // rather than an invented per-market number.
    let maintenanceByMarket: { market: string; billed: number; tasks: number; minutes: number }[] = []
    try {
      const { from, to } = monthRange(monthKey)
      const tc = await getTimecards(from, to)
      // TWO NUMBERS, NOTHING DERIVED (Jon, 2026-08-10: "just take payroll for maintenance and take
      // billable labor on tasks. That's all"). Payroll is the maintenance crew's clocked Homebase
      // pay for the month; billable is what those tasks bill. No share-of-minutes attribution, no
      // apportioning — anything that cannot be measured directly is simply not shown.
      const norm = (v: any) => String(v || '').trim().toLowerCase()
      const isMaintRole = (r: any) => /maint|tech|repair|handy/i.test(String(r || ''))
      const byName: Record<string, { name: string; hours: number; cost: number }> = {}
      for (const t of (tc as any[])) {
        if (!isMaintRole(t.role)) continue
        const k = norm(t.name); if (!k) continue
        const e = byName[k] = byName[k] || { name: String(t.name), hours: 0, cost: 0 }
        e.hours += Number(t.hours) || 0
        e.cost += Number(t.laborCost) || 0
      }
      const roster = Object.values(byName)
        .map(p2 => ({ name: p2.name, hours: Math.round(p2.hours * 10) / 10, cost: Math.round(p2.cost * 100) / 100 }))
        .sort((a, b) => b.cost - a.cost)
      if (roster.length) {
        maintenancePayroll = {
          cost: Math.round(roster.reduce((a, p2) => a + p2.cost, 0) * 100) / 100,
          hours: Math.round(roster.reduce((a, p2) => a + p2.hours, 0) * 10) / 10,
          people: roster.length,
          source: 'Homebase clocked payroll \u2014 maintenance crew',
          roster,
        }
      }
      // listing -> market for every maintenance task in the month
      const mtTasks = (data.tasks || []).filter((t: any) => /maint/i.test(String(t.department || '')))
      const lids = Array.from(new Set(mtTasks.map((t: any) => String(t.listingId || '')).filter(Boolean)))
      const mkOf: Record<string, string> = {}
      if (lids.length) {
        const { data: ls } = await supabaseAdmin().from('guesty_listings')
          .select('id,nickname,title,building,address_city').in('id', lids).limit(2000)
        for (const l of ((ls || []) as any[])) {
          const nm = l.nickname || l.title || ''
          mkOf[String(l.id)] = String(marketOf(l.building, l.address_city, nm) || 'Other')
        }
      }
      const agg: Record<string, { billed: number; tasks: number; minutes: number }> = {}
      for (const t of mtTasks) {
        const mk = mkOf[String((t as any).listingId || '')] || 'Other'
        const e = agg[mk] = agg[mk] || { billed: 0, tasks: 0, minutes: 0 }
        e.billed += Number((t as any).billedAmount) || 0
        e.tasks += 1
        e.minutes += Number((t as any).actualMinutes) || 0
      }
      const ORDER = ['Miami', 'Broward', 'North', 'Other']
      maintenanceByMarket = Object.keys(agg)
        .sort((a, b) => (ORDER.indexOf(a) < 0 ? 9 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 9 : ORDER.indexOf(b)))
        .map(mk => ({ market: mk, billed: Math.round(agg[mk].billed * 100) / 100, tasks: agg[mk].tasks, minutes: agg[mk].minutes }))
    } catch { /* payroll / market split simply absent */ }
    return NextResponse.json({ ok: true, month: monthKey, ...data, laborRates: rates, defaultRate: Number.isFinite(defaultRate) ? defaultRate : 40, reviews, units, maintenancePayroll, maintenanceByMarket })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
