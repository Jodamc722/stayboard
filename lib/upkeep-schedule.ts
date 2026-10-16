// SMART DAY FOR AN UPKEEP JOB (Jon, 2026-10-16: "smart scheduling when adding a task, based on the
// open date — usually the checkout; for a PM task, recommend blocking the unit if there is no arrival").
//
// Pure — the calendar panel and the server's booking route both use it, so the day the page
// suggests is the day the server books.
//
// The rules, in the order a coordinator applies them:
//   1. The unit has to be workable that day. A job that needs the unit EMPTY (PM audit, coil clean,
//      deep clean) needs every night it takes free: night d is free when nobody is in or arriving —
//      the day reads checkout, open or a hold. A short job (batteries, filter) only needs the door:
//      checkout, open, hold, or a check-in morning.
//   2. The CHECKOUT day is the best day: the guest has just left, housekeeping is already there,
//      and the unit is ready for the next guest the same day. Then a plain open day, then a hold,
//      then a check-in morning (rushed).
//   3. Somebody of the trade already in this unit that day beats somebody in the building, which
//      beats nobody.
//   4. Sooner for a late job; close to (and not after) the due date for one that is not due yet.
//   5. For an empty-unit job whose nights are free but sellable, recommend BLOCKING those nights in
//      Guesty (reason Maintenance) so a booking cannot land on top of the work.

export type CalKind = 'open' | 'out' | 'in' | 'turn' | 'stay' | 'block' | 'hold'
export type CalTeam = { name: string; atUnit: boolean; jobs: number; trade: string }
export type CalCell = { d: string; k: CalKind; label?: string | null; team: CalTeam[] }
export type DayPick = {
  date: string; kind: CalKind; who: string | null; atUnit: boolean
  /** One line: "Checkout Thu Oct 22 · no arrival · Gehron in the building". */
  why: string
  /** Nights the job needs empty (YYYY-MM-DD each). Empty for a short job. */
  nights: string[]
  /** Those nights are free but sellable — recommend blocking them in Guesty. */
  recommendBlock: boolean
}

const NIGHT_FREE: CalKind[] = ['out', 'open', 'hold']          // nobody sleeping there that night
const DOOR_OPEN: CalKind[] = ['out', 'open', 'hold', 'in']      // somebody can get in that day
const KIND_SCORE: Partial<Record<CalKind, number>> = { out: 30, open: 20, hold: 16, in: 4 }
const dayWord = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const between = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

export function tradeFits(dept: string, trade: string): boolean {
  if (dept === 'housekeeping') return trade === 'housekeeping'
  if (dept === 'inspection') return trade === 'inspection' || trade === 'maintenance'
  return trade === 'maintenance' || trade === 'inspection'
}

/** Does the job fit on cells[i]? */
export function fitsDay(cells: CalCell[], i: number, needsVacant: boolean, needsDays: number): boolean {
  const c = cells[i]
  if (!c) return false
  if (!needsVacant) return DOOR_OPEN.includes(c.k)
  const n = Math.max(1, needsDays || 1)
  for (let j = 0; j < n; j++) {
    const x = cells[i + j]
    if (!x) return false                                          // runs past the window: unknown, so no
    if (j === 0 ? !NIGHT_FREE.includes(x.k) : !(x.k === 'open' || x.k === 'hold')) return false
  }
  return true
}

export function pickFor(cells: CalCell[], i: number, opts: { dept: string; needsVacant: boolean; needsDays: number }): DayPick {
  const c = cells[i]
  const n = opts.needsVacant ? Math.max(1, opts.needsDays || 1) : 0
  const nights = cells.slice(i, i + n).map(x => x.d)
  const team = c.team.filter(t => tradeFits(opts.dept, t.trade)).sort((a, b) => Number(b.atUnit) - Number(a.atUnit) || a.jobs - b.jobs)
  const lead = team[0] || null
  const kindWord = c.k === 'out' ? 'Checkout' : c.k === 'open' ? 'Open' : c.k === 'hold' ? 'Hold' : c.k === 'in' ? 'Check-in morning' : c.k
  const nextArrival = opts.needsVacant ? (cells[i + n]?.k === 'in' || cells[i + n]?.k === 'turn' ? `next guest ${dayWord(cells[i + n].d)}` : 'no arrival') : ''
  const recommendBlock = opts.needsVacant && nights.length > 0 && nights.every((d, j) => { const k = cells[i + j]?.k; return k === 'out' || k === 'open' })
  return {
    date: c.d, kind: c.k, who: lead ? lead.name : null, atUnit: !!lead?.atUnit, nights, recommendBlock,
    why: [`${kindWord} ${dayWord(c.d)}`, nextArrival, lead ? `${lead.name.split(/\s+/)[0]} ${lead.atUnit ? 'in this unit' : 'in the building'}` : ''].filter(Boolean).join(' · '),
  }
}

/** The best day for the job inside the window, or null when there is none. */
export function bestDay(cells: CalCell[], opts: { today: string; dueOn: string; late: boolean; dept: string; needsVacant: boolean; needsDays: number }): DayPick | null {
  let best: { s: number; i: number } | null = null
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c.d < opts.today || !fitsDay(cells, i, opts.needsVacant, opts.needsDays)) continue
    let s = KIND_SCORE[c.k] || 0
    const team = c.team.filter(t => tradeFits(opts.dept, t.trade))
    if (team.some(t => t.atUnit)) s += 40; else if (team.length) s += 25
    const fromToday = between(opts.today, c.d)
    if (opts.late || opts.dueOn <= opts.today) s -= 2 * fromToday
    else { const over = between(opts.dueOn, c.d); s -= over > 0 ? 4 * over : Math.min(-over, 20) * 0.5 }
    if (!best || s > best.s) best = { s, i }
  }
  return best ? pickFor(cells, best.i, opts) : null
}
