// ── THE WEEK, BUILT FROM HOMEBASE ────────────────────────────────────────────────────────────
//
// Jon, 2026-09-23: "the weekly schedule which shows the shifts, whether they're on call or
// working. Can we pull that directly from Homebase? Homebase will just show if they're on the
// schedule, and then we can manually edit whether they're on call or they're working that day."
//
// That is exactly the right division of labour, and it is the one the roster never had. The
// `team_schedule` doc was typed by hand end to end: somebody listed the members, then clicked
// seven cells per person per week. So the rota drifted from payroll the moment anyone was added,
// dropped or moved in Homebase, and the drift was silent — a name simply was not there.
//
// TWO SOURCES, ONE ANSWER, AND THE HUMAN ALWAYS WINS
//
//   Homebase says WHETHER somebody is on the schedule that day. It is the payroll system; if it
//   has no shift, no one is being paid to be anywhere, and the cell is OFF.
//
//   A person says WHAT that day is — Working or On Call — because Homebase does not model the
//   difference and Jon's team decides it. That decision is the only thing we store.
//
// So `doc.cells` stops being the roster and becomes the OVERRIDE map: an entry means a human
// chose it, its absence means "whatever Homebase says". Existing docs need no migration, because
// every cell already in them WAS set by a human — the new reading is true of the old data.
//
// The consequence worth stating: clearing an override does not blank the cell, it hands the day
// back to Homebase. That is why the UI offers "back to Homebase" rather than a delete.
import { getShifts, type Shift } from './homebase'
import { getCrew } from './crew'
import { nameMatchesRoster, personKey } from './person-name'

export type CellSource = 'override' | 'homebase' | 'empty'
export type RosterCell = {
  status: 'Working' | 'On Call' | 'OFF' | 'REQ OFF'
  source: CellSource
  /** "8:00 AM – 5:30 PM", when Homebase has a shift. */
  shift: string | null
  role: string | null
}
export type RosterPerson = {
  name: string
  /** miami | broward | north | vendor | '' */
  area: string
  dept: string
  /** On the stored member list, so it shows even in a week Homebase has nothing for. */
  manual: boolean
  days: Record<string, RosterCell>
}
export type WeekRoster = {
  weekStart: string
  dates: string[]
  people: RosterPerson[]
  /** Scheduled in Homebase but on no market tab — nobody has filed them yet. */
  unplaced: { name: string; dates: string[] }[]
  homebaseOk: boolean
  homebaseError: string | null
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** A market tab's name for the area stored on the staff row. */
function areaMatches(area: string, market: string): boolean {
  const a = String(area || '').toLowerCase().trim()
  const m = String(market || '').toLowerCase().trim()
  if (!m) return true
  if (!a) return false
  return a === m || a.indexOf(m) >= 0 || m.indexOf(a) >= 0
}

/**
 * The week for one market: everyone Homebase has on the schedule, plus anyone the stored doc
 * names, with each day resolved override-first.
 *
 * Homebase failing is not an error here. It is a normal Monday when a key rotates or the API is
 * slow, and a rota that refuses to render is worse than one showing only what a human typed — so
 * a failure degrades to exactly the old behaviour and says so on the page.
 */
export async function weekRoster(weekStart: string, market: string, doc: { members?: string[]; cells?: Record<string, string> } | null): Promise<WeekRoster> {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const members: string[] = Array.isArray(doc?.members) ? doc!.members!.filter(Boolean) : []
  const cells: Record<string, string> = (doc && doc.cells && typeof doc.cells === 'object') ? doc.cells : {}

  let byDate: Record<string, Shift[]> = {}
  let homebaseOk = true
  let homebaseError: string | null = null
  try {
    const got = await Promise.all(dates.map(async d => [d, await getShifts(d)] as const))
    for (const [d, list] of got) byDate[d] = list
  } catch (e: any) {
    homebaseOk = false
    homebaseError = String(e?.message || e).slice(0, 160)
    byDate = {}
  }

  const crew = await getCrew().catch(() => null)
  // ONE SPELLING PER PERSON, and the roster's wins. Homebase says "Mileidis gonzalez" where the
  // rota says "Mileydis"; showing both is how this board once read 19 cleans with everyone at 0.
  const nameOf = (raw: string): string => {
    const hit = members.length ? nameMatchesRoster(raw, members) : ''
    return hit || String(raw || '').replace(/\s+/g, ' ').trim() || raw
  }

  type Acc = { name: string; manual: boolean; shifts: Record<string, Shift> }
  const acc: Record<string, Acc> = {}
  for (const m of members) acc[personKey(m)] = { name: m, manual: true, shifts: {} }
  for (const d of dates) {
    for (const s of (byDate[d] || [])) {
      if (!s.name || s.open) continue          // an unfilled shift is not a person
      const name = nameOf(s.name)
      const k = personKey(name)
      if (!acc[k]) acc[k] = { name, manual: false, shifts: {} }
      // One person can hold two shifts in a day; the earliest start is the one the rota shows.
      if (!acc[k].shifts[d]) acc[k].shifts[d] = s
    }
  }

  const people: RosterPerson[] = []
  const unplaced: { name: string; dates: string[] }[] = []
  for (const k of Object.keys(acc)) {
    const a = acc[k]
    const rec = crew ? crew.staff[Object.keys(crew.staff).find(n => personKey(n) === k) || ''] : null
    const area = String(rec?.area || '')
    const dept = crew ? crew.deptOf(a.name, a.shifts[dates[0]]?.role || null) : 'other'
    // A manual member stays on the tab that lists them, whatever the staff row says — somebody put
    // them there on purpose. Somebody Homebase found is placed by their record, and if the record
    // does not say where they work they are not guessed onto a market: they are called out.
    const belongs = a.manual || areaMatches(area, market)
    if (!belongs) {
      if (!area) unplaced.push({ name: a.name, dates: dates.filter(d => !!a.shifts[d]) })
      continue
    }
    const days: Record<string, RosterCell> = {}
    for (const d of dates) {
      const set = String(cells[a.name + '__' + d] || '').trim()
      const shift = a.shifts[d]
      if (set) {
        days[d] = {
          status: /on.?call/i.test(set) ? 'On Call' : /req/i.test(set) ? 'REQ OFF' : /off/i.test(set) ? 'OFF' : 'Working',
          source: 'override', shift: shift ? shift.label : null, role: shift ? (shift.role || null) : null,
        }
      } else if (shift) {
        days[d] = { status: 'Working', source: 'homebase', shift: shift.label, role: shift.role || null }
      } else {
        days[d] = { status: 'OFF', source: homebaseOk ? 'homebase' : 'empty', shift: null, role: null }
      }
    }
    people.push({ name: a.name, area, dept, manual: a.manual, days })
  }

  people.sort((a, b) => (a.dept || 'zz').localeCompare(b.dept || 'zz') || a.name.localeCompare(b.name))
  unplaced.sort((a, b) => a.name.localeCompare(b.name))
  return { weekStart, dates, people, unplaced, homebaseOk, homebaseError }
}
