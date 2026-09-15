// THE DAILY CHECKLIST — the parts the server and the browser both need.
//
// Split out of lib/daily-checklist (which is server-only) so the page and the API agree about what
// "late" means and what a time reads like, instead of each keeping its own copy. A checklist whose
// header and rows disagree about whether something is overdue is worse than no checklist.
export const BANDS = ['morning', 'midday', 'afternoon', 'evening'] as const
export type Band = typeof BANDS[number]
export const BAND_LABEL: Record<Band, string> = {
  morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening',
}
/** The buildings are all in one timezone; the checklist runs on their clock, not the server's. */
export const OPS_TZ = 'America/New_York'

/** "14:30:00" or "14:30" → 870 minutes past midnight. Null for anything that is not a time. */
export function minutesOf(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  if (!m) return null
  const h = Number(m[1]), mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h > 23 || mm > 59) return null
  return h * 60 + mm
}

/** "14:30:00" → "2:30 PM". The list is read at a glance, and 24-hour time is not. */
export function clockLabel(t: string | null | undefined): string | null {
  const mins = minutesOf(t)
  if (mins == null) return null
  const h24 = Math.floor(mins / 60), mm = mins % 60
  const h = h24 % 12 || 12
  return `${h}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** The operating day and the minute of it, both on the buildings' clock. */
export function opsNow(at: Date = new Date()): { day: string; minutes: number; clock: string } {
  const day = at.toLocaleDateString('en-CA', { timeZone: OPS_TZ })
  const clock = at.toLocaleTimeString('en-GB', { timeZone: OPS_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  return { day, minutes: minutesOf(clock) ?? 0, clock }
}

/**
 * Is this item late?
 *
 * Late means three things at once: it has a time, that time has passed, and nobody has ticked it.
 * An item with no time can never be late — plenty of daily work genuinely just has to happen
 * sometime, and colouring it red at midnight would teach people to ignore red.
 */
export function isLate(byTime: string | null | undefined, done: boolean, nowMinutes: number): boolean {
  if (done) return false
  const due = minutesOf(byTime)
  return due != null && nowMinutes > due
}

/** How the day is going. `next` is the soonest thing still ahead of somebody. */
export function progressOf<T extends { done: boolean; late: boolean; in_minutes: number | null }>(rows: T[]) {
  const total = rows.length
  const done = rows.filter(r => r.done).length
  const late = rows.filter(r => r.late).length
  const next = rows.filter(r => !r.done && r.in_minutes != null && r.in_minutes >= 0)
    .sort((a, b) => (a.in_minutes as number) - (b.in_minutes as number))[0] || null
  return { total, done, late, pct: total ? Math.round((done / total) * 100) : 0, next }
}
