// THE SCHEDULE SUGGESTER (Jon, 2026-09-23: "a scheduler suggester option that shows a mock-up
// schedule in a pop up, we can move things around and approve. select who is working etc").
//
// A pure function, no server imports, so the popup can re-run it on every toggle and Eve's
// scheduler can call the same thing later. Given one day's departure cleans and the people who are
// working, it proposes who takes what. Nothing here writes anywhere. The popup is the sandbox; only
// Approve pushes to Breezeway.
//
// HOW IT DECIDES, in the order a good supervisor would:
//   1. Keep what is already assigned, if that person is working (a toggle; on by default). Somebody
//      has usually already been told.
//   2. Same-day turns first. A guest is arriving at 4pm to those.
//   3. Keep a person inside one building. Three cleans in Eden for one person beats one each for three
//      people, because the drive between buildings is the part nobody gets paid to do well.
//   4. Stay in the person's market. A WALL, not a preference (Jon, 2026-10-05: "the suggest schedule
//      is not working correctly, putting Broward staff in Miami"): a Broward cleaner is never handed a
//      Miami clean while anyone from Miami has room. Only when nobody in the market can take it does
//      the suggester cross, and then it says so on the card ("nobody in Miami had room"). Home market
//      = the last 30 days of their cleans (lib/schedule-habits), else where today's work already is,
//      else the Breezeway region — which is "Broward" for nearly everyone, so it comes last.
//   5. Fill the person with the most room left, and never past their capacity. A clean that does not
//      fit anywhere stays in "Unassigned" rather than quietly overloading somebody.
//
// FEWER PEOPLE, FULLER DAYS (Jon, 2026-09-23, after testing tomorrow: "I'd rather give somebody 4
// cleans, even if they work 1 extra hour, than bring in another person to clean. If Yoslenis is a
// supervisor, I'm okay with that, but it would make more sense for her not to have to clean and just
// give a girl a full schedule."). So on top of the above:
//   6. Fill somebody who is already cleaning before starting anybody new. A person can run up to an
//      hour past their shift (overtimeMin) to reach four cleans (targetCleans), never beyond.
//   7. Supervisors clean only when no cleaner can take it; ops and handymen are never given a clean
//      by the suggester (they can still be dragged one by hand). Roles come from Ops presets
//      (roster.nonCleaners), the same list the forecast uses.
//   8. Anyone left with nothing is shown as "not needed", which is the point: one less person out.
//
// MINUTES. Clean times are the measured standards from lib/capacity (by bedrooms, by market);
// drive time is the same openly-assumed model (6 min inside a building, 12 min plus 2.5 min per km
// between buildings, capped at an hour). Capacity is the person's shift from /api/capacity when
// Homebase has one, else an 8-hour day minus a 30-minute break and 8% contingency.

export type SugClean = {
  key: string
  listingId: string
  unit: string
  market: string
  hub: string
  lat: number | null
  lng: number | null
  bedrooms: number | null
  sameDayTurn: boolean
  minutes: number
  currentIds: number[]
  /**
   * Breezeway's state for this clean (Jon, 2026-10-05: "make sure it shows in progress if task is
   * started"). A clean that is 'in_progress' or 'completed' is LOCKED: it stays with whoever has it,
   * even with "Keep current" off, and the suggester never offers it to anyone else.
   */
  taskStatus?: 'created' | 'in_progress' | 'completed' | null
}
export const isLocked = (c: { taskStatus?: string | null }) => c.taskStatus === 'in_progress' || c.taskStatus === 'completed'
/**
 * role: 'cleaner' (default), 'supervisor' (last resort), 'other' (ops, handyman: never auto-assigned).
 * market: the person's HOME market (Miami / Broward / North), from their recent cleans where known.
 * A known market is a wall; null means "anywhere", and the first clean they take settles it for the day.
 */
export type SugPerson = { id: number; name: string; market: string | null; capacityMin: number; role?: 'cleaner' | 'supervisor' | 'other' }
export type SuggestOptions = {
  keepCurrent?: boolean; targetCleans?: number; overtimeMin?: number
  /**
   * HOW WE USUALLY SCHEDULE (Jon, 2026-09-28: "go back 30 days to learn how we schedule"). Person id
   * → hub → share of that person's recent cleans there (0..1), from lib/schedule-habits. A person
   * scores higher on a building they usually work; never lower on one they do not. A tie-breaker
   * behind the day's own rules, not a wall.
   */
  affinity?: Record<number, Record<string, number>>
}
export type Suggestion = {
  /** clean key → person id, or null for unassigned */
  assign: Record<string, number | null>
  /** why each clean landed where it did, in a few words */
  why: Record<string, string>
}

// Measured standards (lib/capacity CLEAN_MINUTES / CLEAN_MINUTES_BY_MARKET). Copied, not imported,
// because lib/capacity is server-only. Keep the two in step.
const CLEAN_MINUTES: Record<string, { studio: number; one: number; two: number; threePlus: number }> = {
  default: { studio: 86, one: 102, two: 127, threePlus: 147 },
  miami: { studio: 105, one: 119, two: 131, threePlus: 145 },
  broward: { studio: 82, one: 99, two: 123, threePlus: 147 },
}
export const DEFAULT_CAPACITY_MIN = Math.round((480 - 30) * 0.92)

export function standardMinutes(bedrooms: number | null | undefined, market: string | null | undefined): number {
  const t = CLEAN_MINUTES[String(market || '').toLowerCase()] || CLEAN_MINUTES.default
  if (bedrooms == null) return t.one
  if (bedrooms <= 0) return t.studio
  if (bedrooms === 1) return t.one
  if (bedrooms === 2) return t.two
  return t.threePlus
}

const first = (n: string) => String(n || '').split(/\s+/)[0]

type Pt = { lat: number | null; lng: number | null }
function km(a: Pt, b: Pt): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
function hop(a: Pt, b: Pt): number {
  const d = km(a, b)
  return d == null ? 20 : Math.min(60, 12 + d * 2.5)
}

/** Where each building is: the average of its units' coordinates. */
export function hubCentres(cleans: SugClean[]): Record<string, Pt> {
  const acc: Record<string, { lat: number; lng: number; n: number }> = {}
  for (const c of cleans) {
    if (c.lat == null || c.lng == null) continue
    const a = (acc[c.hub] = acc[c.hub] || { lat: 0, lng: 0, n: 0 })
    a.lat += c.lat; a.lng += c.lng; a.n++
  }
  const out: Record<string, Pt> = {}
  for (const [h, a] of Object.entries(acc)) out[h] = { lat: a.lat / a.n, lng: a.lng / a.n }
  return out
}

export type Load = { minutes: number; work: number; travel: number; cleans: number; hubs: string[]; sameDay: number }

/** One person's day: work plus drive, visiting buildings nearest-first. */
export function loadFor(list: SugClean[], centres: Record<string, Pt>): Load {
  const work = list.reduce((s, c) => s + c.minutes, 0)
  const byHub: Record<string, number> = {}
  for (const c of list) byHub[c.hub] = (byHub[c.hub] || 0) + 1
  const hubs = Object.keys(byHub)
  let travel = 0
  if (hubs.length) {
    travel += 15 // getting to the first building
    const left = hubs.slice()
    let cur = left.shift() as string
    travel += (byHub[cur] - 1) * 6
    while (left.length) {
      const here = centres[cur] || { lat: null, lng: null }
      left.sort((a, b) => hop(here, centres[a] || { lat: null, lng: null }) - hop(here, centres[b] || { lat: null, lng: null }))
      const next = left.shift() as string
      travel += hop(here, centres[next] || { lat: null, lng: null }) + (byHub[next] - 1) * 6
      cur = next
    }
  }
  return { minutes: Math.round(work + travel), work, travel: Math.round(travel), cleans: list.length, hubs, sameDay: list.filter(c => c.sameDayTurn).length }
}

export function suggestSchedule(cleans: SugClean[], people: SugPerson[], opts: SuggestOptions = {}): Suggestion {
  const keep = opts.keepCurrent !== false
  const target = Math.max(1, Math.round(Number(opts.targetCleans) || 4))
  const overtime = Math.max(0, Math.round(Number(opts.overtimeMin ?? 60)))
  const centres = hubCentres(cleans)
  const assign: Record<string, number | null> = {}
  const why: Record<string, string> = {}
  const mine: Record<number, SugClean[]> = {}
  for (const p of people) mine[p.id] = []
  const byId = new Map(people.map(p => [p.id, p]))

  // A person's market, in the order we trust it: what the caller knows (their recent cleans), else
  // the market MOST of their current cleans today are in, else nothing — and nothing means anywhere.
  // (Before 2026-10-05 this took the first current clean's market and the Breezeway region, and used
  // it as a −900 nudge; a Broward cleaner was still handed Miami cleans once "already out" and
  // "same building" stacked up. Now it is a wall; see the two passes below.)
  const marketOf: Record<number, string | null> = {}
  for (const p of people) {
    if (p.market) { marketOf[p.id] = p.market; continue }
    const n: Record<string, number> = {}
    for (const c of cleans) if (c.currentIds.includes(p.id) && c.market) n[c.market] = (n[c.market] || 0) + 1
    marketOf[p.id] = Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null
  }

  // 1. Keep.
  const rest: SugClean[] = []
  for (const c of cleans) {
    const cur = c.currentIds.find(id => byId.has(id))
    // Started or finished: it stays where it is, whatever the toggles say. If the person doing it is
    // not on the board, it is left out of the plan rather than handed to somebody else.
    if (isLocked(c)) {
      const done = c.taskStatus === 'completed'
      if (cur != null) { assign[c.key] = cur; why[c.key] = done ? 'finished' : 'in progress — stays with ' + first(byId.get(cur)!.name); mine[cur].push(c) }
      else { assign[c.key] = null; why[c.key] = (done ? 'finished' : 'in progress') + ' by someone not on this board' }
      continue
    }
    if (keep && cur != null) { assign[c.key] = cur; why[c.key] = 'already assigned'; mine[cur].push(c) }
    else rest.push(c)
  }

  const used = (id: number) => loadFor(mine[id], centres).minutes

  // 2. Buildings with same-day turns first, then the biggest buildings.
  const groups: Record<string, SugClean[]> = {}
  for (const c of rest) (groups[c.market + '|' + c.hub] = groups[c.market + '|' + c.hub] || []).push(c)
  const order = Object.values(groups).sort((a, b) =>
    b.filter(c => c.sameDayTurn).length - a.filter(c => c.sameDayTurn).length || b.length - a.length)

  // ONE CLEANER PER BUILDING (Jon, 2026-10-05: "should pick the same cleaner per building, shouldn't
  // space it out"). Before this the suggester placed one clean at a time and preferred whoever was
  // "already out": Vilma took one Rustic clean on top of her Eden day, ran out of room, and the second
  // Rustic clean went to Maribel — two people for a two-clean building. Now each BUILDING is offered
  // whole: the person who can take the most of it (ideally all of it) gets it, and it is split only
  // when nobody has room for all of it — then into as few hands as possible, biggest share first.
  const fitsAll = (id: number, extra: SugClean[]) => {
    const cap = byId.get(id)?.capacityMin || DEFAULT_CAPACITY_MIN
    const total = mine[id].length + extra.length
    const left = cap - loadFor(mine[id].concat(extra), centres).minutes
    // Inside the shift, or up to `overtime` past it while the day is still at or under `target` cleans.
    return { ok: left >= 0 || (total <= target && left >= -overtime), left }
  }
  for (const group of order) {
    group.sort((a, b) => Number(b.sameDayTurn) - Number(a.sameDayTurn) || String(a.unit).localeCompare(String(b.unit)))
    const hub = group[0].hub, mkt = group[0].market, total = group.length
    let rest = group.slice()
    const pool = people.filter(p => (p.role || 'cleaner') !== 'other')
    const away = (p: SugPerson) => !!marketOf[p.id] && !!mkt && marketOf[p.id] !== mkt
    // The biggest run of this building's cleans one person can take, in order (same-day first).
    const chunk = (cands: SugPerson[]) => {
      let best: { p: SugPerson; take: SugClean[]; left: number } | null = null, bestScore = -Infinity
      for (const p of cands) {
        const take: SugClean[] = []
        let left = 0
        for (const c of rest) { const f = fitsAll(p.id, take.concat(c)); if (f.ok) { take.push(c); left = f.left } }
        if (!take.length) continue
        const n = mine[p.id].length
        const inHub = mine[p.id].some(x => x.hub === hub)
        const sup = p.role === 'supervisor'
        const habit = opts.affinity?.[p.id]?.[hub] || 0
        const add = loadFor(mine[p.id].concat(take), centres).minutes - used(p.id)
        // Most of the building in one pair of hands first; a supervisor only when no cleaner can take
        // any of it; then already in the building, the habit, a day already started (fewer people out),
        // and the least extra time.
        const score = take.length * 10000 - (sup ? 100000 : 0) + (inHub ? 1000 : 0) + habit * 500 + (n > 0 ? 300 : 0) - add / 10
        if (score > bestScore) { bestScore = score; best = { p, take, left } }
      }
      return best
    }
    while (rest.length) {
      let hit = chunk(pool.filter(p => !away(p)))
      let crossed = false
      if (!hit) { hit = chunk(pool.filter(p => away(p))); crossed = !!hit }
      if (!hit) {
        for (const c of rest) { assign[c.key] = null; why[c.key] = people.length ? 'nobody working has room' : 'nobody selected as working' }
        break
      }
      const { p, take, left } = hit
      const inHub = mine[p.id].some(x => x.hub === hub)
      const habit = opts.affinity?.[p.id]?.[hub] || 0
      const whole = take.length === total
      const w = crossed ? `nobody in ${mkt} had room — ${first(p.name)} crosses from ${marketOf[p.id]}`
        : p.role === 'supervisor' ? 'supervisor, nobody else had room'
        : inHub ? `already in ${hub}`
        : whole ? (total > 1 ? `all ${total} in ${hub}, one cleaner` : habit >= 0.3 ? `usually works ${hub} (${Math.round(habit * 100)}% of recent cleans)` : left < 0 ? `fills ${first(p.name)}'s day (+${-left}m over)` : mine[p.id].length ? 'fills a day already started' : 'has the most room')
        : `${take.length} of ${total} in ${hub} — nobody had room for all`
      for (const c of take) { assign[c.key] = p.id; why[c.key] = w; mine[p.id].push(c) }
      if (!marketOf[p.id]) marketOf[p.id] = mkt
      rest = rest.filter(c => !take.includes(c))
    }
  }
  return { assign, why }
}
