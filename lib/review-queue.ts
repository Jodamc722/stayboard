// REVIEW — WHAT IS OUTSTANDING, AND WHEN IT COULD ACTUALLY BE DONE.
//
// Jon, 2026-08-31: "there should be a section for review. Review is pending tasks and
// recommendations, which help guide supervisors, operators, and maintenance to make plans for
// their day."
//
// The briefs already answer "what is happening today". They have never answered "what is hanging
// over us, and when is the next moment we could clear it" — and that second question is the one a
// supervisor needs to PLAN rather than react. A list of overdue jobs on its own is just a guilt
// trip; it becomes a plan the moment each line carries a date somebody can actually work.
//
// So every row is a pair: the outstanding job, and the next day the unit is empty — flagged when a
// technician is already booked there, because that is a job that costs nothing extra to clear.
//
// SCOPED, NEVER PORTFOLIO-WIDE BY ACCIDENT. The caller passes the units the brief is already
// scoped to, so Broward's brief reviews Broward.
import 'server-only'
import { pendingForUnits, type PendingTask } from './pending-work'
import { workableDays, type WorkableDay } from './unit-windows'

export type ReviewItem = {
  taskId: string
  listingId: string
  unit: string
  task: string
  dept: string
  scheduledDate: string | null
  /** How long it has been waiting. Null when it is scheduled ahead rather than overdue. */
  waitingDays: number | null
  assignees: string[]
  status: string
  reportUrl: string | null
  target: WorkableDay | null
  /** The sentence a supervisor reads instead of working it out. */
  recommendation: string
}

export type ReviewQueue = {
  items: ReviewItem[]
  summary: {
    total: number
    /** Jobs with a free trip waiting — somebody is already going, this costs nothing. */
    freeTrips: number
    /** Jobs with an empty day available but nobody booked — needs a person sent. */
    needsATrip: number
    /** Nowhere to put them in the window: the unit is full for 21 days. */
    noWindow: number
    oldestDays: number | null
  }
}

const dayWord = (n: number | null) =>
  n == null ? 'scheduled ahead' : n === 0 ? 'due today' : n === 1 ? '1 day late' : `${n} days late`

const niceDate = (ymd: string) => {
  try {
    const d = new Date(ymd + 'T12:00:00Z')
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
  } catch { return ymd }
}

/**
 * Build the review queue for a set of units.
 *
 * MAINTENANCE ONLY by default (Jon, 2026-08-31: "just maintenance"). Housekeeping does not plan
 * this way — a cleaner's day is a route against a 4pm deadline, and a backlog list does not help
 * them run it. Maintenance is the trade where the question "when can I get in" is the whole job.
 */
export async function buildReviewQueue(
  listingIds: string[],
  today: string,
  opts: { nameOf?: Record<string, string>; horizon?: number; lookBackDays?: number; limit?: number } = {},
): Promise<ReviewQueue> {
  const empty: ReviewQueue = { items: [], summary: { total: 0, freeTrips: 0, needsATrip: 0, noWindow: 0, oldestDays: null } }
  const ids = Array.from(new Set(listingIds.map(String))).filter(Boolean)
  if (!ids.length) return empty

  const horizon = Math.max(1, opts.horizon ?? 21)
  const pendingBy = await pendingForUnits(ids, today, { lookBackDays: opts.lookBackDays ?? 30 })
  const withWork = Object.keys(pendingBy).filter(k => (pendingBy[k] || []).length)
  if (!withWork.length) return empty

  const windows = await workableDays(withWork, today, horizon)

  const items: ReviewItem[] = []
  for (const lid of withWork) {
    const win = windows[lid]?.best || null
    for (const t of (pendingBy[lid] || []) as PendingTask[]) {
      // Maintenance, plus Lighthouse's own inspections — the two things that ride along on a trip.
      const eligible = t.dept === 'maintenance' || (t.dept === 'inspection' && t.byLighthouse)
      if (!eligible) continue
      items.push({
        taskId: t.id, listingId: lid,
        unit: opts.nameOf?.[lid] || lid,
        task: t.name, dept: t.dept,
        scheduledDate: t.scheduledDate,
        waitingDays: t.overdueDays,
        assignees: t.assignees || [],
        status: t.status,
        reportUrl: t.reportUrl,
        target: win,
        recommendation: !win
          ? 'No empty day in the next three weeks — the unit is booked solid, so this needs a guest-in visit or a schedule change.'
          : win.hasTrade
            ? `${win.who[0]} is already in this unit on ${niceDate(win.date)} — send it with them and the trip costs nothing.`
            : `Unit is empty ${niceDate(win.date)} — earliest day somebody can actually get in.`,
      })
    }
  }

  // Longest wait first. The job somebody should be embarrassed about leads.
  items.sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.unit.localeCompare(b.unit))

  const capped = items.slice(0, Math.max(1, opts.limit ?? 40))
  return {
    items: capped,
    summary: {
      total: items.length,
      freeTrips: items.filter(i => i.target?.hasTrade).length,
      needsATrip: items.filter(i => i.target && !i.target.hasTrade).length,
      noWindow: items.filter(i => !i.target).length,
      oldestDays: items.length ? (items[0].waitingDays ?? null) : null,
    },
  }
}

export { dayWord, niceDate }
