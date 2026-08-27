// WHAT A PERSON'S DAY CAN ACTUALLY HOLD.
//
// Jon, 2026-08-27: "the standard should be for cleans. If not, it should be a trigger. Things to
// consider are: distance, commute, that's gonna add to the number of units that they can actually
// clean, bedroom size, etc."
//
// THE IDEA IN ONE LINE: a day is a budget of minutes, and every unit spends some of it — the clean
// itself, sized by the unit, plus the travel to get there. The STANDARD is how many units of the
// mix in front of you fit in that budget. Anything materially under or over the standard is a
// TRIGGER, because it means the day was planned against a number nobody checked.
//
// WHY A MINUTE BUDGET AND NOT A FLAT "CLEANS PER PERSON". The flat number is what the app uses
// today (lib/ops-presets Roster.rate — Miami 5, Broward 4, North 4) and it is wrong in both
// directions at once. Measured over 585 person-days to 2026-08-26: Miami's median is 2 against an
// assumed 5, Broward's is 4 against an assumed 4, North's is 1 against an assumed 4. A flat number
// cannot be right, because four studios in one tower and four three-beds across three cities are
// not the same day. Minutes can tell those apart. Units cannot.
//
// WHAT IS MEASURED AND WHAT IS ASSUMED — the honest split, because a model that hides this gets
// believed further than it deserves:
//   MEASURED   clean duration by bedroom count (1,232 solo cleans, 90 days — see CLEAN_MINUTES)
//   MEASURED   that staying in one building is worth ~17% on a 3-unit day, and nothing at 4+
//   ASSUMED    travel minutes (there is no GPS trace; see TRAVEL, calibrate when there is)
//   ASSUMED    maintenance task duration (Breezeway records no estimate anywhere — see OTHER_TASK)
// Every assumption below is a named constant with a reason, so the first person to get real data
// can replace it without reading the whole file.
import 'server-only'
import { distanceKm } from './geo-areas'

// ── The measured clean standard ────────────────────────────────────────────────────────────────
//
// Observed median minutes for SOLO departure cleans, 2026-05-29 → 2026-08-26, vendor units
// excluded, n = 1,232. The configured benchmark is in brackets:
//
//   studio   73  (90)    n=547
//   1 bed    86  (90)    n=312
//   2 bed   112 (120)    n=278
//   3 bed+  113 (180)    n=95
//
// TWO THINGS THE CONFIGURED BENCHMARK GETS WRONG.
// 1. It treats a studio and a one-bed as the same job (both 90). They differ by 13 minutes, every
//    time, across 859 cleans. A one-bed deserves its own tier.
// 2. It prices a three-bed at 180 minutes and the floor does it in 113 — the same as a two-bed.
//    That is a 67-minute error on the biggest units, and it is the reason a person holding two
//    three-beds reads as a full day (360 min) when the work is closer to 226. Treat the 3-bed
//    figure as provisional: n=95 is the thinnest sample here, and big units are the ones most
//    likely to be quietly cleaned by two people, which would flatter a solo-only median.
//
// Padded ~8% above the observed median on purpose. The median is the day that went well; half of
// all cleans took longer than this, and a standard set at the median guarantees half the days run
// over. This is a planning figure, not a target to beat.
export const CLEAN_MINUTES: Record<CleanSize, number> = {
  studio: 80,
  one: 93,
  two: 121,
  threePlus: 130,
}
export type CleanSize = 'studio' | 'one' | 'two' | 'threePlus'

export function sizeOf(bedrooms: number | null | undefined): CleanSize {
  if (bedrooms == null) return 'one'          // unknown sits mid-range rather than cheapest
  if (bedrooms <= 0) return 'studio'
  if (bedrooms === 1) return 'one'
  if (bedrooms === 2) return 'two'
  return 'threePlus'
}

/** Minutes the clean itself should take, before any travel. */
export function cleanMinutes(bedrooms: number | null | undefined, table = CLEAN_MINUTES): number {
  return table[sizeOf(bedrooms)]
}

// ── Travel: the part that eats the day ─────────────────────────────────────────────────────────
//
// ASSUMED, and openly so. Nobody carries a tracker, so there is no observed drive time to fit to.
// What the data does show is the SHAPE: a 3-unit day inside one building runs ~17% more efficient
// than 3 units spread across buildings, and by 4 units the advantage is gone entirely. So travel
// has to be real enough to make clustering win at small counts without dominating a big day.
//
//   SAME BUILDING     the lift, the cart, the next floor. Real, small, and never zero — an eight
//                     unit tower day is not eight cleans back to back with no gap.
//   NEW BUILDING      park, unpark, find the unit, key or code, first contact. This fixed cost is
//                     most of a short hop and is why two buildings 800m apart still cost real time.
//   PER KM            street speed in Broward and Miami with lights and bridges, not motorway.
//
// Calibrate these three numbers first when GPS or clock-in-location data ever exists. Until then
// they are a considered guess, and the model says so wherever it reports a travel figure.
export const TRAVEL = {
  sameBuildingMin: 6,
  newBuildingFixedMin: 12,
  perKmMin: 2.5,
  maxHopMin: 60,        // beyond an hour something is wrong with the plan, not the drive
  unknownHopMin: 20,    // one or both units have no coordinates
}

// ── The cost of ONE unit ───────────────────────────────────────────────────────────────────────
//
// Jon, 2026-08-27: "we need to look at commute, prep time, etc. This needs to be considered at the
// unit level ... it makes it easier to schedule."
//
// He is right, and it is the thing that makes the whole model usable. If a unit's cost is only the
// scrubbing time, then scheduling is a judgement call every time — because the same studio costs
// forty minutes when it is the next door down and ninety when it is across the county. Give every
// unit its TRUE cost in the position it actually sits, and scheduling stops being judgement and
// becomes packing: each person has a budget of minutes, each unit has a price, fill the budget.
//
// So a unit costs four things, not one:
//
//   TRAVEL IN   getting there from wherever the last job was. Zero for the first unit of the day —
//               that part is commute, and commute is the person's own time (see COMMUTE below).
//   PREP        park, get in, lift, cart, linens up, supplies. Happens once per unit and does not
//               shrink because the unit is small — a studio needs the same trip up as a three-bed.
//   CLEAN       the work itself, sized by bedrooms, measured (CLEAN_MINUTES above).
//   WRAP        photos, the checklist, lock up, mark it done.
//
// PREP AND WRAP ARE WHY SMALL UNITS ARE NOT CHEAP. A studio's 80 minutes of cleaning carries ~16
// minutes of overhead either side, so five studios in one tower is not 400 minutes, it is nearly
// 500 — and that gap is exactly the amount by which a flat cleans-per-person number misleads you.
export const UNIT_OVERHEAD = {
  prepMin: 10,
  wrapMin: 6,
  /** Loading up at the start of a day: van, linens, supplies for the whole run. Once, not per unit. */
  dayStartMin: 15,
}

// COMMUTE — the trip in and the trip home.
//
// Distinct from travel between jobs, and distinct again from prep, because it is usually the
// person's own unpaid time and it does NOT come out of the working budget. It still belongs in the
// model for one reason: it decides where somebody should reasonably start. Sending a Broward-based
// cleaner to open the day in Miami costs them an hour they are not paid for, and it is the fastest
// way to turn a good schedule into a resented one.
//
// WE DO NOT HOLD HOME ADDRESSES, and I have not invented any. When a person has no base on record
// the commute is reported as unknown rather than guessed, and the scheduler simply does not use it.
// Set a base per person in Settings and it starts working — nothing else has to change.
export const COMMUTE = {
  /** Beyond this, flag the assignment as a long trip in even though it is unpaid time. */
  longMin: 45,
}

/** Minutes to get from one stop to the next. */
export function hopMinutes(
  a: { building?: string | null; lat?: number | null; lng?: number | null },
  b: { building?: string | null; lat?: number | null; lng?: number | null },
  t = TRAVEL,
): number {
  const sameBuilding = !!a.building && !!b.building &&
    String(a.building).trim().toLowerCase() === String(b.building).trim().toLowerCase()
  if (sameBuilding) return t.sameBuildingMin
  const km = distanceKm(a, b)
  if (!Number.isFinite(km)) return t.unknownHopMin
  return Math.min(t.maxHopMin, Math.round(t.newBuildingFixedMin + km * t.perKmMin))
}

export type Stop = {
  id: string
  unit: string
  building?: string | null
  lat?: number | null
  lng?: number | null
  bedrooms?: number | null
  /** How many people are on this task. Two cleaners on one unit each spend roughly half the time. */
  crewSize?: number
  /** Not a clean — a maintenance or inspection job sitting in the same person's day. */
  kind?: 'clean' | 'other'
  /** Known duration, when something better than an estimate exists. */
  knownMinutes?: number | null
}

/**
 * Order the stops into a sensible run and total the travel.
 *
 * Nearest-neighbour from the first stop. Deliberately NOT an optimal tour: a cleaner's day is 2–6
 * stops, where nearest-neighbour is within a few minutes of optimal, and a route a supervisor can
 * predict is worth more than one that is three minutes shorter and reorders itself every refresh.
 */
export function routeStops(stops: Stop[]): { ordered: Stop[]; travelMinutes: number; hops: number } {
  if (stops.length <= 1) return { ordered: stops.slice(), travelMinutes: 0, hops: 0 }
  const left = stops.slice()
  const ordered: Stop[] = [left.shift() as Stop]
  let travel = 0
  let hops = 0
  while (left.length) {
    const from = ordered[ordered.length - 1]
    let bestI = 0
    let bestMin = Infinity
    for (let i = 0; i < left.length; i++) {
      const m = hopMinutes(from, left[i])
      if (m < bestMin) { bestMin = m; bestI = i }
    }
    const next = left.splice(bestI, 1)[0]
    travel += bestMin
    if (bestMin > TRAVEL.sameBuildingMin) hops++
    ordered.push(next)
  }
  return { ordered, travelMinutes: Math.round(travel), hops }
}

/**
 * THE PRICE OF ONE UNIT, in the position it actually sits.
 *
 * `from` is the previous stop of that person's day, or null when this is their first job. Pass the
 * same unit with a different `from` and the price changes — which is the whole point: this is what
 * the unit costs THIS person THIS day, not an average.
 */
export type UnitCost = {
  id: string
  unit: string
  building: string | null
  travelInMin: number
  prepMin: number
  workMin: number
  wrapMin: number
  totalMin: number
  /** Split across everyone on the job. Two people on one unit each carry half of it. */
  crewSize: number
  /** True when the work minutes are a guess rather than a measured benchmark. */
  estimated: boolean
}

export function unitCost(
  stop: Stop,
  from: Stop | null,
  opts: { cleanTable?: Record<CleanSize, number>; isFirstOfDay?: boolean } = {},
): UnitCost {
  const table = opts.cleanTable || CLEAN_MINUTES
  const crew = Math.max(1, Number(stop.crewSize) || 1)
  const isClean = (stop.kind || 'clean') === 'clean'

  let workMin: number
  let estimated = false
  if (Number.isFinite(stop.knownMinutes as any)) {
    workMin = Number(stop.knownMinutes)
  } else if (isClean) {
    workMin = cleanMinutes(stop.bedrooms, table)
  } else {
    workMin = OTHER_TASK.defaultMinutes
    estimated = true
  }

  const travelInMin = from ? hopMinutes(from, stop) : 0
  const prepMin = UNIT_OVERHEAD.prepMin + (opts.isFirstOfDay ? UNIT_OVERHEAD.dayStartMin : 0)
  const wrapMin = UNIT_OVERHEAD.wrapMin

  // Travel and prep are paid once by the person making the trip; only the work itself divides
  // across a crew. Two cleaners in one unit do not each drive there separately.
  const total = travelInMin + prepMin + workMin / crew + wrapMin

  return {
    id: stop.id,
    unit: stop.unit,
    building: stop.building ?? null,
    travelInMin,
    prepMin,
    workMin: Math.round(workMin / crew),
    wrapMin,
    totalMin: Math.round(total),
    crewSize: crew,
    estimated,
  }
}

/** Price a whole run in order, so the numbers sum to the day. */
export function priceRun(ordered: Stop[], cleanTable?: Record<CleanSize, number>): UnitCost[] {
  return ordered.map((s, i) => unitCost(s, i === 0 ? null : ordered[i - 1], {
    cleanTable, isFirstOfDay: i === 0,
  }))
}

// ── Everything that is not a clean ─────────────────────────────────────────────────────────────
//
// ASSUMED, and the weakest number in this file. Breezeway stores no duration estimate for any
// task, of any kind — only elapsed time after the fact, and only when somebody remembered to run
// the timer. So a maintenance job's cost to the day is a flat guess until either Breezeway starts
// carrying estimates or we fit our own from history by task name.
//
// A flat 45 covers the ordinary run of it — a filter, a bulb, a leak somebody already diagnosed.
// It will badly understate a repaint and overstate a battery swap. Anywhere this number moves the
// answer, the model marks the result low-confidence rather than quietly presenting a guess as a
// measurement.
export const OTHER_TASK = {
  defaultMinutes: 45,
  /** Moving between departments costs focus, tools and often a van. Charged once, not per switch. */
  hybridSwitchMin: 20,
}

// ── The budget ─────────────────────────────────────────────────────────────────────────────────

export const SHIFT = {
  /** Unpaid break, applied to shifts at or over this length. */
  breakMin: 30,
  breakAppliesOverMin: 6 * 60,
  /** Nobody plans to the last minute; leave room for the day to be a day. */
  contingencyPct: 8,
  /** With no shift on record, assume a standard day rather than refusing to answer. */
  assumedShiftMin: 8 * 60,
}

export type Person = {
  name: string
  /** Primary department from lib/crew. */
  dept: string
  /**
   * HYBRID PEOPLE. Jon, 2026-08-27: "sometimes a supervisor or maintenance hybrid might clean a
   * unit but also do other maintenance tasks as well ... maybe Abel would do maintenance and clean
   * sometimes."
   *
   * A hybrid is not someone with two jobs — it is someone with ONE day that two different queues
   * both draw on. Modelling them as a cleaner makes their maintenance work invisible; modelling
   * them as maintenance makes their cleans look like somebody else's. Either way the day silently
   * overfills. Listing the extra departments here means both queues spend from the same budget.
   */
  alsoDepts?: string[]
  /** Scheduled minutes from Homebase. Null when there is no shift on record. */
  shiftMinutes?: number | null
  /**
   * Where they set out from. Optional and usually absent — we hold no home addresses, and I have
   * not invented any. Supply it and commute becomes real; leave it and commute reports unknown.
   */
  base?: { lat?: number | null; lng?: number | null; label?: string | null } | null
}

export type DayLoad = {
  person: string
  date: string
  /** What is on their plate. */
  cleans: number
  otherTasks: number
  /** Minutes: the work itself, the travel, and the two together. */
  workMinutes: number
  travelMinutes: number
  loadMinutes: number
  /** Minutes available after break and contingency. */
  capacityMinutes: number
  utilisationPct: number
  /** How many more cleans of the mix they are already doing would still fit. */
  headroomCleans: number
  /** The STANDARD: cleans this person's day can hold, at the average size of what they have. */
  standardCleans: number
  hops: number
  buildings: number
  verdict: 'underloaded' | 'balanced' | 'overloaded' | 'unknown'
  /** Plain sentences a person can act on. Never a bare number. */
  triggers: string[]
  /** True when a guessed duration (maintenance, or a missing shift) moved the verdict. */
  lowConfidence: boolean
  ordered: Stop[]
  /** Every unit with its own true price, in the order it would be worked. */
  units: UnitCost[]
  /** The trip in, when a base is on record. Unpaid, so it does NOT spend the work budget. */
  commuteInMin: number | null
  hybrid: boolean
}

export const THRESHOLD = {
  underPct: 65,          // below this much of the day used, there is room for more work
  overPct: 105,          // above this, the day does not fit and something will slip
  /** Jon's maintenance rule: fewer than this many jobs on a full shift is worth a look. */
  minMaintenanceTasks: 3,
}

/**
 * THE MODEL. Given a person, their day, and what is on it, say whether the day fits — and if it
 * does not, say why in words somebody can act on.
 */
export function assessDay(input: {
  date: string
  person: Person
  stops: Stop[]
  thresholds?: Partial<typeof THRESHOLD>
  cleanTable?: Record<CleanSize, number>
}): DayLoad {
  const th = { ...THRESHOLD, ...(input.thresholds || {}) }
  const table = input.cleanTable || CLEAN_MINUTES
  const stops = input.stops || []
  const cleans = stops.filter(s => (s.kind || 'clean') === 'clean')
  const others = stops.filter(s => s.kind === 'other')

  // Order the run first, then price each unit where it actually sits. The day is the sum of its
  // units — travel, prep, work and wrap all attributed to the unit that caused them — so the same
  // numbers that explain the day can be used to schedule it.
  const { ordered, travelMinutes, hops } = routeStops(stops)
  const priced = priceRun(ordered, table)

  const work = priced.reduce((a, u) => a + u.workMin + u.prepMin + u.wrapMin, 0)
  const guessedWork = priced.some(u => u.estimated)
  let guessed = guessedWork

  // A hybrid paying the switch cost once, only when the day genuinely mixes the two.
  const hybrid = !!(input.person.alsoDepts && input.person.alsoDepts.length)
  const mixed = cleans.length > 0 && others.length > 0
  const switchCost = mixed ? OTHER_TASK.hybridSwitchMin : 0

  const load = Math.round(priced.reduce((a, u) => a + u.totalMin, 0) + switchCost)

  // Budget.
  const rawShift = Number.isFinite(input.person.shiftMinutes as any) && (input.person.shiftMinutes as number) > 0
    ? Number(input.person.shiftMinutes)
    : null
  if (rawShift == null) guessed = true
  const shift = rawShift ?? SHIFT.assumedShiftMin
  const afterBreak = shift >= SHIFT.breakAppliesOverMin ? shift - SHIFT.breakMin : shift
  const capacity = Math.max(0, Math.round(afterBreak * (1 - SHIFT.contingencyPct / 100)))

  const utilisation = capacity > 0 ? Math.round((load / capacity) * 100) : 0

  // The standard, expressed in the units of the day actually in front of them: average cost of one
  // more clean of the size they are already doing, plus a typical hop to reach it.
  // The marginal cost of ONE more unit — the number that decides whether another job fits. Taken
  // from what this person's units actually cost today, not from a table average, because a day of
  // Elser studios and a day of Broward three-beds have very different next-unit prices.
  const cleanPrices = priced.filter((_, i) => (ordered[i].kind || 'clean') === 'clean').map(u => u.totalMin)
  const marginalMin = cleanPrices.length
    ? Math.round(cleanPrices.reduce((a, b) => a + b, 0) / cleanPrices.length)
    : table.one + UNIT_OVERHEAD.prepMin + UNIT_OVERHEAD.wrapMin + TRAVEL.newBuildingFixedMin
  const standardCleans = marginalMin > 0 ? Math.floor(capacity / marginalMin) : 0
  const headroom = marginalMin > 0 ? Math.floor(Math.max(0, capacity - load) / marginalMin) : 0

  const buildings = new Set(stops.map(s => String(s.building || s.unit || '?').toLowerCase())).size

  // Commute in, when we know where they start from. Reported, never charged to the work budget.
  const base = input.person.base
  const commuteInMin = base && base.lat != null && base.lng != null && ordered.length
    ? hopMinutes({ lat: base.lat, lng: base.lng, building: null }, ordered[0])
    : null

  let verdict: DayLoad['verdict'] = 'balanced'
  if (!stops.length) verdict = 'underloaded'
  else if (utilisation < th.underPct) verdict = 'underloaded'
  else if (utilisation > th.overPct) verdict = 'overloaded'

  // ── Triggers. Each one is a sentence, because "utilisation 58%" is not an instruction. ──
  const triggers: string[] = []
  const hrs = (m: number) => (m / 60).toFixed(1) + 'h'

  if (!stops.length) {
    triggers.push(`Nothing assigned. A ${hrs(capacity)} day is completely open — roughly ${standardCleans} cleans, or a maintenance run.`)
  } else if (verdict === 'underloaded') {
    triggers.push(`About ${hrs(capacity - load)} spare — room for roughly ${headroom} more ${headroom === 1 ? 'unit' : 'units'} without running over.`)
  } else if (verdict === 'overloaded') {
    triggers.push(`Over by about ${hrs(load - capacity)}. Something here will finish late or get rushed — move a unit before the day starts, not at 3pm.`)
  }

  // The maintenance rule, applied to whoever maintenance is actually part of the job for.
  const doesMaintenance = /maint/i.test(input.person.dept) ||
    (input.person.alsoDepts || []).some(d => /maint/i.test(d))
  if (doesMaintenance && others.length < th.minMaintenanceTasks && rawShift != null) {
    triggers.push(`${others.length === 0 ? 'No' : String(others.length)} maintenance ${others.length === 1 ? 'job' : 'jobs'} on a full shift — under the ${th.minMaintenanceTasks} the day should hold. Worth filling from the open queue.`)
  }

  // Clustering, which the data says only pays below four units.
  if (cleans.length > 0 && cleans.length < 4 && buildings > 1) {
    triggers.push(`${cleans.length} cleans across ${buildings} buildings. Below four units, a single-building day runs about 17% faster — worth a swap if another cleaner is already in one of these towers.`)
  }
  if (travelMinutes >= 90) {
    triggers.push(`${hrs(travelMinutes)} of this day is travel across ${hops} ${hops === 1 ? 'hop' : 'hops'} — nearly ${Math.round((travelMinutes / Math.max(1, load)) * 100)}% of the day spent getting there.`)
  }
  if (commuteInMin != null && commuteInMin >= COMMUTE.longMin) {
    triggers.push(`${commuteInMin} min commute to the first stop${ordered.length ? ' (' + ordered[0].unit + ')' : ''} — their own time, before the shift starts. Worth opening somewhere nearer if the run allows.`)
  }
  if (mixed && hybrid) {
    triggers.push(`Mixed day: ${cleans.length} ${cleans.length === 1 ? 'clean' : 'cleans'} and ${others.length} maintenance. Both are counted against the same hours.`)
  }
  if (mixed && !hybrid) {
    triggers.push(`Has both cleans and maintenance but is not set up as a hybrid, so one of those queues is planning around them. Set the hybrid roles in Settings if this is deliberate.`)
  }

  return {
    person: input.person.name,
    date: input.date,
    cleans: cleans.length,
    otherTasks: others.length,
    workMinutes: Math.round(work),
    travelMinutes,
    loadMinutes: load,
    capacityMinutes: capacity,
    utilisationPct: utilisation,
    headroomCleans: headroom,
    standardCleans,
    hops,
    buildings,
    verdict,
    triggers,
    lowConfidence: guessed,
    ordered,
    units: priced,
    commuteInMin,
    hybrid,
  }
}

/**
 * How lopsided is one day across a team? The single biggest finding in the 90-day review: on 53 of
 * 60 days somebody held one unit while a colleague held four or more, in the same market. Fixing
 * that needs no routing and no travel model — only somebody being told it is happening.
 */
export function spread(days: DayLoad[]): {
  people: number
  medianUtil: number
  minUtil: number
  maxUtil: number
  gapPct: number
  lopsided: boolean
  note: string | null
} {
  const withWork = days.filter(d => d.capacityMinutes > 0)
  if (withWork.length < 2) {
    return { people: withWork.length, medianUtil: 0, minUtil: 0, maxUtil: 0, gapPct: 0, lopsided: false, note: null }
  }
  const u = withWork.map(d => d.utilisationPct).sort((a, b) => a - b)
  const mid = Math.floor(u.length / 2)
  const median = u.length % 2 ? u[mid] : Math.round((u[mid - 1] + u[mid]) / 2)
  const min = u[0]
  const max = u[u.length - 1]
  const gap = max - min
  const lopsided = gap >= 45
  const lightest = withWork.find(d => d.utilisationPct === min)
  const heaviest = withWork.find(d => d.utilisationPct === max)
  return {
    people: withWork.length,
    medianUtil: median,
    minUtil: min,
    maxUtil: max,
    gapPct: gap,
    lopsided,
    note: lopsided && lightest && heaviest
      ? `${heaviest.person} is at ${max}% of the day while ${lightest.person} is at ${min}%. Moving one unit across closes most of that.`
      : null,
  }
}
