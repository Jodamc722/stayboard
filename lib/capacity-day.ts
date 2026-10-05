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
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { DAY_TAG, freshEnough } from './bust'
import { getShifts } from './homebase'
import { getTimecardsAudited, type Timecard } from './homebase-labor'
import { getCrew } from './crew'
import { marketOf } from './segments'
import { getOpsPresets } from './app-settings'
import { vendorRegex } from './ops-presets'
import { isDepartureCleanName } from './breezeway'
import { assessDay, spread, unitCost, PERFORMED_FLOOR_MIN, type Stop, type DayLoad, type Person } from './capacity'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
/** Collapse whitespace so the two systems' spellings of one person land in one lane. */
import { nameMatches, nameMatchesRoster, bestSpelling } from './person-name'
const personName = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** One task on a person's day, for the Team rows on Today (Jon, 2026-10-01: open a person and see
 *  all of their tasks, grouped: departure cleans · inspections · maintenance · miscellaneous). */
export type PersonTask = {
  id: string
  unit: string
  building: string | null
  name: string
  group: 'clean' | 'inspection' | 'maintenance' | 'misc'
  status: 'done' | 'doing' | 'todo'
  minutes: number | null
  startedAt: string | null
  finishedAt: string | null
}

/** Homebase time card for the day (Jon, 2026-10-05: "see who's working"). null = no card read. */
export type PersonClock = { in: string | null; out: string | null; open: boolean }

export function taskGroupOf(name: string, dept: string | null | undefined): PersonTask['group'] {
  const n = String(name || '').toLowerCase()
  const d = String(dept || '').toLowerCase()
  if (isDepartureCleanName(name)) return 'clean'
  if (/inspect|walk ?through|unit check|arrival check|vip check|quality check/.test(n) || d === 'inspection') return 'inspection'
  if (d === 'maintenance' || /maint|repair|fix |broken|hvac|a\/c|ac unit|filter|plumb|leak|electric|lock|battery|pest|pressure wash|paint/.test(n)) return 'maintenance'
  return 'misc'
}

export type DayPicture = {
  date: string
  /** When this picture was priced — a cached copy is never served as if it were now (lib/bust). */
  builtAt?: string
  /** Every person on shift, whether or not they have work. `shiftStartMin` is ET minutes past midnight. */
  people: (DayLoad & { shiftStartMin?: number | null; shiftEndMin?: number | null; tasks?: PersonTask[]; clock?: PersonClock | null; crewDept?: string | null })[]
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
/** ET minutes past midnight, for a timestamp. */
function etMinutesOf(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  return (Number(p.find(x => x.type === 'hour')?.value || 0) % 24) * 60 + Number(p.find(x => x.type === 'minute')?.value || 0)
}

/**
 * The picture for a date, SHARED FOR 45 SECONDS (2026-09-28 audit). Today in Ops' landings, the
 * Command Center's team tile, /api/capacity, the Focus cron, Eve's watches and the shadow scheduler
 * each priced the same day on their own — a listings read, the day's tasks and a Homebase read
 * apiece, twice per Command Center build. One computation now serves them until the day tag is
 * bumped (lib/bust: an assign, a staged pick, a Breezeway change), and a cached copy older than two
 * minutes is rebuilt in place rather than served as now.
 */
export async function buildDayPicture(date: string, market?: string): Promise<DayPicture> {
  return freshEnough(() => cachedPicture(date, market || ''), () => buildDayPictureFresh(date, market), p => p.builtAt, PICTURE_MAX_AGE_MS)
}
const PICTURE_MAX_AGE_MS = 120_000
const cachedPicture = unstable_cache(
  async (date: string, market: string) => buildDayPictureFresh(date, market || undefined),
  ['day-picture-v1'], { tags: [DAY_TAG], revalidate: 45 },
)

async function buildDayPictureFresh(date: string, market?: string): Promise<DayPicture> {
  const db = supabaseAdmin()
  const notes: string[] = []

  // WHO IS ON THE CLOCK (2026-10-05). Today's Homebase time cards — best-effort and capped at 5s:
  // a slow Homebase must never hold up the day. Only for today; past days are settled elsewhere.
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const cardsP: Promise<Timecard[] | null> = date === todayET
    ? Promise.race([
        getTimecardsAudited(date, date).then(a => a.cards).catch(() => null),
        new Promise<null>(r => setTimeout(() => r(null), 5000)),
      ])
    : Promise.resolve(null)
  const [presets, crew, shifts, cards] = await Promise.all([
    getOpsPresets().catch(() => ({} as any)),
    getCrew().catch(() => null),
    getShifts(date).catch(() => [] as any[]),
    cardsP,
  ])
  const VENDOR_RE = vendorRegex((presets as any)?.vendorBuildings)

  // Listings: name, size, position, market. Small table, one read — and ONLY the two raw fields this
  // uses (2026-09-28 audit): selecting `raw` pulled every listing's multi-MB blob to read lat/lng.
  // A failed read throws rather than pricing an empty day (supabase-js does not throw on its own).
  const { data: lRows, error: lErr } = await db.from('guesty_listings')
    .select('id,nickname,title,building,unit,bedrooms,address_city,status,lat:raw->address->>lat,lng:raw->address->>lng')
    .order('id')
  if (lErr) throw new Error('could not read listings — ' + String(lErr.message || lErr).slice(0, 120))
  const lmap: Record<string, any> = {}
  for (const l of ((lRows as any[]) || [])) {
    const name = str(l.nickname) || str(l.title) || str(l.unit) || str(l.id)
    lmap[String(l.id)] = {
      name,
      building: str(l.building) || null,
      bedrooms: l.bedrooms == null ? null : Number(l.bedrooms),
      market: marketOf(l.building, l.address_city, name),
      lat: l.lat == null ? null : Number(l.lat),
      lng: l.lng == null ? null : Number(l.lng),
      vendor: VENDOR_RE ? VENDOR_RE.test(name) : false,
    }
  }

  // The day's board. One date, so this is small and needs no paging.
  const { data: tRows, error: tErr } = await db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,assignees,assignee_name,started_at,finished_at,total_minutes,type_department')
    .eq('scheduled_date', date).order('id').limit(1000) // deliberate cap: one day's tasks, ~100 across the portfolio
  if (tErr) throw new Error('could not read the day\'s tasks — ' + String(tErr.message || tErr).slice(0, 120))

  const stopsByPerson: Record<string, Stop[]> = {}
  const tasksByPerson: Record<string, PersonTask[]> = {}
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
    // ONE PERSON, ONE LANE. Breezeway wrote "Gehron  Regis" (two spaces) on the tasks and Homebase
    // wrote "Gehron Regis" on the shift, so the model priced two people: one implausible (23 tasks,
    // no shift) and one at 0% with "room for 3 more cleans" (2026-09-02). Same fix OpsGrid took.
    const people: string[] = (Array.isArray(t.assignees)
      ? t.assignees.map((a: any) => str(a?.name))
      : (t.assignee_name ? [str(t.assignee_name)] : [])).map(personName).filter(Boolean)

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
    const task: PersonTask = {
      id: str(t.id), unit: li.name, building: li.building || null, name: str(t.name),
      group: taskGroupOf(t.name, t.type_department),
      status: t.finished_at || /finish|complet|done|closed/.test(status) ? 'done' : (t.started_at || /progress|started|working/.test(status) ? 'doing' : 'todo'),
      minutes: Number.isFinite(mins) && mins > 0 ? mins : null,
      startedAt: t.started_at ? str(t.started_at) : null, finishedAt: t.finished_at ? str(t.finished_at) : null,
    }
    for (const p of people) (tasksByPerson[p] = tasksByPerson[p] || []).push(task)
  }

  // Everyone on shift, whether or not the board knows about them. A person with nothing assigned
  // is the single most important row here and the one the old planner could not render at all.
  const shiftMin: Record<string, number> = {}
  const roleOf: Record<string, string> = {}
  // WHEN THEY START. The model priced how long a day takes and never asked when it begins, so it
  // could say "9h 42m of work" and not "the last unit lands at 6:10pm" — which is the sentence a
  // coordinator actually needs against a 4pm deadline.
  const shiftStartMin: Record<string, number> = {}
  const shiftEndMin: Record<string, number> = {}
  for (const s of (shifts as any[])) {
    if (!s?.name || s.open) continue
    s.name = personName(s.name)
    const a = s.startAt ? new Date(s.startAt).getTime() : NaN
    const b = s.endAt ? new Date(s.endAt).getTime() : NaN
    const mins = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : 0
    if (mins > 0 && mins < 20 * 60) shiftMin[s.name] = (shiftMin[s.name] || 0) + mins
    if (Number.isFinite(a)) {
      const m = etMinutesOf(new Date(a))
      if (shiftStartMin[s.name] == null || m < shiftStartMin[s.name]) shiftStartMin[s.name] = m
    }
    if (Number.isFinite(b)) {
      const m = etMinutesOf(new Date(b))
      if (shiftEndMin[s.name] == null || m > shiftEndMin[s.name]) shiftEndMin[s.name] = m
    }
    if (s.role) roleOf[s.name] = str(s.role)
  }

  // ONE PERSON, ONE ROW (2026-10-05). Homebase and Breezeway spell people differently — "Vilma
  // Martinez" / "vilma martinez", "Elianys" / "Elyanis Cardenas", "Yunisleydi" / "Yunisleidi Perez",
  // "Yoslenis Rodiguez" / "Rodriguez" — and the exact-string join split each into two Team rows: one
  // with the shift and no work ("nothing assigned"), one with the work and "no shift on record". Each
  // Breezeway name is folded onto the Homebase person it matches (the same matcher the scheduler and
  // payroll use), so the shift and the tasks meet on one row.
  {
    const shiftNames = Object.keys(shiftMin)
    const fold = <T,>(m: Record<string, T[]>) => {
      for (const k of Object.keys(m)) {
        if (shiftMin[k] != null) continue
        const to = nameMatchesRoster(k, shiftNames)
        if (!to || to === k) continue
        m[to] = (m[to] || []).concat(m[k]); delete m[k]
      }
    }
    fold(stopsByPerson); fold(tasksByPerson)
    // Two Breezeway spellings of someone with no shift today still collapse to one row.
    const fold2 = <T,>(m: Record<string, T[]>) => {
      const ks = Object.keys(m).filter(k => shiftMin[k] == null)
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i], b = ks[j]
        if (!m[a] || !m[b] || !nameMatches(a, b)) continue
        const keep = bestSpelling(a, b) === a ? a : b, drop = keep === a ? b : a
        m[keep] = m[keep].concat(m[drop]); delete m[drop]
      }
    }
    fold2(stopsByPerson); fold2(tasksByPerson)
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
    const load = assessDay({ date, person, stops: stopsByPerson[name] || [] })
    let clock: PersonClock | null = null
    if (cards) {
      const mine = cards.filter(c => (c.date || date) === date && nameMatches(c.name, name))
      if (mine.length) {
        const ins = mine.map(c => c.clockIn).filter(Boolean).sort() as string[]
        const outs = mine.map(c => c.clockOut).filter(Boolean).sort() as string[]
        const open = mine.some(c => c.open)
        clock = { in: ins[0] || null, out: open ? null : (outs[outs.length - 1] || null), open }
      } else clock = { in: null, out: null, open: false }
    }
    // crewDept: the Crew & roles department (lib/crew) — null when the roster could not be read, so
    // a missing roster never hides anyone from Who's working.
    return { ...load, shiftStartMin: shiftStartMin[name] ?? null, shiftEndMin: shiftEndMin[name] ?? null, tasks: tasksByPerson[name] || [], clock, crewDept: crew ? str(dept) : null }
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

  // NEVER ASSIGN (lib/never-assign, Jon 2026-09-30): nobody on the list is ever the receiving end of
  // a move or an assign suggestion. They stay in `people` — their day is still priced as it is.
  let blocked: (name: string) => boolean = () => false
  try { const { neverAssignGuard } = await import('./never-assign'); const g = await neverAssignGuard(); if (g.active) blocked = (n: string) => g.blocks(n) } catch { /* suggestions as before; the assign endpoints still refuse */ }
  const suggestions = buildSuggestions(people, unassignedStops, blocked)

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

  return { date, builtAt: new Date().toISOString(), people, unassigned, suggestions, kpi, notes }
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
export function buildSuggestions(people: DayLoad[], unassigned: Stop[], blocked: (name: string) => boolean = () => false): Suggestion[] {
  const out: Suggestion[] = []
  // A person on the never-assign list is never a candidate to RECEIVE work (moving work off them is fine).
  const eligible = (p: DayLoad) => p.capacityMinutes > 0 && !blocked(p.person)

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
  const over = people.filter(p => p.verdict === 'overloaded' && p.capacityMinutes > 0)
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
