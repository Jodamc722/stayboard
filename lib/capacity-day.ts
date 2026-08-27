// ASSEMBLING ONE DAY, so the capacity model has something real to price.
//
// lib/capacity.ts is deliberately pure — it takes a person, their stops, and answers. This file is
// the shell that goes and gets those things: who is on shift, what is on the board, where each unit
// is, and how big it is. Kept separate so the model stays testable and one loader feeds every
// surface that needs it.
//
// Jon, 2026-08-27: "the suggestion should live at the unit level, at the people level, and at the
// push level ... there should be a model that's calculating and sharing with our team, to help us
// think through our KPI and efficiency."
//
// So this returns all three views of the SAME arithmetic — never three calculations that can
// disagree. A unit's price, a person's day, and the moves worth making are one computation seen
// from three angles.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getShifts } from './homebase'
import { getCrew } from './crew'
import { marketOf } from './segments'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { isDepartureCleanName } from './breezeway'
import { assessDay, spread, unitCost, cleanTableFor, PERFORMED_FLOOR_MIN, type Stop, type DayLoad, type Person } from './capacity'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type DayPicture = {
  date: string
  /** Every person on shift, whether or not they have work. */
  people: DayLoad[]
  /** Work with nobody on it — the pool a supervisor is choosing from. */
  unassigned: Array<{ stop: Stop; minutes: number; market: string | null; bestFor: Suggestion[] }>
  /** Moves worth making, strongest first. */
  suggestions: Suggestion[]
  kpi: DayKpi
  notes: string[]
}

export type Suggestion = {
  kind: 'assign' | 'move'
  stopId: string
  unit: string
  /** Who it should go to. */
  toPerson: string
  fromPerson?: string | null
  /** Their utilisation before and after, so the trade is visible rather than asserted. */
  toBeforePct: number
  toAfterPct: number
  fromBeforePct?: number
  fromAfterPct?: number
  addedMinutes: number
  why: string
}

export type DayKpi = {
  peopleOnShift: number
  cleans: number
  otherTasks: number
  unassignedCount: number
  workMinutes: number
  travelMinutes: number
  capacityMinutes: number
  utilisationPct: number
  /** How far apart the busiest and quietest person are. The day's fairness in one number. */
  spreadPct: number
  overloaded: number
  underloaded: number
  /** People credited with more work than a day can hold — a data problem, not a workload one. */
  implausible: number
  /** Cleans recorded under the floor — closed out rather than performed. A data-quality KPI. */
  closedOutToday: number
}

/** Build the whole picture for one date. */
export async function buildDayPicture(date: string, market?: string): Promise<DayPicture> {
  const db = supabaseAdmin()
  const notes: string[] = []

  const [presets, crew, shifts] = await Promise.all([
    getOpsPresets().catch(() => ({} as any)),
    getCrew().catch(() => null),
    getShifts(date).catch(() => [] as any[]),
  ])
  const VENDOR_RE = vendorRegex((presets as any)?.vendorBuildings)

  // Listings: name, size, position, market. Small table, one read.
  const { data: lRows } = await db.from('guesty_listings')
    .select('id,nickname,title,building,unit,bedrooms,address_city,status,raw')
    .order('id')
  const lmap: Record<string, any> = {}
  for (const l of ((lRows as any[]) || [])) {
    const name = str(l.nickname) || str(l.title) || str(l.unit) || str(l.id)
    const addr = (l.raw && l.raw.address) || {}
    lmap[String(l.id)] = {
      name,
      building: str(l.building) || null,
      bedrooms: l.bedrooms == null ? null : Number(l.bedrooms),
      market: marketOf(l.building, l.address_city, name),
      lat: addr.lat == null ? null : Number(addr.lat),
      lng: addr.lng == null ? null : Number(addr.lng),
      vendor: VENDOR_RE ? VENDOR_RE.test(name) : false,
    }
  }

  // The day's board. One date, so this is small and needs no paging.
  const { data: tRows } = await db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,assignees,assignee_name,started_at,finished_at,total_minutes,type_department')
    .eq('scheduled_date', date).order('id').limit(1000)

  const stopsByPerson: Record<string, Stop[]> = {}
  const unassignedStops: Stop[] = []
  let closedOutToday = 0

  for (const t of ((tRows as any[]) || [])) {
    const status = str(t.status).toLowerCase()
    if (/delete|cancel/.test(status)) continue
    const li = lmap[String(t.reference_property_id)]
    if (!li) continue
    if (li.vendor) continue                    // vendor crews are not ours to schedule
    if (market && str(li.market).toLowerCase() !== market.toLowerCase()) continue

    const isClean = isDepartureCleanName(t.name)
    const people: string[] = Array.isArray(t.assignees)
      ? t.assignees.map((a: any) => str(a?.name)).filter(Boolean)
      : (t.assignee_name ? [str(t.assignee_name)] : [])

    const mins = Number(t.total_minutes)
    if (isClean && Number.isFinite(mins) && mins > 0 && mins < PERFORMED_FLOOR_MIN) closedOutToday++

    const stop: Stop = {
      id: str(t.id),
      unit: li.name,
      building: li.building,
      lat: li.lat,
      lng: li.lng,
      bedrooms: li.bedrooms,
      market: li.market,
      crewSize: Math.max(1, people.length),
      kind: isClean ? 'clean' : 'other',
      // A finished task still costs the day the time it took; an unstarted one costs the standard.
      knownMinutes: Number.isFinite(mins) && mins >= PERFORMED_FLOOR_MIN ? mins : null,
    }

    if (!people.length) unassignedStops.push(stop)
    else for (const p of people) (stopsByPerson[p] = stopsByPerson[p] || []).push(stop)
  }

  // Everyone on shift, whether or not the board knows about them. A person with nothing assigned
  // is the single most important row here and the one the old planner could not render at all.
  const shiftMin: Record<string, number> = {}
  const roleOf: Record<string, string> = {}
  for (const s of (shifts as any[])) {
    if (!s?.name || s.open) continue
    const a = s.startAt ? new Date(s.startAt).getTime() : NaN
    const b = s.endAt ? new Date(s.endAt).getTime() : NaN
    const mins = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : 0
    if (mins > 0 && mins < 20 * 60) shiftMin[s.name] = (shiftMin[s.name] || 0) + mins
    if (s.role) roleOf[s.name] = str(s.role)
  }

  const names = Array.from(new Set([...Object.keys(shiftMin), ...Object.keys(stopsByPerson)]))
  const people: DayLoad[] = names.map(name => {
    const dept = crew ? crew.deptOf(name, roleOf[name] || null) : 'other'
    const person: Person = {
      name,
      dept: str(dept) || 'other',
      alsoDepts: [],
      shiftMinutes: shiftMin[name] ?? null,
    }
    return assessDay({ date, person, stops: stopsByPerson[name] || [] })
  }).sort((a, b) => a.utilisationPct - b.utilisationPct)

  if (!Object.keys(shiftMin).length) {
    notes.push('No Homebase shifts for this date, so every day is priced against an assumed 8 hours. Utilisation figures are indicative only.')
  }
  const credited = people.filter(p => p.verdict === 'implausible')
  if (credited.length) {
    notes.push(`${credited.map(p => p.person).join(', ')} ${credited.length === 1 ? 'is' : 'are'} credited with more work than a day can hold — almost certainly tasks closed out on the team's behalf. Left out of the day's figures, because counting them would hide every real imbalance.`)
  }
  if (closedOutToday) {
    notes.push(`${closedOutToday} clean${closedOutToday === 1 ? '' : 's'} today recorded under ${PERFORMED_FLOOR_MIN} minutes — closed out rather than performed, so the timings behind them are not real.`)
  }

  const suggestions = buildSuggestions(people, unassignedStops)

  // Everything the day is judged on excludes credited-not-worked days.
  const real = people.filter(p => p.verdict !== 'implausible')
  const sp = spread(people)
  const kpi: DayKpi = {
    peopleOnShift: Object.keys(shiftMin).length,
    cleans: real.reduce((a, p) => a + p.cleans, 0),
    otherTasks: real.reduce((a, p) => a + p.otherTasks, 0),
    unassignedCount: unassignedStops.length,
    workMinutes: real.reduce((a, p) => a + p.workMinutes, 0),
    travelMinutes: real.reduce((a, p) => a + p.travelMinutes, 0),
    capacityMinutes: real.reduce((a, p) => a + p.capacityMinutes, 0),
    utilisationPct: (() => {
      const cap = real.reduce((a, p) => a + p.capacityMinutes, 0)
      const load = real.reduce((a, p) => a + p.loadMinutes, 0)
      return cap > 0 ? Math.round((load / cap) * 100) : 0
    })(),
    spreadPct: sp.gapPct,
    overloaded: people.filter(p => p.verdict === 'overloaded').length,
    underloaded: people.filter(p => p.verdict === 'underloaded').length,
    implausible: people.filter(p => p.verdict === 'implausible').length,
    closedOutToday,
  }
  if (sp.note) notes.push(sp.note)

  const unassigned = unassignedStops.map(stop => {
    const c = unitCost(stop, null, { isFirstOfDay: false })
    return {
      stop,
      minutes: c.totalMin,
      market: stop.market ?? null,
      bestFor: suggestions.filter(s => s.stopId === stop.id).slice(0, 3),
    }
  }).sort((a, b) => b.minutes - a.minutes)

  return { date, people, unassigned, suggestions, kpi, notes }
}

/**
 * WHERE SHOULD THIS WORK GO?
 *
 * Two questions, one answer. Unassigned work needs an owner; an overloaded person needs relief.
 * Both are "who has room for this unit, and what does it cost them" — so both are answered by
 * pricing the unit against every candidate's actual remaining day and taking the cheapest fit.
 *
 * Deliberately conservative. It suggests only moves that leave the receiver inside their day, and
 * it says what the trade does to BOTH people rather than asserting an improvement. Nothing here
 * writes anything: a supervisor reads the trade and decides.
 */
export function buildSuggestions(people: DayLoad[], unassigned: Stop[]): Suggestion[] {
  const out: Suggestion[] = []
  const eligible = (p: DayLoad) => p.capacityMinutes > 0

  // 1. Unassigned work → whoever it costs least, among those with room.
  for (const stop of unassigned) {
    let best: { p: DayLoad; add: number } | null = null
    for (const p of people) {
      if (!eligible(p)) continue
      const last = p.ordered.length ? p.ordered[p.ordered.length - 1] : null
      const add = unitCost(stop, last, { isFirstOfDay: !last }).totalMin
      if (p.loadMinutes + add > p.capacityMinutes) continue      // would not fit
      if (!best || add < best.add) best = { p, add }
    }
    if (best) {
      const after = Math.round(((best.p.loadMinutes + best.add) / best.p.capacityMinutes) * 100)
      out.push({
        kind: 'assign',
        stopId: stop.id,
        unit: stop.unit,
        toPerson: best.p.person,
        toBeforePct: best.p.utilisationPct,
        toAfterPct: after,
        addedMinutes: best.add,
        why: `${stop.unit} has nobody on it. ${best.p.person} is the cheapest fit at ${best.add} min — takes them from ${best.p.utilisationPct}% to ${after}% of the day.`,
      })
    }
  }

  // 2. Overloaded → underloaded. Move the unit that helps most and still fits.
  // Never move work off an implausible day — we do not know which of those tasks the person
  // actually holds, so "relieving" them could hand away work somebody else already did.
  const over = people.filter(p => p.verdict === 'overloaded' && eligible(p))
  const under = people.filter(p => p.verdict === 'underloaded' && eligible(p))
  for (const from of over) {
    for (let i = from.units.length - 1; i >= 0; i--) {
      const u = from.units[i]
      const stop = from.ordered[i]
      if (!stop) continue
      let best: { p: DayLoad; add: number } | null = null
      for (const to of under) {
        const last = to.ordered.length ? to.ordered[to.ordered.length - 1] : null
        const add = unitCost(stop, last, { isFirstOfDay: !last }).totalMin
        if (to.loadMinutes + add > to.capacityMinutes) continue
        if (!best || add < best.add) best = { p: to, add }
      }
      if (best) {
        const fromAfter = Math.round(((from.loadMinutes - u.totalMin) / from.capacityMinutes) * 100)
        const toAfter = Math.round(((best.p.loadMinutes + best.add) / best.p.capacityMinutes) * 100)
        out.push({
          kind: 'move',
          stopId: stop.id,
          unit: stop.unit,
          fromPerson: from.person,
          toPerson: best.p.person,
          toBeforePct: best.p.utilisationPct,
          toAfterPct: toAfter,
          fromBeforePct: from.utilisationPct,
          fromAfterPct: fromAfter,
          addedMinutes: best.add,
          why: `${from.person} is at ${from.utilisationPct}% and will run over. Moving ${stop.unit} to ${best.p.person} brings them to ${fromAfter}% and takes ${best.p.person} from ${best.p.utilisationPct}% to ${toAfter}%.`,
        })
        break            // one suggestion per overloaded person; re-run after it is taken
      }
    }
  }

  return out
}
