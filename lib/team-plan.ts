// TEAM PLAN — recommendations for a team's week, built from the week itself.
//
// Jon, 2026-09-03: "make recommendations to maximize schedule and efficiency, look at units next
// day in same building etc. predictive scheduling and maxing out time."
//
// The model is deliberately small and every pick carries its reason in plain words, because the
// people reading it are the Miami and Broward leads on a phone, not a planner. Three ideas:
//
//   1. STAY IN THE BUILDING. A second clean in a building someone is already in costs the clean and
//      nothing else; the same clean across town costs the clean plus the drive. So an unassigned
//      clean goes first to whoever is already in that building that day, then to whoever is in the
//      same area, then to whoever was in that building yesterday or will be tomorrow (they know it).
//   2. FILL A DAY BEFORE STARTING ANOTHER. Capacity is the 8h worked day (Jon's standard). Among
//      people who still fit, prefer the one who ends up FULLEST — fewer half-days is the whole point.
//      Same-day turns are placed first because their window is the tightest.
//   3. SAY WHAT IT DOES. Every pick states the person's load before → after, so the lead can see the
//      trade, not just the name. Nothing here writes anything; the lead applies a pick or ignores it.
//
// Benchmarks (minutes per clean by bedrooms) and the area radius come from Ops presets, so a GM can
// tune them at /users → Ops presets without a code change.
import { benchmarkMinutes, type Timing } from './ops-presets'
import { distanceKm } from './geo-areas'

export type PlanClean = { listingId: string; unit: string; hub?: string; area?: string; date: string; bedrooms?: number | null; sameDayTurn?: boolean; assignedIds?: number[]; assignedNames?: string[]; lat?: number | null; lng?: number | null }
export type PlanHK = { id: number; name: string; region?: string | null }
export type Load = { cleanerId: number; name: string; minutes: number; cleans: number; buildings: string[]; pct: number }
export type Pick = { listingId: string; unit: string; date: string; cleanerId: number; cleanerName: string; why: string; beforeMin: number; afterMin: number }
export type DayPlan = { date: string; load: Load[]; picks: Pick[]; unplaced: { listingId: string; unit: string; why: string }[] }
export type WeekPlan = { days: DayPlan[]; picks: Pick[]; capacityMin: number; summary: string }

export const DAY_CAPACITY_MIN = 8 * 60      // Jon's standard: 8 worked hours
const hubKey = (c: PlanClean) => String(c.hub || '').trim().toLowerCase() || '~' + c.listingId

/** Drive between two stops in minutes: nothing inside one building, otherwise distance-based. */
export function travelMin(a: PlanClean, b: PlanClean): number {
  if (hubKey(a) === hubKey(b)) return 0
  const km = distanceKm(a, b)
  if (!Number.isFinite(km)) return 25
  return Math.min(45, Math.max(10, Math.round(km * 3)))
}

type Lane = { hk: PlanHK; stops: PlanClean[]; minutes: number }

function laneMinutes(stops: PlanClean[], t: Timing): number {
  let m = 0
  for (let i = 0; i < stops.length; i++) { m += benchmarkMinutes(t, stops[i].bedrooms); if (i > 0) m += travelMin(stops[i - 1], stops[i]) }
  return m
}
/** Cost of adding `c` to a lane: the clean itself plus the cheapest drive from any current stop. */
function addCost(lane: Lane, c: PlanClean, t: Timing): number {
  const clean = benchmarkMinutes(t, c.bedrooms)
  if (!lane.stops.length) return clean
  return clean + Math.min(...lane.stops.map(s => travelMin(s, c)))
}

/**
 * Plan the week. `days` is the market's week (vendor buildings already removed); `team` is the
 * market's own housekeepers — anyone already assigned that day is a candidate too, whoever they are.
 */
export function planWeek(days: { date: string; cleans: PlanClean[] }[], team: PlanHK[], timing: Timing, capacityMin = DAY_CAPACITY_MIN): WeekPlan {
  const byDate: Record<string, PlanClean[]> = {}
  for (const d of days) byDate[d.date] = d.cleans
  const dates = days.map(d => d.date)
  const out: DayPlan[] = []
  const allPicks: Pick[] = []

  // Who was in which building on which date (assigned OR planned) — for the continuity rule.
  const inBuilding: Record<string, Set<number>> = {}     // `${date}|${hub}` -> cleaner ids
  const mark = (date: string, c: PlanClean, id: number) => { const k = date + '|' + hubKey(c); (inBuilding[k] = inBuilding[k] || new Set()).add(id) }
  for (const d of days) for (const c of d.cleans) for (const id of (c.assignedIds || [])) mark(d.date, c, id)

  for (const date of dates) {
    const cleans = byDate[date] || []
    const lanes: Record<number, Lane> = {}
    const laneFor = (hk: PlanHK) => (lanes[hk.id] = lanes[hk.id] || { hk, stops: [], minutes: 0 })
    for (const hk of team) laneFor(hk)
    for (const c of cleans) {
      const id = (c.assignedIds || [])[0]
      if (id == null) continue
      const hk = team.find(h => h.id === id) || { id, name: (c.assignedNames || [])[0] || 'Cleaner #' + id }
      laneFor(hk).stops.push(c)
    }
    for (const l of Object.values(lanes)) l.minutes = laneMinutes(l.stops, timing)

    const picks: Pick[] = []
    const unplaced: DayPlan['unplaced'] = []
    // Same-day turns first (tightest window), then bigger units (hardest to place late).
    const open = cleans.filter(c => !(c.assignedIds || []).length).sort((a, b) => (b.sameDayTurn ? 1 : 0) - (a.sameDayTurn ? 1 : 0) || (b.bedrooms || 0) - (a.bedrooms || 0))
    const prev = dates[dates.indexOf(date) - 1], next = dates[dates.indexOf(date) + 1]
    for (const c of open) {
      let best: { lane: Lane; score: number; add: number; why: string } | null = null
      for (const lane of Object.values(lanes)) {
        const add = addCost(lane, c, timing)
        const after = lane.minutes + add
        if (after > capacityMin) continue                                   // would run past the day
        const sameBuilding = lane.stops.some(s => hubKey(s) === hubKey(c))
        const sameArea = !sameBuilding && !!c.area && lane.stops.some(s => s.area === c.area)
        const knowsIt = !sameBuilding && ((prev && inBuilding[prev + '|' + hubKey(c)]?.has(lane.hk.id)) || (next && inBuilding[next + '|' + hubKey(c)]?.has(lane.hk.id)))
        // Building 1000 > area 500 > continuity 250, then the fullest resulting day wins (max out time).
        const score = (sameBuilding ? 1000 : 0) + (sameArea ? 500 : 0) + (knowsIt ? 250 : 0) + after / capacityMin * 100
        if (!best || score > best.score) {
          const why = sameBuilding ? `already in ${c.hub} that day — no extra drive`
            : sameArea ? `already working in ${c.area} that day`
            : knowsIt ? `in ${c.hub} ${prev && inBuilding[prev + '|' + hubKey(c)]?.has(lane.hk.id) ? 'the day before' : 'the next day'} — keeps the building with one person`
            : lane.stops.length ? 'has room left in the day' : 'free that day'
          best = { lane, score, add, why }
        }
      }
      if (!best) { unplaced.push({ listingId: c.listingId, unit: c.unit, why: 'everyone on the team is already at a full day — needs another cleaner' }); continue }
      const before = best.lane.minutes
      best.lane.stops.push(c); best.lane.minutes += best.add
      mark(date, c, best.lane.hk.id)
      const p: Pick = { listingId: c.listingId, unit: c.unit, date, cleanerId: best.lane.hk.id, cleanerName: best.lane.hk.name, why: `${best.lane.hk.name} — ${best.why} (${Math.round(before / 60 * 10) / 10}h → ${Math.round(best.lane.minutes / 60 * 10) / 10}h)`, beforeMin: before, afterMin: best.lane.minutes }
      picks.push(p); allPicks.push(p)
    }
    const load: Load[] = Object.values(lanes).filter(l => l.stops.length).map(l => ({ cleanerId: l.hk.id, name: l.hk.name, minutes: l.minutes, cleans: l.stops.length, buildings: Array.from(new Set(l.stops.map(s => s.hub || 'Other'))), pct: Math.round(l.minutes / capacityMin * 100) })).sort((a, b) => b.minutes - a.minutes)
    out.push({ date, load, picks, unplaced })
  }
  const unplacedN = out.reduce((s, d) => s + d.unplaced.length, 0)
  const summary = allPicks.length ? `${allPicks.length} pick${allPicks.length === 1 ? '' : 's'} suggested${unplacedN ? ` · ${unplacedN} could not fit anyone's day` : ''}` : (unplacedN ? `${unplacedN} clean${unplacedN === 1 ? '' : 's'} do not fit anyone's day` : 'Every clean has someone')
  return { days: out, picks: allPicks, capacityMin, summary }
}
