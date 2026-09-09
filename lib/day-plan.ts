// BUILD THE DAY, NOT JUST SHOW IT.
//
// Jon, 2026-08-27: "need the AI systems to help assign or build tasks to ensure we give the team a
// full and directional day."
//
// Two words in that sentence carry the design.
//
// ── "FULL" ──────────────────────────────────────────────────────────────────────────────────────
// Every morning the board has work nobody owns and people who own nothing, at the same time, and
// nothing on the screen puts those two facts together. The per-task assign panel answers "who takes
// THIS?" well — but a coordinator with fourteen unassigned cleans has to ask it fourteen times, and
// each answer is made in ignorance of the previous thirteen. That is how one person ends up with
// six jobs and another with none: not a bad decision, fourteen locally-good decisions.
//
// A plan is different from fourteen picks because it is GREEDY WITH MEMORY — each assignment
// updates the load the next one is ranked against. That is the whole reason this file exists rather
// than a loop over the existing ranker.
//
// ── "DIRECTIONAL" ───────────────────────────────────────────────────────────────────────────────
// A day is not a list, it is a route. Six jobs in one tower is a good day; six jobs in six buildings
// is the same six jobs and half of them will not get done. So after proximity and load, the planner
// pays a bonus for keeping a person's day in ONE place, and it reports the result per person — a
// route somebody can read, not a pile of rows filtered by their name.
//
// ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────────────────────────
// Apply anything. It returns a proposal. Jon's standing constraint from the suggestion engine holds
// here and matters more, because this touches real work with real names on it: "we can't have 200
// tasks just auto populate." Every line is reviewable, carries its reason, and is applied by a human
// pressing a button — all at once, per person, or one at a time.
//
// It also refuses to overfill. `maxPerPerson` is a real ceiling: a plan that hands somebody eleven
// jobs is not a plan, it is a way of making the unassigned column look empty.
import { rankAssignees, buildAssignContext, type RankPerson } from './assign-rank'
// ONE ANSWER TO "IS THIS THE SAME PERSON?" (2026-09-09 audit). This file joined Homebase shift
// names, Breezeway roster names and Breezeway assignee strings with lowercase equality — the exact
// comparison the rest of the app forbids, because those three systems disagree about spacing,
// accents and married names. The cost here is the worst kind: a working person reads as "not on
// shift", becomes ineligible, shows a load of 0, and the idle bonus then sends them MORE work.
import { personKey, nameMatches } from './person-name'

export type PlanTask = {
  id: string
  name: string
  unit: string
  listingId: string
  building?: string | null
  market: string
  dept: string
  /** Sorting fuel: these decide what gets a body first when there are not enough bodies. */
  late?: boolean
  atRisk?: boolean
  sameDayTurn?: boolean
  isClean?: boolean
}

export type PlanUnitRow = {
  listingId: string
  building?: string | null
  market: string
  tasks: { assignees: string[]; done: boolean }[]
}

export type Assignment = {
  taskId: string
  task: string
  unit: string
  listingId: string
  building?: string | null
  to: string
  toId: number
  why: string
  proximity: 'unit' | 'building' | 'area' | 'none'
  /** True when this assignment keeps the person in a building they are already working. */
  keepsRoute: boolean
  urgent: boolean
}

export type PersonPlan = {
  name: string
  id: number
  /** Buildings this person's day now touches, in the order the plan built them. */
  buildings: string[]
  existing: number
  added: Assignment[]
  /** The sentence a supervisor reads about this person's day. */
  shape: string
}

export type DayPlan = {
  ok: boolean
  assignments: Assignment[]
  perPerson: PersonPlan[]
  /** Work the planner could not place, and why — never silently dropped. */
  unplaced: { taskId: string; task: string; unit: string; reason: string }[]
  /** People who end the plan with nothing. The other half of "full". */
  stillFree: string[]
  summary: {
    unassignedBefore: number
    placed: number
    peopleUsed: number
    freeBefore: number
    freeAfter: number
    /** How many assignments kept somebody inside a building they were already in. */
    onRoute: number
  }
}

export type PlanOptions = {
  /** Hard ceiling on total open tasks per person after planning. */
  maxPerPerson?: number
  /**
   * THE REAL CEILING (2026-09-09 audit). A count says a studio and a four-bedroom cost the same,
   * which they do not — the capacity model prices each unit in its own market against measured
   * benchmarks. Pass `capacity` (person → minutes still free, from /api/capacity) and the planner
   * spends minutes instead of jobs; `taskMinutes` prices the work it is handing out. The count
   * remains as the fallback for a day the model could not price.
   */
  capacityLeft?: Record<string, number>
  taskMinutes?: Record<string, number>
  /** Do not hand work to somebody who is not on the clock / on shift. */
  onlyScheduled?: boolean
}


/**
 * Propose a full day.
 *
 * Deliberately deterministic — same board, same plan. A planner that shuffles between runs is one
 * nobody can argue with, and being argued with is most of what this is for.
 */
export function planDay(opts: {
  unassigned: PlanTask[]
  units: PlanUnitRow[]
  roster: RankPerson[]
  clockedIn?: string[]
  onShift?: string[]
  options?: PlanOptions
}): DayPlan {
  const maxPer = Math.max(1, opts.options?.maxPerPerson ?? 6)
  const onlyScheduled = opts.options?.onlyScheduled !== false
  // Minutes when the capacity model could price the day, jobs when it could not.
  const capLeft = opts.options?.capacityLeft || null
  const taskMin = opts.options?.taskMinutes || {}
  const minutesOf = (t: PlanTask) => Math.max(15, Number(taskMin[t.id]) || (t.isClean ? 90 : 45))
  const spent: Record<string, number> = {}
  const roomFor = (name: string, t: PlanTask) => {
    // The job count stays a ceiling in every case: minutes are the better measure, but they are
    // estimates, and a plan that hands somebody eleven jobs is wrong however the minutes add up.
    if (loadOf(name) >= maxPer) return false
    if (!capLeft) return true
    const left = Number(capLeft[personKey(name)] ?? capLeft[name])
    if (!Number.isFinite(left)) return true                       // unpriced person: the count decides
    // Somebody already over their day gets nothing more, whatever it is. Otherwise: a person with
    // nothing from this plan yet can take one job however long — the same rule the suggestion engine
    // uses, so a ceiling never makes a long job impossible — and after that the minutes must fit.
    if (left <= 0) return false
    const used = spent[personKey(name)] || 0
    return used === 0 ? true : used + minutesOf(t) <= left
  }

  // Everyone's starting position: what they already carry, and where they already are.
  // Keyed on personKey, never the raw string, so "Gehron Regis" and "Gehron  Regis" are one person.
  const load: Record<string, number> = {}
  const anchors: Record<string, Set<string>> = {}
  const seenNames: string[] = []
  for (const u of opts.units) {
    for (const t of u.tasks) {
      for (const raw of (t.assignees || [])) {
        const n = String(raw || '').trim()
        if (!n) continue
        const k = personKey(n); if (!k) continue
        if (!seenNames.includes(n)) seenNames.push(n)
        if (!t.done) load[k] = (load[k] || 0) + 1
        const b = String(u.building || u.listingId)
        ;(anchors[k] = anchors[k] || new Set()).add(b)
      }
    }
  }
  const loadOf = (name: any) => load[personKey(name)] || 0

  const shiftNames = [...(opts.clockedIn || []), ...(opts.onShift || [])].map(x => String(x || '')).filter(Boolean)
  const scheduled = new Set(shiftNames.map(personKey).filter(Boolean))
  /** Key first (cheap, catches spacing/accents), then the full comparison (typos, swapped names). */
  const isScheduled = (name: string) => scheduled.has(personKey(name)) || shiftNames.some(sn => nameMatches(sn, name))
  const eligible = onlyScheduled
    // Somebody already carrying work today is obviously working, whatever the clock says — the
    // Homebase/Breezeway name join is fuzzy and must never be the reason a working person is
    // treated as unavailable.
    ? opts.roster.filter(p => isScheduled(p.name) || loadOf(p.name) > 0)
    : opts.roster

  // ── ORDER OF SERVICE ──────────────────────────────────────────────────────────────────────────
  // When there are fewer bodies than jobs, the order this loop runs in IS the operational policy.
  // Late first, then at-risk, then same-day turns, then everything else. A clean that has already
  // blown 4pm does not get a body after a preventative job because the preventative job sorted
  // earlier alphabetically.
  const queue = opts.unassigned.slice().sort((a, b) =>
    (b.late ? 8 : 0) + (b.atRisk ? 4 : 0) + (b.sameDayTurn ? 2 : 0) + (b.isClean ? 1 : 0)
    - ((a.late ? 8 : 0) + (a.atRisk ? 4 : 0) + (a.sameDayTurn ? 2 : 0) + (a.isClean ? 1 : 0))
    || String(a.building || '').localeCompare(String(b.building || ''))
    || a.unit.localeCompare(b.unit))

  // Everybody's load BEFORE the planner touches anything — the loop below mutates `load`.
  const load0: Record<string, number> = { ...load }
  const assignments: Assignment[] = []
  const unplaced: DayPlan['unplaced'] = []

  for (const task of queue) {
    const ctx = buildAssignContext({
      dept: task.dept, listingId: task.listingId, building: task.building, market: task.market,
      units: opts.units, clockedIn: opts.clockedIn, onShift: opts.onShift,
    })
    // Fold in what THIS plan has already handed out — the memory that makes it a plan.
    // ONE spelling per person carries the total; the rest are zeroed, because rankAssignees sums
    // every key whose normalised name matches and would otherwise count one person's load twice.
    const wrote = new Set<string>()
    for (const n of seenNames) {
      const k = personKey(n)
      if (wrote.has(k)) { ctx.openLoad[n] = 0; continue }
      wrote.add(k); ctx.openLoad[n] = loadOf(n)
    }

    const ranked = rankAssignees(eligible, ctx)
      .filter(r => roomFor(r.person.name, task))
      // ROUTE BONUS. Among people who are otherwise close, prefer the one whose day this keeps in
      // one place. Small on purpose: it should break ties, never beat "already standing there".
      .map(r => {
        const b = String(task.building || task.listingId)
        const keepsRoute = (anchors[personKey(r.person.name)] || new Set()).has(b)
        // ── THE IDLE SEED ─────────────────────────────────────────────────────────────────────
        // The first draft of this planner sent a cleaner who already had two jobs across town to a
        // third building while a colleague sat with nothing all morning — because "already working
        // this market" outranks "has no work at all". For a per-task pick that is defensible; for a
        // DAY it is the exact failure Jon named. So somebody carrying nothing gets a seed big
        // enough to beat market-level proximity (+22) and nowhere near enough to beat the building
        // (+60) or the unit (+100): never pull a person out of the tower they are standing in, but
        // never hop a busy one across town while somebody is free either.
        //
        // It evaporates the moment they take their first job, so it seeds idle people one each and
        // then normal ranking resumes — which is what "full" means.
        const idle = loadOf(r.person.name) === 0
        return { ...r, score: r.score + (keepsRoute ? 8 : 0) + (idle ? 26 : 0), keepsRoute, idle }
      })
      .sort((a, b) => (b.rightTrade ? 1 : 0) - (a.rightTrade ? 1 : 0) || b.score - a.score)

    const pick = ranked[0]
    if (!pick) {
      unplaced.push({
        taskId: task.id, task: task.name, unit: task.unit,
        reason: eligible.length === 0
          ? 'nobody is on shift to take it'
          : `everybody available is already at ${maxPer} jobs`,
      })
      continue
    }

    load[personKey(pick.person.name)] = loadOf(pick.person.name) + 1
    spent[personKey(pick.person.name)] = (spent[personKey(pick.person.name)] || 0) + minutesOf(task)
    // The planner's own memory: without this, somebody who started the morning empty stayed at
    // openLoad 0 for every later round, so the load penalty never applied to them and the plan
    // stacked jobs on whoever won proximity (caught in review, 2026-09-09).
    if (!seenNames.includes(pick.person.name)) seenNames.push(pick.person.name)
    ;(anchors[personKey(pick.person.name)] = anchors[personKey(pick.person.name)] || new Set()).add(String(task.building || task.listingId))

    assignments.push({
      taskId: task.id, task: task.name, unit: task.unit, listingId: task.listingId,
      building: task.building, to: pick.person.name, toId: pick.person.id,
      why: pick.idle && (pick.proximity === 'none' || pick.proximity === 'area')
        // Say the real reason. "Working Miami today" would be a lie about somebody who has not been
        // given anything yet, and the coordinator would not know they were about to fix that.
        ? 'has nothing today — this starts their day'
        : pick.keepsRoute && pick.proximity === 'none'
          ? `keeps their day in ${task.building || task.unit}`
          : pick.why,
      proximity: pick.proximity, keepsRoute: pick.keepsRoute,
      urgent: !!(task.late || task.atRisk),
    })
  }

  // ── THE PER-PERSON VIEW ───────────────────────────────────────────────────────────────────────
  // The same assignments, arranged the way the person will actually experience them. This is the
  // "directional" half: a supervisor should be able to read one block and know whether that day
  // makes sense to drive.
  const byPerson: Record<string, Assignment[]> = {}
  for (const a of assignments) (byPerson[a.to] = byPerson[a.to] || []).push(a)

  // Alphabetical is the wrong order for a screen somebody reads top-down at 7am: the person
  // carrying the late work should be the first block, not the one whose name starts with A.
  const personOrder = Object.keys(byPerson).sort((a, b) =>
    (byPerson[b].some(x => x.urgent) ? 1 : 0) - (byPerson[a].some(x => x.urgent) ? 1 : 0)
    || byPerson[b].length - byPerson[a].length
    || a.localeCompare(b))

  const perPerson: PersonPlan[] = personOrder.map(name => {
    const added = byPerson[name]
    const person = eligible.find(p => p.name === name)
    const bs = Array.from(new Set(added.map(a => String(a.building || a.unit))))
    const spread = new Set(bs).size
    const total = loadOf(name) || added.length
    return {
      name, id: person?.id ?? 0,
      buildings: bs,
      existing: total - added.length,
      added,
      shape: spread === 1
        ? `${added.length} more in ${bs[0]} — ${total} for the day, one building.`
        : `${added.length} more across ${spread} buildings — ${total} for the day. Worth a second look.`,
    }
  })

  // BEFORE, not after: `load` has been mutated by the loop above, so this must read the snapshot
  // taken before planning or it reports "free after planning" and stillFree becomes a no-op.
  const freeBefore = eligible.filter(p => (load0[personKey(p.name)] || 0) === 0).map(p => p.name)
  const stillFree = freeBefore.filter(n => !byPerson[n])

  return {
    ok: true,
    assignments,
    perPerson,
    unplaced,
    stillFree,
    summary: {
      unassignedBefore: opts.unassigned.length,
      placed: assignments.length,
      peopleUsed: perPerson.length,
      freeBefore: freeBefore.length,
      freeAfter: stillFree.length,
      onRoute: assignments.filter(a => a.keepsRoute || a.proximity === 'building' || a.proximity === 'unit').length,
    },
  }
}
