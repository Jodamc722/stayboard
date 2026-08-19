// LABOR domain — who is on the clock, what a clean actually costs, and who is heading for overtime.
//
// TWO TRAPS ARE HANDLED HERE AND MUST STAY HANDLED:
//  1. `timecard.open` alone is NOT "on the clock now" — a stale un-closed card from three weeks ago
//     is also open. It once painted 12 people as clocked in. The test is `open && date === today`.
//  2. getTimecards() silently discards the audit. Homebase truncates wide ranges and fails whole
//     weeks; getTimecardsAudited() reports which weeks failed. We refuse to quote payroll when the
//     pull was incomplete rather than under-reporting it.
import 'server-only'
import { getShifts, getEmployees, nameMatchesRoster } from '@/lib/homebase'
import { getTimecardsAudited } from '@/lib/homebase-labor'
import { laborEconomics } from '@/lib/labor-econ'
import { getLaborSettings } from '@/lib/labor-settings'
import { getStaff, getAgencies } from '@/lib/staffing'
import { getCrew } from '@/lib/crew'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampDays, shiftDay, lc, has, safe, round2, num } from './ctx'

function weekStart(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00Z')
  return shiftDay(ymd, -d.getUTCDay())
}

export const LABOR_TOOLS: EveTool[] = [
  {
    name: 'staffing_today',
    description: 'Who is ON THE CLOCK right now versus who has Breezeway work assigned, joined with the fuzzy name matcher (Homebase and Breezeway spell people differently). The headline is IDLE: anyone clocked in with zero tasks assigned. Also flags people with tasks who never clocked in. Optional date.',
    input_schema: obj({ date: S.str }),
    run: async (input, ctx) => {
      const date = String(input?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.date) : ctx.today
      const isToday = date === ctx.today
      const [shifts, audit, taskRes, roster] = await Promise.all([
        safe(getShifts(date) as any, [] as any),
        safe(getTimecardsAudited(date, date) as any, { cards: [], complete: false, failedWeeks: [] } as any),
        safe(ctx.db.from('breezeway_tasks_sync').select('id,name,status,assignees,type_department,reference_property_id').eq('scheduled_date', date).order('id').limit(2000), { data: [] } as any),
        safe(getEmployees() as any, [] as any),
      ])
      const rosterNames = (roster as any[]).map((e: any) => e.name).filter(Boolean)
      // Trap 1: on the clock NOW means open AND dated today, not merely open.
      const cards: any[] = (audit as any).cards || []
      const clockedIn = cards.filter((t: any) => t.open && String(t.date || '').slice(0, 10) === date)
      const worked: Record<string, number> = {}
      for (const t of cards) {
        if (String(t.date || '').slice(0, 10) !== date) continue
        const k = nameMatchesRoster(String(t.name || ''), rosterNames) || String(t.name || '')
        worked[k] = (worked[k] || 0) + num(t.hours)
      }
      const assigned: Record<string, { tasks: number; cleans: number; alias: string }> = {}
      for (const t of ((taskRes as any).data || [])) {
        const list = Array.isArray((t as any).assignees) ? (t as any).assignees : []
        for (const a of list) {
          const raw = String(a?.name || '')
          if (!raw) continue
          const k = nameMatchesRoster(raw, rosterNames) || raw
          if (!assigned[k]) assigned[k] = { tasks: 0, cleans: 0, alias: raw }
          assigned[k].tasks++
          if (lc((t as any).type_department) === 'housekeeping') assigned[k].cleans++
        }
      }
      const seen: Record<string, true> = {}
      const people: any[] = []
      const push = (name: string, extra: any) => {
        if (!name || seen[name]) return
        seen[name] = true
        const a = assigned[name]
        people.push({
          name,
          breezeway_alias: a && a.alias !== name ? a.alias : null,
          clocked_in: clockedIn.some((c: any) => (nameMatchesRoster(String(c.name || ''), rosterNames) || String(c.name || '')) === name),
          hours_today: round2(worked[name] || 0),
          tasks_assigned: a ? a.tasks : 0,
          cleans_assigned: a ? a.cleans : 0,
          ...extra,
        })
      }
      for (const c of clockedIn) push(nameMatchesRoster(String(c.name || ''), rosterNames) || String(c.name || ''), { source: 'homebase' })
      const shiftList: any[] = shifts as any[]
      for (const s of shiftList) { if (s.name) push(nameMatchesRoster(String(s.name), rosterNames) || String(s.name), { source: 'scheduled', shift: s.label }) }
      const assignedKeys = Object.keys(assigned)
      for (const k of assignedKeys) push(k, { source: 'breezeway' })
      const idle = people.filter((p: any) => p.clocked_in && p.tasks_assigned === 0)
      const unclocked = people.filter((p: any) => !p.clocked_in && p.tasks_assigned > 0)
      return {
        date, is_today: isToday,
        summary: {
          scheduled: shiftList.filter((s: any) => !!s.name).length,
          clocked_in_now: isToday ? clockedIn.length : null,
          with_work: people.filter((p: any) => p.tasks_assigned > 0).length,
          idle_clocked_in: idle.length,
        },
        idle_names: idle.map((p: any) => p.name),
        assigned_but_not_clocked_in: unclocked.map((p: any) => p.name),
        people: people.sort((a: any, b: any) => b.tasks_assigned - a.tasks_assigned).slice(0, 60),
        payroll_data_complete: (audit as any).complete !== false,
        note: isToday ? undefined : 'Not today — clocked_in reflects that date\'s cards, not live status.',
      }
    },
  },

  {
    name: 'labor_economics',
    description: 'The labor P&L over a date range: cost per clean, hours per clean, payroll, cleaning revenue (net of the channel cut), billable revenue from Breezeway task amounts, materials, and margin — broken down by department and by person. Params from/to (YYYY-MM-DD), optional market. IMPORTANT: if payroll_complete is false, Homebase failed some weeks and you must NOT quote the payroll or margin figures as fact.',
    input_schema: obj({ from: S.str, to: S.str, market: S.str, days: S.num }),
    money: true,
    run: async (input, ctx) => {
      const days = clampDays(input?.days, 30, 180)
      const to = String(input?.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.to) : ctx.today
      const from = String(input?.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(input.from) : shiftDay(to, -days)
      const e: any = await safe(laborEconomics({ from, to, market: input?.market ? String(input.market) : undefined }) as any, null as any)
      if (!e) return { error: 'Labor economics could not be computed.' }
      const complete = e.payrollAudit?.complete !== false
      return {
        window: { from, to }, market: e.market || 'all',
        payroll_complete: complete,
        warning: complete ? undefined : `Homebase failed ${(e.payrollAudit?.failedWeeks || []).length} week(s) (${(e.payrollAudit?.failedWeeks || []).join(', ')}). Payroll and margin are UNDER-reported — say so rather than quoting them.`,
        headline: {
          cleans: e.cleans, cost_per_clean: e.costPerClean, hours_per_clean: e.hoursPerClean,
          cleaning_revenue: e.cleaningRevenue, billable_revenue: e.billableRevenue,
          materials: e.materials, payroll: e.payroll, margin: e.margin,
          management_fee: e.managementFee, margin_with_fee: e.marginWithFee,
        },
        by_market: { cost_per_clean: e.costPerCleanByMarket, hours_per_clean: e.hoursPerCleanByMarket },
        departments: (e.departments || []).map((d: any) => ({
          dept: d.label, people: d.people, hours: d.hours, payroll: d.payroll, cleans: d.cleans,
          revenue: d.revenue, margin: d.margin, margin_pct: d.marginPct,
          cost_per_clean: d.costPerClean, hours_per_clean: d.hoursPerClean,
        })),
        people: (e.people || []).slice(0, 40).map((p: any) => ({
          name: p.name, dept: p.dept, role: p.role, market: p.market, hours: p.hours,
          payroll: p.payroll, cleans: p.cleans, revenue: p.revenue, margin: p.margin,
          cost_per_clean: p.costPerClean, on_payroll: p.onPayroll,
        })),
        coverage: e.coverage,
      }
    },
  },

  {
    name: 'overtime_risk',
    description: 'Who is heading for overtime this week: hours worked week-to-date, hours still scheduled, projected week total, and whether that crosses the overtime threshold (default 40, configurable per market in labor settings). Also lists missed clock-outs, which understate payroll and need fixing before any payroll number is trusted.',
    input_schema: obj({ market: S.str }),
    money: true,
    run: async (input, ctx) => {
      const settings: any = await safe(getLaborSettings(input?.market ? lc(input.market) : 'default') as any, { ot_weekly_hours: 40 } as any)
      const otLimit = num(settings.ot_weekly_hours) || 40
      const ws = weekStart(ctx.today)
      const audit: any = await safe(getTimecardsAudited(ws, ctx.today) as any, { cards: [], complete: false, failedWeeks: [] } as any)
      const cards: any[] = audit.cards || []
      const byPerson: Record<string, { hours: number; ot: number; missed: string[] }> = {}
      for (const t of cards) {
        const k = String(t.name || '').trim()
        if (!k) continue
        if (!byPerson[k]) byPerson[k] = { hours: 0, ot: 0, missed: [] }
        byPerson[k].hours += num(t.hours)
        byPerson[k].ot += num(t.overtimeHours)
        const d = String(t.date || '').slice(0, 10)
        if (t.open && d && d < ctx.today) byPerson[k].missed.push(d)
      }
      // Remaining scheduled hours for the rest of the week.
      const remaining: Record<string, number> = {}
      const dayList: string[] = []
      for (let i = 0; i < 7; i++) { const d = shiftDay(ws, i); if (d > ctx.today) dayList.push(d) }
      for (const d of dayList) {
        const shifts: any[] = await safe(getShifts(d) as any, [] as any)
        for (const s of shifts) {
          if (!s.name) continue
          const start = s.startAt ? new Date(s.startAt).getTime() : 0
          const end = s.endAt ? new Date(s.endAt).getTime() : 0
          const hrs = start && end && end > start ? Math.min(12, (end - start) / 3600000) : 0
          remaining[String(s.name)] = (remaining[String(s.name)] || 0) + hrs
        }
      }
      const names: string[] = []
      const seen: Record<string, true> = {}
      const allKeys = Object.keys(byPerson).concat(Object.keys(remaining))
      for (const k of allKeys) { if (!seen[k]) { seen[k] = true; names.push(k) } }
      const people = names.map(n => {
        const wtd = round2(byPerson[n]?.hours || 0)
        const left = round2(remaining[n] || 0)
        const projected = round2(wtd + left)
        return {
          name: n, week_to_date: wtd, remaining_scheduled: left, projected_week: projected,
          overtime_so_far: round2(byPerson[n]?.ot || 0),
          over_threshold: projected > otLimit,
          missed_clock_outs: byPerson[n]?.missed || [],
        }
      }).sort((a, b) => b.projected_week - a.projected_week)
      return {
        week_start: ws, today: ctx.today, overtime_threshold: otLimit,
        payroll_complete: audit.complete !== false,
        at_risk: people.filter(p => p.over_threshold),
        missed_clock_outs: people.filter(p => p.missed_clock_outs.length).map(p => ({ name: p.name, dates: p.missed_clock_outs })),
        people: people.slice(0, 40),
        note: 'A missed clock-out UNDERSTATES that person\'s hours — fix those before trusting any payroll total.',
      }
    },
  },

  {
    name: 'staff_directory',
    description: 'The team: who is on the roster, their declared department (housekeeping|supervision|maintenance|inspection|other), area, whether they are in-house or through a staffing agency, and each agency\'s fee structure. Use this to work out who to route work to, or to explain why a cost looks high (agency fees stack: percent + per-hour + flat).',
    input_schema: obj({ dept: S.str, area: S.str, agency: S.str }),
    money: true,
    run: async (input) => {
      const [staff, agencies, crew, employees] = await Promise.all([
        safe(getStaff(false) as any, [] as any),
        safe(getAgencies(false) as any, [] as any),
        safe(getCrew() as any, null as any),
        safe(getEmployees() as any, [] as any),
      ])
      const agencyByKey: Record<string, any> = {}
      for (const a of (agencies as any[])) agencyByKey[String(a.key)] = a
      const hbByName: Record<string, any> = {}
      for (const e of (employees as any[])) hbByName[String(e.name)] = e
      let rows = (staff as any[]).map((s: any) => {
        const ag = s.agency ? agencyByKey[String(s.agency)] : null
        const hb = hbByName[String(s.name)]
        return {
          name: s.name, role: s.role, area: s.area,
          dept: crew ? (crew as any).deptOf(s.name, hb?.role) : null,
          employment: ag ? `agency: ${ag.label}` : 'in-house',
          agency_fees: ag ? { percent: ag.fee_percent, per_hour: ag.fee_per_hour, flat: ag.fee_flat } : null,
          in_homebase: !!hb, notes: s.notes,
        }
      })
      if (input?.dept) rows = rows.filter((r: any) => has(r.dept, input.dept) || has(r.role, input.dept))
      if (input?.area) rows = rows.filter((r: any) => has(r.area, input.area))
      if (input?.agency) rows = rows.filter((r: any) => has(r.employment, input.agency))
      const onlyInHb = (employees as any[]).filter((e: any) => !(staff as any[]).some((s: any) => String(s.name) === String(e.name)))
      return {
        count: rows.length, staff: rows,
        agencies: (agencies as any[]).map((a: any) => ({ key: a.key, label: a.label, fee_percent: a.fee_percent, fee_per_hour: a.fee_per_hour, fee_flat: a.fee_flat })),
        in_homebase_not_on_roster: onlyInHb.slice(0, 30).map((e: any) => ({ name: e.name, role: e.role, active: e.active })),
      }
    },
  },
]

export const LABOR_DOMAIN: EveDomain = {
  key: 'labor',
  label: 'Labor',
  blurb: 'Who is clocked in versus who has work, the cost/hours per clean and labor margin, overtime risk, and the roster with agency fee structures.',
  tools: LABOR_TOOLS,
}
