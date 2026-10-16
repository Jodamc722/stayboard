// WHO TAKES IT, AND WHEN — upkeep booked onto the routes the team is already driving (Jon,
// 2026-10-16: "should be smart assignments based on where team is going").
//
// A filter change is ten minutes of work and forty minutes of driving. So for every upkeep job that
// is late or coming due, this looks at the next three weeks of work ALREADY on the books in
// Breezeway and asks: on which day is somebody of the right trade already going to that building —
// best of all, to that very unit — and is the unit empty then (when the job needs it)? That day and
// that person are the plan. When nobody is going there in the window, the plan says so and the old
// rule applies (next empty day, the market supervisor).
//
// Scoring, in the order a coordinator reasons:
//   already working in THIS unit that day   +100
//   already in the building that day          +60
//   a busier stop there (more jobs) is a surer trip, a little: +2 per job, up to +10
//   sooner is better for a late job (−3 per day out); for a job not yet due, the days after its due
//   date cost −6 each, the days before cost −1 each (doing it a little early on a free trip is fine).
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pageRows } from './db-page'
import { buildingOf } from './segments'
import { workableDays } from './unit-windows'

const str = (v: any) => String(v ?? '').trim()
const plus = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const between = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
const norm = (s: string) => str(s).toLowerCase()

export type PlanInput = { id: string; listingId: string; building: string; dept: string; dueOn: string; late: boolean; needsVacant: boolean }
export type UpkeepPlan = {
  date: string; person: string; atUnit: boolean; jobs: number; vacant: boolean | null
  /** One line for the row and the task: "Carlos is already at Elser 1615 on Tue Oct 21 (3 jobs)". */
  why: string
}

const tradeOk = (rowDept: string, taskDept: string) => {
  const t = norm(taskDept)
  if (/housekeep/.test(rowDept)) return /housekeep|clean/.test(t)
  if (/inspect/.test(rowDept)) return /inspect|maint/.test(t)
  return /maint/.test(t)
}
const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The plan for each row (keyed by row id); null where nobody of the trade is going there in the window. */
export type Stop = { units: Set<string>; depts: Set<string>; jobs: number; name: string }
export type Visits = { visits: Record<string, Record<string, Record<string, Stop>>>; bOf: Record<string, string>; nameOf: Record<string, string>; truncated: boolean }

/** Who already has work where, per building and day, for the next `horizon` days (open Breezeway tasks). */
export async function teamVisits(today: string, horizon = 21): Promise<Visits> {
  const db = supabaseAdmin()
  const last = plus(today, horizon)
  const [tasks, listings] = await Promise.all([
    pageRows<any>((a, b) => db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,scheduled_date,status,finished_at,assignees,type_department')
      .gte('scheduled_date', today).lte('scheduled_date', last)
      .order('scheduled_date', { ascending: true }).order('id').range(a, b), 10),
    db.from('guesty_listings').select('id,nickname,title,building').limit(3000),
  ])
  const bOf: Record<string, string> = {}, nameOf: Record<string, string> = {}
  for (const l of ((listings.data || []) as any[])) {
    const name = str(l.nickname || l.title)
    nameOf[str(l.id)] = name
    bOf[str(l.id)] = buildingKey(name, str(l.building))
  }
  const visits: Visits['visits'] = {}
  for (const t of (tasks.rows as any[])) {
    if (t.finished_at || /cancel|delet|void|complete|approved|finished/i.test(str(t.status))) continue
    const lid = str(t.reference_property_id), d = str(t.scheduled_date).slice(0, 10), b = bOf[lid]
    if (!lid || !d || !b) continue
    const names: string[] = Array.isArray(t.assignees) ? t.assignees.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean) : []
    for (const n of names) {
      const k = norm(n)
      const s = (((visits[b] = visits[b] || {})[d] = visits[b][d] || {})[k] = visits[b][d][k] || { units: new Set(), depts: new Set(), jobs: 0, name: n })
      s.units.add(lid); s.depts.add(str(t.type_department)); s.jobs++
    }
  }
  return { visits, bOf, nameOf, truncated: !!tasks.truncated }
}
/** The one building key both sides use: "Elser 1615 - Studio" → "elser". */
export const buildingKey = (name: string, building?: string | null) => norm(buildingOf(name) || buildingOf(str(building)) || str(building) || name)
export { tradeOk }

/** The plan for each row (keyed by row id); null where nobody of the trade is going there in the window. */
export async function planUpkeep(rows: PlanInput[], today: string, horizon = 21, pre?: Visits): Promise<Record<string, UpkeepPlan | null>> {
  const out: Record<string, UpkeepPlan | null> = {}
  if (!rows.length) return out
  const [tv, windows] = await Promise.all([
    pre ? Promise.resolve(pre) : teamVisits(today, horizon),
    workableDays(Array.from(new Set(rows.filter(r => r.needsVacant).map(r => r.listingId))), today, horizon).catch(() => ({} as Record<string, any>)),
  ])
  const visits = tv.visits
  for (const r of rows) {
    const b = norm(r.building)
    const byDay = visits[b] || {}
    const win = (windows as any)[r.listingId]
    const vacantDays: Set<string> | null = r.needsVacant && win && Array.isArray(win.days) ? new Set(win.days.map((x: any) => x.date)) : null
    let best: { score: number; plan: UpkeepPlan } | null = null
    for (let i = 0; i <= horizon; i++) {
      const d = plus(today, i)
      if (vacantDays && !vacantDays.has(d)) continue
      for (const s of Object.values(byDay[d] || {})) {
        if (!Array.from(s.depts).some(x => tradeOk(r.dept, x))) continue
        const atUnit = s.units.has(r.listingId)
        let score = (atUnit ? 100 : 60) + Math.min(10, s.jobs * 2)
        if (r.late || r.dueOn <= today) score -= 3 * i
        else { const over = between(r.dueOn, d); score -= over > 0 ? 6 * over : -over }
        if (!best || score > best.score) {
          const where = atUnit ? 'already in this unit' : `already at ${r.building}`
          best = { score, plan: { date: d, person: s.name, atUnit, jobs: s.jobs, vacant: vacantDays ? true : null,
            why: `${s.name.split(/\s+/)[0]} is ${where} on ${day(d)} (${s.jobs} job${s.jobs === 1 ? '' : 's'})${vacantDays ? ' · unit empty' : ''}` } }
        }
      }
    }
    out[r.id] = best ? best.plan : null
  }
  return out
}
