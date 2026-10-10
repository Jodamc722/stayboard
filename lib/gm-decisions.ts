// A DECISION HAS A STATE (Eve audit 2026-10-10).
//
// The GM Brief printed "6 to decide" six mornings in a row — the same blocked inventory, the same
// no-charge tasks, the same short days — because a decision line was computed fresh every day and
// remembered nothing. A list that never changes stops being read. So each standing line now has a
// key and a record: when it first appeared, how many mornings it has been there, what it said last,
// and what the owner did about it. Jon can mark one DECIDED (it leaves the list until the number
// moves) or DEFER it until a date (it leaves until then) from the brief itself, one tap each.
//
// From the second morning a line is one short row under "still open", not the full paragraph; the
// full paragraph comes back when the number behind it moves by a fifth or more.
import 'server-only'
import { getSetting, setSetting } from './app-settings'

export const GM_DECISIONS_KEY = 'gm_decisions'

export type DecisionState = {
  firstSeen: string            // YYYY-MM-DD (ET)
  lastSeen: string
  days: number                 // mornings it has been on the brief, consecutive or not
  value: string                // the number that was printed last ("≈$38,400", "61", "3")
  state?: 'decided' | 'deferred' | null
  until?: string | null        // deferred until (YYYY-MM-DD)
  by?: string | null
  at?: string | null
  decidedValue?: string | null // the value when it was marked decided — a move past it re-opens the line
}

export type DecisionMap = Record<string, DecisionState>

export async function loadDecisions(): Promise<DecisionMap> {
  const v = await getSetting<any>(GM_DECISIONS_KEY, {})
  return v && typeof v === 'object' ? v as DecisionMap : {}
}

export async function saveDecisions(map: DecisionMap, by: string): Promise<void> {
  // Keep it small: anything not seen for 60 days is forgotten.
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
  const keep: DecisionMap = {}
  for (const k of Object.keys(map)) if ((map[k].lastSeen || '') >= cutoff) keep[k] = map[k]
  await setSetting(GM_DECISIONS_KEY, keep, by)
}

/** The first number in a printed value, for "has it moved". */
export function numberIn(v: string): number | null {
  const m = String(v || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

/** Moved by a fifth or more (either way), or from/to zero. */
export function movedMaterially(before: string | null | undefined, after: string): boolean {
  const a = numberIn(before || ''), b = numberIn(after)
  if (a == null || b == null) return before !== after
  if (a === 0 || b === 0) return a !== b
  return Math.abs(b - a) / Math.abs(a) >= 0.2
}

/** Record that `key` is on this morning's brief with `value`. Returns the entry (mutates the map). */
export function noteSeen(map: DecisionMap, key: string, value: string, today: string): DecisionState {
  const cur = map[key]
  if (!cur) { map[key] = { firstSeen: today, lastSeen: today, days: 1, value, state: null }; return map[key] }
  if (cur.lastSeen !== today) cur.days = (Number(cur.days) || 0) + 1
  // A decided line whose number moved past what was decided is a new decision.
  if (cur.state === 'decided' && movedMaterially(cur.decidedValue || cur.value, value)) { cur.state = null; cur.decidedValue = null; cur.days = 1; cur.firstSeen = today }
  if (cur.state === 'deferred' && cur.until && cur.until <= today) { cur.state = null; cur.until = null; cur.days = 1; cur.firstSeen = today }
  cur.lastSeen = today
  cur.value = value
  return cur
}

/** Hidden from this morning's brief: decided (and unchanged) or deferred until later. */
export function isHidden(e: DecisionState | undefined, today: string): boolean {
  if (!e) return false
  if (e.state === 'decided') return true
  if (e.state === 'deferred' && e.until && e.until > today) return true
  return false
}

/** Jon's tap from the brief. */
export async function setDecision(key: string, action: 'decided' | 'defer' | 'reopen', days: number, by: string, today: string): Promise<DecisionState> {
  const map = await loadDecisions()
  const cur: DecisionState = map[key] || { firstSeen: today, lastSeen: today, days: 1, value: '', state: null }
  const now = new Date().toISOString()
  if (action === 'decided') { cur.state = 'decided'; cur.decidedValue = cur.value; cur.until = null }
  else if (action === 'defer') {
    const n = Math.max(1, Math.min(60, Math.round(days) || 7))
    const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
    cur.state = 'deferred'; cur.until = d.toISOString().slice(0, 10); cur.decidedValue = null
  } else { cur.state = null; cur.until = null; cur.decidedValue = null }
  cur.by = by; cur.at = now
  map[key] = cur
  await saveDecisions(map, by)
  return cur
}
