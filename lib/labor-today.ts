// TODAY'S FORWARD LOOK — the half of a labor report that can still change the day (Jon,
// 2026-08-20: "yesterday labor in that should include today projection etc, what to look for").
//
// Yesterday's payroll is history: you read it, you learn from it, you cannot alter it. What is
// scheduled for TODAY is the only part still in your hands, so the morning email leads with it —
// who is on, the hours they are booked for, what that will cost, and how many cleans are waiting
// for them. A day that is over-staffed for the checkouts on the board is fixable at 7am and
// expensive by 7pm.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getShifts, type Shift } from './homebase'
import { deptOfRole, type Dept } from './labor-report'
import { isLiveStay } from './stay-status'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'

const str = (v: any) => (v == null ? '' : String(v))
const r1 = (n: number) => Math.round(n * 10) / 10

export type TodayPerson = { name: string; role: string | null; dept: Dept; hours: number; cost: number | null; label: string }

export type TodayProjection = {
  date: string
  people: TodayPerson[]
  openShifts: number            // unfilled shifts on the schedule
  scheduledHours: number
  scheduledCost: number | null  // Homebase forecast payroll; null when no wage data
  byDept: Record<string, { hours: number; cost: number; people: number }>
  checkoutsDue: number          // in-house checkouts today = cleans owed
  vendorCheckoutsDue: number
  arrivals: number
  projectedCostPerClean: number | null
  note: string | null           // one honest sentence when the projection is thin
}

const shiftHours = (s: Shift): number => {
  if (!s.startAt || !s.endAt) return 0
  const h = (new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 3600000
  return Number.isFinite(h) && h > 0 && h < 24 ? h : 0
}

export async function buildTodayProjection(today: string): Promise<TodayProjection> {
  const db = supabaseAdmin()
  const out: TodayProjection = {
    date: today, people: [], openShifts: 0, scheduledHours: 0, scheduledCost: null,
    byDept: {}, checkoutsDue: 0, vendorCheckoutsDue: 0, arrivals: 0,
    projectedCostPerClean: null, note: null,
  }

  // ---- the schedule -----------------------------------------------------------
  let shifts: Shift[] = []
  try { shifts = await getShifts(today) } catch { out.note = 'Homebase did not answer for the schedule, so today shows work owed without the staffing against it.'; }

  let costKnown = 0, costMissing = 0
  for (const s of shifts) {
    if (s.open) { out.openShifts++; continue }
    const hours = shiftHours(s)
    const cost = typeof s.scheduledCost === 'number' && Number.isFinite(s.scheduledCost)
      ? s.scheduledCost
      : (typeof s.wageRate === 'number' && s.wageRate > 0 ? s.wageRate * hours : null)
    if (cost == null) costMissing++; else costKnown += cost
    const dept = deptOfRole(s.role || s.department)
    out.people.push({ name: s.name, role: s.role || s.department || null, dept, hours: r1(hours), cost: cost == null ? null : Math.round(cost), label: s.label })
    out.scheduledHours += hours
    const d = (out.byDept[dept] = out.byDept[dept] || { hours: 0, cost: 0, people: 0 })
    d.hours += hours; d.cost += cost || 0; d.people += 1
  }
  out.scheduledHours = r1(out.scheduledHours)
  out.scheduledCost = out.people.length ? Math.round(costKnown) : null
  for (const k of Object.keys(out.byDept)) {
    out.byDept[k].hours = r1(out.byDept[k].hours)
    out.byDept[k].cost = Math.round(out.byDept[k].cost)
  }
  out.people.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))

  // ---- the work waiting for them ---------------------------------------------
  const presets = await getOpsPresets().catch(() => ({ vendorBuildings: [] } as any))
  const VEN = vendorRegex(presets.vendorBuildings)
  const { data: lRows } = await db.from('guesty_listings').select('id,nickname,title,building').limit(2000)
  const vendor: Record<string, boolean> = {}
  for (const l of ((lRows || []) as any[])) {
    const nm = l.nickname || l.title || String(l.id)
    vendor[String(l.id)] = VEN.test(str(l.building)) || VEN.test(nm)
  }
  const { data: outRows } = await db.from('guesty_reservations')
    .select('listing_id,status').eq('check_out', today).limit(2000)
  for (const r of ((outRows || []) as any[])) {
    if (!isLiveStay(r.status)) continue
    if (vendor[String(r.listing_id)]) { out.vendorCheckoutsDue++; continue }
    out.checkoutsDue++
  }
  const { data: inRows } = await db.from('guesty_reservations')
    .select('status').eq('check_in', today).limit(2000)
  for (const r of ((inRows || []) as any[])) if (isLiveStay(r.status)) out.arrivals++

  if (out.scheduledCost != null && out.checkoutsDue > 0) {
    out.projectedCostPerClean = Math.round(out.scheduledCost / out.checkoutsDue)
  }
  // Say so when the forecast is only part of the picture, rather than quietly under-reporting.
  if (!out.note && costMissing > 0 && out.people.length) {
    out.note = costMissing + ' of ' + (out.people.length) + ' scheduled shifts carry no wage in Homebase, so the projected cost is a floor.'
  }
  if (!out.note && !out.people.length) out.note = 'Nothing is on the Homebase schedule for today.'
  return out
}
