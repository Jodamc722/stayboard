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

export function whereNow(tasks: WhereTask[], now: Date = new Date(), clock?: WhereClock): Where {
  const t = Array.isArray(tasks) ? tasks : []
  const mins = (iso: string | null) => iso ? Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000)) : null

  // 1. In progress — the latest start wins if Breezeway shows two running.
  const doing = t.filter(x => x.status === 'doing').sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
  if (doing.length) {
    const d = doing[0]
    const since = mins(d.startedAt)
    return { kind: 'at', building: bldg(d), tone: 'sky', quietMin: since,
      line: 'At ' + shortUnit(d.unit) + (d.startedAt ? ' · started ' + clockTime(d.startedAt) : '') }
  }

  const todo = t.filter(x => x.status === 'todo')
  const done = t.filter(x => x.status === 'done' && x.finishedAt).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))

  // 2. Between jobs — read from the last finish and what is left.
  if (done.length) {
    const last = done[0]
    const where = bldg(last)
    const quiet = mins(last.finishedAt)
    const next = todo.find(x => bldg(x) === where) || todo[0] || null
    const fin = 'finished ' + shortUnit(last.unit) + ' ' + clockTime(last.finishedAt)
    const gap = next && quiet != null && quiet >= QUIET_MIN ? ' · nothing started in ' + ago(quiet) : ''
    if (!next) return { kind: 'last', building: where, tone: 'emerald', quietMin: quiet, line: 'Last at ' + (where || shortUnit(last.unit)) + ' · ' + fin + ' · nothing left' }
    if (bldg(next) === where) return { kind: 'still', building: where, tone: gap ? 'amber' : 'slate', quietMin: quiet, line: 'Likely still at ' + where + ' · ' + fin + ' · next ' + shortUnit(next.unit) + gap }
    return { kind: 'heading', building: bldg(next), tone: gap ? 'amber' : 'slate', quietMin: quiet, line: 'Likely heading to ' + (bldg(next) || shortUnit(next.unit)) + ' · ' + fin + ' · next ' + shortUnit(next.unit) + gap }
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
