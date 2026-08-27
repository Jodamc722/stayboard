// WHO SHOULD ACTUALLY TAKE THIS JOB.
//
// Jon, 2026-08-27: "we should have Eve really understand the operations and make calculated
// decisions based on available units, where team members are going to be. If there are any pending
// tasks in that unit, Eve needs to be really understanding operations as well."
//
// ── THE THING THAT WAS BACKWARDS ────────────────────────────────────────────────────────────────
// The suggestion engine already reasons about proximity: it will not propose a filter change unless
// somebody from that trade is standing in that building today, and it ranks by who is nearest
// (lib/suggestions.ts — `proximity: 'building' | 'area' | 'none'`). That is genuinely good
// reasoning, and it was pointed at the LOWEST-stakes decision in the app: whether to do preventative
// maintenance.
//
// Meanwhile the highest-stakes decision on the board — who takes the departure clean that is going
// to blow the 4pm deadline — was served by `roster.slice(0, 14)`: the first fourteen people in
// whatever order Breezeway returned them, alphabetical, no search, no load, no location. The
// fifteenth person on the roster could not be assigned from this board at all.
//
// This file points the same reasoning at the decision that matters. It is deliberately PURE — no
// fetch, no server import — because every input is already on the board: who is assigned where
// today comes from the units payload, who is on shift comes from the staffing payload, and the
// roster is already fetched. Ranking cost nothing but wiring.
//
// ── WHAT IT WEIGHS, AND WHY IN THIS ORDER ───────────────────────────────────────────────────────
// 1. ALREADY AT THIS UNIT. They are through the door. Nothing else comes close — a second job in a
//    unit somebody is standing in is close to free, and a first job in a unit nobody is visiting
//    costs a drive each way.
// 2. ALREADY IN THIS BUILDING. A different unit in the same tower is an elevator ride.
// 3. IN THIS MARKET. Same city, still a drive, but not a cross-county one.
// 4. TRADE. A housekeeper can technically be handed a maintenance ticket; it is rarely right, so
//    the wrong trade is pushed down hard but never hidden — sometimes the only body available is
//    the wrong one, and an assign list that refuses to show them is an assign list you work around.
// 5. LOAD. Among equals, the person carrying least open work.
// 6. ON THE CLOCK. Somebody not clocked in may be off shift entirely.
//
// Every candidate carries the sentence explaining its own rank, for the same reason the suggestions
// do: a ranking a coordinator cannot audit is a ranking they will ignore.

export type RankPerson = { id: number; name: string; departments?: string[] }

export type AssignContext = {
  /** Department the task belongs to: 'housekeeping' | 'maintenance' | 'inspection' | other. */
  dept: string
  /** The unit the task is on. */
  listingId?: string | null
  /** Canonical building bucket for that unit. */
  building?: string | null
  market?: string | null
  /** Per person: where they already have work today, and how much of it is still open. */
  atUnit: Set<string>                       // names with a task on THIS unit today
  inBuilding: Set<string>                   // names with a task in this building today
  inMarket: Set<string>                     // names with a task in this market today
  openLoad: Record<string, number>          // name -> open tasks today
  doneLoad: Record<string, number>          // name -> finished tasks today
  clockedIn: Set<string>                    // names on the clock (from staffing)
  onShift: Set<string>                      // names scheduled today at all
}

export type Ranked = {
  person: RankPerson
  score: number
  /** The one line a coordinator reads to decide whether the ranking is sane. */
  why: string
  /** Drives the visual tier — how close they are, in the sense that matters. */
  proximity: 'unit' | 'building' | 'area' | 'none'
  rightTrade: boolean
  openTasks: number
  clockedIn: boolean
}

const norm = (s: any) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Does this person's department list cover the task's trade? Tolerant — the strings drift. */
export function tradeMatches(p: RankPerson, dept: string): boolean {
  const want = norm(dept)
  if (!want || want === 'other') return true
  const ds = (p.departments || []).map(norm).join(' ')
  if (!ds) return false
  if (/housekeep|clean/.test(want)) return /housekeep|clean/.test(ds)
  if (/maint/.test(want)) return /maint/.test(ds)
  if (/inspect/.test(want)) return /inspect|audit|quality/.test(ds)
  return ds.includes(want.slice(0, 6))
}

export function rankAssignees(roster: RankPerson[], ctx: AssignContext): Ranked[] {
  const out: Ranked[] = roster.map(p => {
    const n = norm(p.name)
    const has = (set: Set<string>) => Array.from(set).some(x => norm(x) === n)
    const open = ctx.openLoad[p.name] ?? Object.keys(ctx.openLoad).filter(k => norm(k) === n).reduce((a, k) => a + ctx.openLoad[k], 0)
    const done = ctx.doneLoad[p.name] ?? Object.keys(ctx.doneLoad).filter(k => norm(k) === n).reduce((a, k) => a + ctx.doneLoad[k], 0)
    const rightTrade = tradeMatches(p, ctx.dept)
    const clocked = has(ctx.clockedIn)
    const scheduled = clocked || has(ctx.onShift)

    let score = 0
    let proximity: Ranked['proximity'] = 'none'
    const bits: string[] = []

    if (has(ctx.atUnit)) {
      score += 100; proximity = 'unit'
      bits.push('already at this unit')
    } else if (has(ctx.inBuilding)) {
      score += 60; proximity = 'building'
      bits.push(`in ${ctx.building || 'this building'} today`)
    } else if (has(ctx.inMarket)) {
      score += 22; proximity = 'area'
      bits.push(`working ${ctx.market || 'this area'} today`)
    }

    // The wrong trade is a heavy penalty, NOT a filter — see the header.
    if (!rightTrade) score -= 45
    if (clocked) { score += 12; bits.push('on the clock') }
    else if (scheduled) { score += 4; bits.push('on shift') }
    else if (proximity === 'none') bits.push('not scheduled today')

    // Among people equally close, the one carrying least. Capped so a very loaded person who is
    // standing in the unit still beats an idle person across the county — which is the whole point.
    score -= Math.min(30, open * 5)
    if (open > 0) bits.push(`${open} open${done ? `, ${done} done` : ''}`)
    else if (scheduled) bits.push(done ? `${done} done, nothing open` : 'nothing assigned yet')

    return {
      person: p, score: Math.round(score),
      why: bits.join(' · ') || 'no signal either way',
      proximity, rightTrade, openTasks: open, clockedIn: clocked,
    }
  })

  // Right trade first as a tier, then score. A maintenance tech in the building still ranks above a
  // maintenance tech across town, but a housekeeper never outranks an available tech for a repair.
  out.sort((a, b) =>
    (b.rightTrade ? 1 : 0) - (a.rightTrade ? 1 : 0)
    || b.score - a.score
    || a.person.name.localeCompare(b.person.name))
  return out
}

/**
 * Build the context from what the board already holds. Kept here so the shape of the reasoning and
 * the shape of the data stay in one file — the UI passes raw board rows and gets a ranking.
 */
export function buildAssignContext(opts: {
  dept: string
  listingId?: string | null
  building?: string | null
  market?: string | null
  units: { listingId: string; building?: string | null; market: string; tasks: { assignees: string[]; done: boolean }[] }[]
  clockedIn?: string[]
  onShift?: string[]
}): AssignContext {
  const atUnit = new Set<string>(), inBuilding = new Set<string>(), inMarket = new Set<string>()
  const openLoad: Record<string, number> = {}, doneLoad: Record<string, number> = {}
  const b = norm(opts.building), m = norm(opts.market)
  for (const u of opts.units) {
    for (const t of u.tasks) {
      for (const raw of (t.assignees || [])) {
        const name = String(raw || '').trim()
        if (!name) continue
        if (t.done) doneLoad[name] = (doneLoad[name] || 0) + 1
        else openLoad[name] = (openLoad[name] || 0) + 1
        if (opts.listingId && u.listingId === opts.listingId) atUnit.add(name)
        if (b && norm(u.building) === b) inBuilding.add(name)
        if (m && norm(u.market) === m) inMarket.add(name)
      }
    }
  }
  return {
    dept: opts.dept, listingId: opts.listingId, building: opts.building, market: opts.market,
    atUnit, inBuilding, inMarket, openLoad, doneLoad,
    clockedIn: new Set(opts.clockedIn || []),
    onShift: new Set(opts.onShift || []),
  }
}
