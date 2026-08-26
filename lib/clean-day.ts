// WHICH DAY DOES A CLEAN BELONG TO — one definition, used by everything that counts cleans.
//
// Jon, 2026-08-26: "we need to see moved cleans when asking about cleaning ... if a departure clean
// was moved that would count toward the payroll for the day."
//
// HOW A MOVE ACTUALLY LOOKS IN THE DATA. Breezeway does not edit a clean onto a new day. It DELETES
// the original row and creates a brand new task on the new day. So every moved clean leaves two
// rows behind: a ghost with status `deleted` sitting on the day it was supposed to happen, and a
// real task on the day it did. Nothing in the payload says "moved" — the pair IS the record of the
// move, and you only see it if you go looking for the ghost.
//
// WHY THIS FILE EXISTS. The labor engine already worked this out (lib/labor-econ.ts) and counts a
// clean on the day it finished. Eve did not: her cleaning tools threw the ghosts away as "gone" and
// bucketed everything by `scheduled_date`. So a clean scheduled Monday and done Tuesday counted on
// MONDAY when you asked her about cleaning and on TUESDAY when you asked what Tuesday cost — the
// same question answered two ways, with nothing saying which rule either number used. That is the
// exact shape of disagreement that makes a payroll conversation unwinnable.
//
// THE RULE (Jon's call, 2026-08-26): a clean belongs to the day the work landed, and a move is
// never silent. The old day says it moved OUT, the new day says it moved IN, and the count on the
// new day is the one that lines up with that day's clocked hours.
//
// ⚠️ DATES ARE ET, NOT UTC. `finished_at` is a timestamptz; slicing the first ten characters of the
// ISO string gives the UTC day, which is a different day for anything finished after 8pm ET. The
// day sheet learned this the hard way (see lib/daysheet.ts) — the labor engine still slices UTC.
import 'server-only'

/** The business runs on ET. Every day boundary in this file is an ET boundary. */
export function etDay(ts: any): string {
  if (!ts) return ''
  const d = new Date(String(ts))
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

export type CleanTask = {
  id?: any
  reference_property_id?: any
  name?: string | null
  status?: string | null
  scheduled_date?: string | null
  finished_at?: string | null
  started_at?: string | null
  assignees?: any
  assignee_name?: string | null
  total_minutes?: number | null
}

/**
 * A ghost: the row Breezeway left behind when the clean was moved to another day.
 * `deleted` is the ONLY signal — there is no "moved" flag anywhere in the payload.
 */
export function isMovedClean(t: CleanTask): boolean {
  return String(t?.status || '').toLowerCase() === 'deleted'
}

/**
 * THE DAY THE WORK LANDED. Finished date wins; otherwise the day it is currently scheduled for.
 * This is the day it counts toward — the same day whose clocked hours paid for it.
 */
export function cleanDay(t: CleanTask): string {
  return etDay(t?.finished_at) || String(t?.scheduled_date || '').slice(0, 10)
}

/** The day it was originally promised — what the ghost still remembers. */
export function promisedDay(t: CleanTask): string {
  return String(t?.scheduled_date || '').slice(0, 10)
}

export type Move = {
  unit: string
  listingId: string
  name: string
  from: string                 // the day it was taken off
  to: string | null            // where it landed, when we can find the replacement
  landed: 'done' | 'scheduled' | 'unknown'
  assignees: string[]
  daysMoved: number | null
}

const names = (t: CleanTask): string[] => {
  const a: any = t?.assignees
  if (Array.isArray(a)) return a.map((x: any) => String(x?.name || '')).filter(Boolean)
  return t?.assignee_name ? [String(t.assignee_name)] : []
}

/**
 * Pair each ghost with the real clean that replaced it: same unit, nearest task within a few days,
 * not itself a ghost. Breezeway gives us no link between the two, so this is a match, not a fact —
 * and when nothing plausible is found we say `to: null` rather than inventing a destination. A move
 * we cannot complete is still worth reporting: it means a clean left a day and we cannot show where
 * it went, which is exactly the case a person should look at.
 */
export function pairMoves(ghosts: CleanTask[], live: CleanTask[], nameOf: (id: any) => string, windowDays = 10): Move[] {
  const out: Move[] = []
  const used: Record<string, boolean> = {}
  for (const g of ghosts) {
    const from = promisedDay(g)
    const prop = String(g.reference_property_id || '')
    const candidates = live
      .filter(t => String(t.reference_property_id || '') === prop && !isMovedClean(t) && !used[String(t.id)])
      .map(t => ({ t, day: cleanDay(t) }))
      .filter(x => !!x.day && x.day !== from)
      .map(x => ({ ...x, gap: Math.abs(dayDiff(from, x.day)) }))
      .filter(x => x.gap <= windowDays)
      .sort((a, b) => a.gap - b.gap || String(a.t.id).localeCompare(String(b.t.id)))
    const hit = candidates[0]
    if (hit) used[String(hit.t.id)] = true
    out.push({
      unit: nameOf(g.reference_property_id),
      listingId: prop,
      name: String(g.name || ''),
      from,
      to: hit ? hit.day : null,
      landed: hit ? (hit.t.finished_at ? 'done' : 'scheduled') : 'unknown',
      assignees: hit ? names(hit.t) : names(g),
      daysMoved: hit ? dayDiff(from, hit.day) : null,
    })
  }
  return out.sort((a, b) => (b.from || '').localeCompare(a.from || ''))
}

export function dayDiff(a: string, b: string): number {
  const x = new Date(String(a) + 'T12:00:00Z').getTime()
  const y = new Date(String(b) + 'T12:00:00Z').getTime()
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0
  return Math.round((y - x) / 86400000)
}

/** One line a person can read, for any tool that reports a move. */
export function describeMove(m: Move): string {
  if (!m.to) return `${m.unit}: taken off ${m.from}, and I cannot find where it went — worth a look.`
  const dir = (m.daysMoved || 0) > 0 ? 'pushed' : 'pulled'
  const n = Math.abs(m.daysMoved || 0)
  const who = m.assignees.length ? ` (${m.assignees.join(', ')})` : ''
  return `${m.unit}: ${m.from} → ${m.to}, ${dir} ${n} day${n === 1 ? '' : 's'}, ${m.landed === 'done' ? 'done' : 'not done yet'}${who}`
}
