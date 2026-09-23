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
//   4. Stay in the person's market (their Breezeway region, or where their current work already is).
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
/** role: 'cleaner' (default), 'supervisor' (last resort), 'other' (ops, handyman: never auto-assigned). */
export type SugPerson = { id: number; name: string; market: string | null; capacityMin: number; role?: 'cleaner' | 'supervisor' | 'other' }
export type SuggestOptions = { keepCurrent?: boolean; targetCleans?: number; overtimeMin?: number }
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

  // A person's market: where their work already is, else what Breezeway says. The work wins: the
  // first live run found nearly everyone's Breezeway region set to "Broward", including people who
  // clean in Arya every day. And it is a preference, not a wall (see the score below).
  const marketOf: Record<number, string | null> = {}
  for (const p of people) {
    const theirs = cleans.filter(c => c.currentIds.includes(p.id))
    marketOf[p.id] = theirs.length ? theirs[0].market : (p.market || null)
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
      let best: SugPerson | null = null, bestScore = -Infinity, bestWhy = ''
      for (const p of pool) {
        const add = addedIf(p.id, c)
        const left = room(p.id) - add
        const n = mine[p.id].length
        // Fits inside the shift, or up to `overtime` past it while they are still short of `target`.
        if (left < 0 && !(n < target && left >= -overtime)) continue
        const inHub = mine[p.id].some(x => x.hub === c.hub)
        const sup = p.role === 'supervisor'
        // 3: same building dominates. 6: someone already out beats starting someone new.
        // 7: a supervisor only when nobody else can. Then the least extra driving, then room.
        const away = !!marketOf[p.id] && marketOf[p.id] !== c.market
        const score = (inHub ? 1000 : 0) + (n > 0 ? 600 : 0) - (sup ? 3000 : 0) - (away ? 900 : 0) - add + Math.max(left, 0) / 10
        if (score > bestScore) {
          best = p; bestScore = score
          bestWhy = sup ? 'supervisor, nobody else had room' : inHub ? `already in ${c.hub}` : left < 0 ? `fills ${first(p.name)}'s day (+${-left}m over)` : n ? 'fills a day already started' : 'has the most room'
        }
      }
      if (best) { assign[c.key] = best.id; why[c.key] = bestWhy; mine[best.id].push(c); if (!marketOf[best.id]) marketOf[best.id] = c.market }
      else { assign[c.key] = null; why[c.key] = people.length ? 'nobody working has room' : 'nobody selected as working' }
    }
  }
  return { assign, why }
}
