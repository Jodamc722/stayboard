// WHERE IS EVERYONE (Jon, 2026-10-05: "a team tab so that we can see who's working and, based on
// their most recent completion, get an assumption of where they might be in the field").
//
// A pure function — no imports, so the Today page, a test and Eve can all call it. It reads one
// person's Breezeway tasks for the day (and their Homebase clock, when we have it) and says, in the
// order a coordinator would reason:
//   1. Something in progress → they are AT that unit (it is the only thing we know for certain).
//   2. Otherwise their last finish → if their next task is in the same building they are likely
//      still there; if it is elsewhere they are likely heading there; nothing left → last seen there.
//   3. Nothing started or finished → not started yet (and, if they clocked in a while ago, say so).
// It is an ASSUMPTION and the words say so ("likely"). A long quiet gap with work left is flagged.

export type WhereTask = {
  unit: string; building: string | null
  status: 'done' | 'doing' | 'todo'
  startedAt: string | null; finishedAt: string | null
}
export type WhereClock = { in: string | null; out: string | null; open: boolean } | null | undefined

export type Where = {
  /** 'at' = in a unit now · 'still' = likely still in the building · 'heading' = likely moving on
   *  · 'last' = finished for the day as far as we know · 'none' = nothing started yet */
  kind: 'at' | 'still' | 'heading' | 'last' | 'none'
  /** The building we would look for them in, when there is one. */
  building: string | null
  /** One line: "At Eden 2104 · started 2:41pm". */
  line: string
  tone: 'sky' | 'slate' | 'amber' | 'emerald'
  /** Minutes since their last sign of life (a start or a finish), when there is one. */
  quietMin: number | null
}

/** "Eden 2104 - Studio" → "Eden 2104"; "17WEST - 403 - 3BR" → "17WEST 403". */
export function shortUnit(u: string): string {
  const parts = String(u || '').split(/\s+-\s+/).filter(Boolean)
  if (parts.length >= 2 && /^\d+[A-Za-z]?(\/\d+)?$/.test(parts[1])) return parts[0] + ' ' + parts[1]
  return parts[0] || String(u || '')
}
const bldg = (t: WhereTask) => t.building || shortUnit(t.unit).split(/\s+/)[0] || null

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' ', '').toLowerCase()
}
const ago = (m: number) => m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '')

/** A gap this long with work left and nothing in progress is worth a look. */
export const QUIET_MIN = 90
/** An in-progress task started longer ago than this is a task left open, not where they are now. */
export const STALE_MIN = 10 * 60
function dayOrTime(iso: string | null, now: Date): string {
  if (!iso) return 'earlier'
  const d = new Date(iso)
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return day(d) === day(now) ? clockTime(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

export function whereNow(tasks: WhereTask[], now: Date = new Date(), clock?: WhereClock): Where {
  const t = Array.isArray(tasks) ? tasks : []
  const mins = (iso: string | null) => iso ? Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000)) : null

  const done = t.filter(x => x.status === 'done' && x.finishedAt).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
  const lastFinish = done[0]?.finishedAt || ''
  // 0. Clocked out (Homebase) and not clocked back in: they are off — say where they finished, don't
  //    guess where they are heading (Jon, 2026-10-05: "needs to show who is on shift, clocked out").
  if (clock && !clock.open && clock.out) {
    const lastAt = done[0] || null
    const left = t.filter(x => x.status !== 'done').length
    return { kind: 'last', building: null, tone: 'slate', quietMin: mins(clock.out),
      line: 'Clocked out ' + clockTime(clock.out) + (lastAt ? ' · last at ' + shortUnit(lastAt.unit) : '') + (left ? ' · ' + left + ' left open' : '') }
  }
  // 1. In progress — the latest start wins if Breezeway shows two running. But only a FRESH one that
  //    is also their latest move: a task started on Friday and never closed (Roberto's Pelican 1,
  //    seen 2026-10-05) says nothing about where he is today, and a finish after the start means
  //    they have moved on and simply left the other task open.
  const doing = t.filter(x => x.status === 'doing').sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
  const fresh = doing.filter(x => { const m = mins(x.startedAt); return m == null || m <= STALE_MIN })
  const leftOpen = doing.find(x => !fresh.includes(x)) || null
  if (fresh.length && String(fresh[0].startedAt || '') >= lastFinish) {
    const d = fresh[0]
    const since = mins(d.startedAt)
    return { kind: 'at', building: bldg(d), tone: 'sky', quietMin: since,
      line: 'At ' + shortUnit(d.unit) + (d.startedAt ? ' · started ' + clockTime(d.startedAt) : '') }
  }
  const stale = leftOpen ? ' · ' + shortUnit(leftOpen.unit) + ' left in progress since ' + dayOrTime(leftOpen.startedAt, now) : ''

  const todo = t.filter(x => x.status === 'todo')

  // 2. Between jobs — read from the last finish and what is left.
  if (done.length) {
    const last = done[0]
    const where = bldg(last)
    const quiet = mins(last.finishedAt)
    const next = todo.find(x => bldg(x) === where) || todo[0] || null
    const fin = 'finished ' + shortUnit(last.unit) + ' ' + clockTime(last.finishedAt)
    const gap = next && quiet != null && quiet >= QUIET_MIN ? ' · nothing started in ' + ago(quiet) : ''
    if (!next) return { kind: 'last', building: where, tone: 'emerald', quietMin: quiet, line: 'Last at ' + (where || shortUnit(last.unit)) + ' · ' + fin + ' · nothing left' + stale }
    if (bldg(next) === where) return { kind: 'still', building: where, tone: gap ? 'amber' : 'slate', quietMin: quiet, line: 'Likely still at ' + where + ' · ' + fin + ' · next ' + shortUnit(next.unit) + gap + stale }
    return { kind: 'heading', building: bldg(next), tone: gap ? 'amber' : 'slate', quietMin: quiet, line: 'Likely heading to ' + (bldg(next) || shortUnit(next.unit)) + ' · ' + fin + ' · next ' + shortUnit(next.unit) + gap + stale }
  }

  // 3. Nothing started yet.
  const first = todo[0] || null
  if (clock?.open && clock.in) {
    const since = mins(clock.in)
    const slow = first && since != null && since >= 45
    return { kind: 'none', building: first ? bldg(first) : null, tone: slow ? 'amber' : 'slate', quietMin: since,
      line: 'Clocked in ' + clockTime(clock.in) + ' · nothing started yet' + (first ? ' · first ' + shortUnit(first.unit) : '') }
  }
  return { kind: 'none', building: first ? bldg(first) : null, tone: 'slate', quietMin: null,
    line: first ? 'Not started · first ' + shortUnit(first.unit) : 'Nothing assigned' }
}

/** The tag for the clock: on since 8:31am · clocked out 3:10pm · not clocked in · (unknown → null). */
export function clockTag(clock: WhereClock, shiftStartMin?: number | null, now: Date = new Date()): { label: string; tone: 'emerald' | 'slate' | 'amber'; title: string } | null {
  if (!clock) return null
  if (clock.open) return { label: 'on the clock', tone: 'emerald', title: 'Clocked in' + (clock.in ? ' at ' + clockTime(clock.in) : '') + ' (Homebase)' }
  if (clock.out) return { label: 'clocked out ' + clockTime(clock.out), tone: 'slate', title: 'Clocked out (Homebase)' }
  const [hh, mm] = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).split(':').map(Number)
  const nowMin = hh * 60 + mm
  if (shiftStartMin != null && nowMin > shiftStartMin + 15) return { label: 'not clocked in', tone: 'amber', title: 'Shift started over 15 minutes ago and Homebase has no clock-in' }
  return null
}

/** "9:00am–5:30pm" from ET minutes past midnight. */
export function shiftHours(start?: number | null, end?: number | null): string {
  const f = (m: number) => { const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am', h12 = ((h + 11) % 12) + 1; return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap }
  if (start == null) return ''
  return f(start) + (end != null ? '–' + f(end) : '')
}

export type ShiftKey = 'on' | 'out' | 'late' | 'later' | 'scheduled' | 'noshift'
/**
 * WHO IS ON SHIFT (Jon, 2026-10-05: "Who is working needs to show who is on shift, clocked out").
 *   on        clocked in right now (Homebase time card open)
 *   out       clocked out today
 *   late      shift started 15+ min ago, no clock-in
 *   later     shift starts later today
 *   scheduled has a shift, clock not readable (Homebase time cards failed)
 *   noshift   no Homebase shift today (working off the Breezeway board only)
 */
export function shiftStatus(clock: WhereClock, shiftStartMin?: number | null, shiftEndMin?: number | null, now: Date = new Date()): { key: ShiftKey; label: string; tone: 'emerald' | 'slate' | 'amber' | 'sky'; title: string } {
  const hours = shiftHours(shiftStartMin, shiftEndMin)
  const [hh, mm] = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).split(':').map(Number)
  const nowMin = hh * 60 + mm
  const shiftT = hours ? 'Shift ' + hours + ' (Homebase)' : 'No Homebase shift today'
  if (clock?.open) return { key: 'on', label: 'on shift' + (clock.in ? ' since ' + clockTime(clock.in) : ''), tone: 'emerald', title: 'Clocked in · ' + shiftT }
  if (clock?.out) return { key: 'out', label: 'clocked out ' + clockTime(clock.out), tone: 'slate', title: 'Clocked out' + (clock.in ? ' (in ' + clockTime(clock.in) + ')' : '') + ' · ' + shiftT }
  if (shiftStartMin == null) return { key: 'noshift', label: 'no shift', tone: 'slate', title: shiftT }
  if (!clock) return { key: 'scheduled', label: 'shift ' + hours, tone: 'sky', title: shiftT + ' · clock-ins could not be read' }
  if (nowMin < shiftStartMin) return { key: 'later', label: 'starts ' + shiftHours(shiftStartMin), tone: 'sky', title: shiftT }
  if (shiftEndMin != null && nowMin > shiftEndMin) return { key: 'out', label: 'shift ended, no punch', tone: 'amber', title: shiftT + ' · Homebase has no clock-in for today' }
  if (nowMin > shiftStartMin + 15) return { key: 'late', label: 'not clocked in', tone: 'amber', title: shiftT + ' · started over 15 minutes ago, no clock-in' }
  return { key: 'later', label: 'starts ' + shiftHours(shiftStartMin), tone: 'sky', title: shiftT }
}
