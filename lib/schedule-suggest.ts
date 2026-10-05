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
}
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
    if (keep && cur != null) { assign[c.key] = cur; why[c.key] = 'already assigned'; mine[cur].push(c) }
    else rest.push(c)
  }

  const used = (id: number) => loadFor(mine[id], centres).minutes
  const room = (id: number) => (byId.get(id)?.capacityMin || DEFAULT_CAPACITY_MIN) - used(id)
  const addedIf = (id: number, c: SugClean) => loadFor(mine[id].concat(c), centres).minutes - used(id)

  // 2. Buildings with same-day turns first, then the biggest buildings.
  const groups: Record<string, SugClean[]> = {}
  for (const c of rest) (groups[c.market + '|' + c.hub] = groups[c.market + '|' + c.hub] || []).push(c)
  const order = Object.values(groups).sort((a, b) =>
    b.filter(c => c.sameDayTurn).length - a.filter(c => c.sameDayTurn).length || b.length - a.length)

  for (const group of order) {
    group.sort((a, b) => Number(b.sameDayTurn) - Number(a.sameDayTurn) || String(a.unit).localeCompare(String(b.unit)))
    for (const c of group) {
      const pool = people.filter(p => (p.role || 'cleaner') !== 'other')
      const away = (p: SugPerson) => !!marketOf[p.id] && !!c.market && marketOf[p.id] !== c.market
      // Two passes. First the people in this clean's market (plus anyone with no market yet). Only
      // if none of them can take it, everyone — and the card says the market ran out of room.
      const pick = (cands: SugPerson[]) => {
        let best: SugPerson | null = null, bestScore = -Infinity, bestWhy = ''
        for (const p of cands) {
          const add = addedIf(p.id, c)
          const left = room(p.id) - add
          const n = mine[p.id].length
          // Fits inside the shift, or up to `overtime` past it while they are still short of `target`.
          if (left < 0 && !(n < target && left >= -overtime)) continue
          const inHub = mine[p.id].some(x => x.hub === c.hub)
          const sup = p.role === 'supervisor'
          // 3: same building dominates. 6: someone already out beats starting someone new.
          // 7: a supervisor only when nobody else can. Then the least extra driving, then room.
          // 8: the habit. Usually works this building (from the last 30 days) → up to +500, below
          // "same building today" and "already out", above the driving and the room.
          const habit = opts.affinity?.[p.id]?.[c.hub] || 0
          const score = (inHub ? 1000 : 0) + (n > 0 ? 600 : 0) - (sup ? 3000 : 0) + habit * 500 - add + Math.max(left, 0) / 10
          if (score > bestScore) {
            best = p; bestScore = score
            bestWhy = sup ? 'supervisor, nobody else had room' : inHub ? `already in ${c.hub}` : habit >= 0.3 ? `usually works ${c.hub} (${Math.round(habit * 100)}% of recent cleans)` : left < 0 ? `fills ${first(p.name)}'s day (+${-left}m over)` : n ? 'fills a day already started' : 'has the most room'
          }
        }
        return best ? { best, why: bestWhy } : null
      }
      let hit = pick(pool.filter(p => !away(p)))
      if (!hit) {
        const crossed = pick(pool.filter(p => away(p)))
        if (crossed) hit = { best: crossed.best, why: `nobody in ${c.market} had room — ${first(crossed.best.name)} crosses from ${marketOf[crossed.best.id]}` }
      }
      if (hit) { assign[c.key] = hit.best.id; why[c.key] = hit.why; mine[hit.best.id].push(c); if (!marketOf[hit.best.id]) marketOf[hit.best.id] = c.market }
      else { assign[c.key] = null; why[c.key] = people.length ? 'nobody working has room' : 'nobody selected as working' }
    }
  }
  return { assign, why }
}
