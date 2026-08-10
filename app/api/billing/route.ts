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
    let maintenancePayroll: { cost: number; hours: number; people: number; source: string; people_detail?: any[] } | null = null
    // BY MARKET (Jon, 2026-08-09: "the way we bill in Miami is different"). Billable is per task, so
    // it splits EXACTLY — each task belongs to a listing, and the listing belongs to a market.
    // Payroll cannot: Homebase is a single location with no market on a timecard, so the per-market
    // figure is the real total apportioned by the maintenance MINUTES each market consumed, and it
    // is labelled as apportioned wherever it is shown. The totals row is always measured.
    let maintenanceByMarket: { market: string; billed: number; tasks: number; minutes: number; payroll: number | null }[] = []
    try {
      const { from, to } = monthRange(monthKey)
      const tc = await getTimecards(from, to)
      // ATTRIBUTE PAY BY THE WORK ACTUALLY DONE, NOT BY THE JOB TITLE.
      // The first version filtered timecards on the Homebase role alone. That is wrong in both
      // directions here: Ernesto Torres is a housekeeping SUPERVISOR who also closes maintenance
      // tickets (he was being charged 100% to maintenance), while Abel Guada and Eber Castro are
      // tagged "Housekeeper" but do maintenance work (they were being missed entirely). So each
      // person's pay is now SPLIT by the share of task minutes they spent on maintenance this
      // month — somebody who was 30% on maintenance contributes 30% of their wages, no more.
      // People with no tasks at all fall back to their role so a tech who logged nothing is
      // still counted.
      const norm = (v: any) => String(v || '').trim().toLowerCase()
      const nameOfAny = (v: any): string => {
        if (!v) return ''
        if (typeof v === 'string') return v
        if (typeof v === 'object') return String(v.name || v.full_name || [v.first_name, v.last_name].filter(Boolean).join(' ') || '')
        return ''
      }
      const minsBy: Record<string, { maint: number; total: number }> = {}
      for (const t of (data.tasks || []) as any[]) {
        const mins = Number(t.actualMinutes) || 0
        if (!mins) continue
        const isMt = /maint/i.test(String(t.department || ''))
        const doers = ([] as any[])
          .concat(Array.isArray(t.assignees) ? t.assignees : [])
          .concat([t.finishedBy])
          .map(nameOfAny).filter(Boolean)
        for (const d of Array.from(new Set(doers.map(norm)))) {
          const e = minsBy[d] = minsBy[d] || { maint: 0, total: 0 }
          e.total += mins
          if (isMt) e.maint += mins
        }
      }
      const isMaintRole = (r: any) => /maint|tech|repair|handy/i.test(String(r || ''))
      // one row per person, with the share shown so the number can be checked by hand
      const perPerson: { name: string; hours: number; cost: number; share: number; maintCost: number; maintHours: number; basis: string }[] = []
      const byName: Record<string, { hours: number; cost: number; role: any }> = {}
      for (const t of (tc as any[])) {
        const k = norm(t.name); if (!k) continue
        const e = byName[k] = byName[k] || { hours: 0, cost: 0, role: t.role }
        e.hours += Number(t.hours) || 0
        e.cost += Number(t.laborCost) || 0
        if (!e.role && t.role) e.role = t.role
      }
      for (const k of Object.keys(byName)) {
        const p2 = byName[k]
        const m = minsBy[k]
        let share = 0, basis = 'no tasks logged'
        if (m && m.total > 0) { share = m.maint / m.total; basis = Math.round(m.maint) + ' of ' + Math.round(m.total) + ' task minutes on maintenance' }
        else if (isMaintRole(p2.role)) { share = 1; basis = 'role: ' + String(p2.role) }
        if (share <= 0) continue
        perPerson.push({
          name: k.replace(/\b\w/g, c => c.toUpperCase()),
          hours: Math.round(p2.hours * 10) / 10,
          cost: Math.round(p2.cost * 100) / 100,
          share: Math.round(share * 1000) / 10,
          maintCost: Math.round(p2.cost * share * 100) / 100,
          maintHours: Math.round(p2.hours * share * 10) / 10,
          basis,
        })
      }
      perPerson.sort((a, b) => b.maintCost - a.maintCost)
      const mine = perPerson
      const payrollTotal = mine.length
        ? Math.round(mine.reduce((a, t) => a + t.maintCost, 0) * 100) / 100
        : null
      if (mine.length) {
        maintenancePayroll = {
          cost: payrollTotal as number,
          hours: Math.round(mine.reduce((a, t) => a + t.maintHours, 0) * 10) / 10,
          people: mine.length,
          source: 'Homebase payroll, split by each person\u2019s maintenance minutes',
          people_detail: mine.slice(0, 12),
        } as any
      }
      // listing -> market for every task in the month
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
      const totMin = Object.values(agg).reduce((a, b) => a + b.minutes, 0)
      const ORDER = ['Miami', 'Broward', 'North', 'Other']
      maintenanceByMarket = Object.keys(agg)
        .sort((a, b) => (ORDER.indexOf(a) < 0 ? 9 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 9 : ORDER.indexOf(b)))
        .map(mk => ({
          market: mk,
          billed: Math.round(agg[mk].billed * 100) / 100,
          tasks: agg[mk].tasks,
          minutes: agg[mk].minutes,
          payroll: (payrollTotal != null && totMin > 0) ? Math.round(payrollTotal * (agg[mk].minutes / totMin) * 100) / 100 : null,
        }))
    } catch { /* payroll / market split simply absent */ }
    return NextResponse.json({ ok: true, month: monthKey, ...data, laborRates: rates, defaultRate: Number.isFinite(defaultRate) ? defaultRate : 40, reviews, units, maintenancePayroll, maintenanceByMarket })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
