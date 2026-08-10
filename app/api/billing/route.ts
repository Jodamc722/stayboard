// BILLABLE HOURS board data. GET ?month=YYYY-MM returns the month's tasks with billing detail,
// owner grouping and our adjustment overlay merged in (lib/billing), plus the per-person labor
// cost rates (app_settings 'labor_cost_rates') the Labor tab compares against actual hours.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingRange, listingNames, monthRange } from '@/lib/billing'
import { getTimecards } from '@/lib/homebase-labor'
import { marketOf } from '@/lib/segments'
import { getSetting } from '@/lib/app-settings'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const month = String(sp.get('month') || '').slice(0, 7)
  // CUSTOM DATE WINDOW (Jon, 2026-08-10). ?from&to override the month picker so the board can
  // show a week, a pay period or a quarter. The month stays the default and the fallback, and
  // the review overlay is still keyed by the month the window starts in so nothing is orphaned.
  const isYmd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  const qFrom = String(sp.get('from') || ''), qTo = String(sp.get('to') || '')
  const custom = isYmd(qFrom) && isYmd(qTo) && qFrom <= qTo
  try {
    const monthKey = /^\d{4}-\d{2}$/.test(month) ? month : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)
    const win = custom ? { from: qFrom, to: qTo } : monthRange(monthKey)
    const [data, rates, def, reviews] = await Promise.all([
      billingRange(win.from, win.to),
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
    // ── MAINTENANCE: WHAT WE BILL VS WHAT THE CREW COSTS ─────────────────────────────────────
    // Jon, 2026-08-10: "just take payroll for maintenance and take billable labor on tasks."
    //
    // THE CALCULATION THAT WAS WRONG: billedAmount on a task is labor + line items, and labor is
    // rate_paid x hours. NOT ONE maintenance task in the mirror carries a rate_paid, so the labor
    // side of every bill computed to $0 and the "billable labor" figure was really just the parts
    // and materials total. That is why it looked nothing like payroll — it was comparing what we
    // charge for MATERIALS against what we pay in WAGES.
    //
    // So labor is now priced the way we actually charge for it: time on task x the owner charge
    // rate (app_settings billing_default_rate, $40/h). Materials are kept as their own number
    // instead of being folded in, because they are a pass-through, not labor. Nothing here
    // changes what any owner is invoiced — the per-task billing on the rows below is untouched.
    let maintenancePayroll: {
      cost: number; hours: number; people: number; source: string
      roster?: { name: string; hours: number; cost: number }[]
      rate: number; tasks: number; tasksWithTime: number
      hoursOnTask: number; laborBillable: number; materials: number
    } | null = null
    // BY MARKET (Jon: "the way we bill in Miami is different"). Billable splits exactly — every
    // task has a listing and the listing has a market. Payroll does not split: Homebase is one
    // location with no market on a timecard, so it stays a single measured total.
    let maintenanceByMarket: { market: string; tasks: number; tasksWithTime: number; minutes: number; laborBillable: number; materials: number }[] = []
    try {
      const chargeRate = Number.isFinite(defaultRate) && defaultRate > 0 ? defaultRate : 40
      const mtTasks = (data.tasks || []).filter((t: any) => /maint/i.test(String(t.department || '')))
      const ownerItems = (t: any) => ((t.items || []) as any[])
        .reduce((a, i) => a + (String(i.bill_to || 'owner') === 'guest' ? 0 : (Number(i.amount) || 0)), 0)

      // ---- payroll: the maintenance crew's clocked Homebase pay for the month ----
      const tc = await getTimecards(win.from, win.to)
      const isMaintRole = (r: any) => /maint|tech|repair|handy/i.test(String(r || ''))
      const byName: Record<string, { name: string; hours: number; cost: number }> = {}
      for (const t of (tc as any[])) {
        if (!isMaintRole(t.role)) continue
        const k = String(t.name || '').trim().toLowerCase(); if (!k) continue
        const e = byName[k] = byName[k] || { name: String(t.name), hours: 0, cost: 0 }
        e.hours += Number(t.hours) || 0
        e.cost += Number(t.laborCost) || 0
      }
      const roster = Object.values(byName)
        .map(p2 => ({ name: p2.name, hours: Math.round(p2.hours * 10) / 10, cost: Math.round(p2.cost * 100) / 100 }))
        .sort((a, b) => b.cost - a.cost)

      // ---- billable: time on task x charge rate, plus materials, both measured ----
      const totMin = mtTasks.reduce((a: number, t: any) => a + (Number(t.actualMinutes) || 0), 0)
      const withTime = mtTasks.filter((t: any) => Number(t.actualMinutes) > 0).length
      const materials = mtTasks.reduce((a: number, t: any) => a + ownerItems(t), 0)
      maintenancePayroll = {
        cost: Math.round(roster.reduce((a, p2) => a + p2.cost, 0) * 100) / 100,
        hours: Math.round(roster.reduce((a, p2) => a + p2.hours, 0) * 10) / 10,
        people: roster.length,
        source: 'Homebase clocked payroll \u2014 maintenance crew',
        roster,
        rate: chargeRate,
        tasks: mtTasks.length,
        tasksWithTime: withTime,
        hoursOnTask: Math.round((totMin / 60) * 10) / 10,
        laborBillable: Math.round((totMin / 60) * chargeRate * 100) / 100,
        materials: Math.round(materials * 100) / 100,
      }

      // ---- the same two numbers, per market ----
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
      const agg: Record<string, { tasks: number; tasksWithTime: number; minutes: number; materials: number }> = {}
      for (const t of mtTasks) {
        const mk = mkOf[String((t as any).listingId || '')] || 'Other'
        const e = agg[mk] = agg[mk] || { tasks: 0, tasksWithTime: 0, minutes: 0, materials: 0 }
        const mins = Number((t as any).actualMinutes) || 0
        e.tasks += 1
        if (mins > 0) e.tasksWithTime += 1
        e.minutes += mins
        e.materials += ownerItems(t)
      }
      const ORDER = ['Miami', 'Broward', 'North', 'Other']
      maintenanceByMarket = Object.keys(agg)
        .sort((a, b) => (ORDER.indexOf(a) < 0 ? 9 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 9 : ORDER.indexOf(b)))
        .map(mk => ({
          market: mk,
          tasks: agg[mk].tasks,
          tasksWithTime: agg[mk].tasksWithTime,
          minutes: agg[mk].minutes,
          laborBillable: Math.round((agg[mk].minutes / 60) * chargeRate * 100) / 100,
          materials: Math.round(agg[mk].materials * 100) / 100,
        }))
    } catch { /* payroll / market split simply absent */ }
    return NextResponse.json({ ok: true, month: monthKey, from: win.from, to: win.to, custom, ...data, laborRates: rates, defaultRate: Number.isFinite(defaultRate) ? defaultRate : 40, reviews, units, maintenancePayroll, maintenanceByMarket })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
