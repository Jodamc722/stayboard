// ONE BUST FOR THE BOARDS, AND A FRESHNESS FLOOR FOR THE CACHES THAT FEED THEM (2026-09-28 audit,
// 02-cache-perf §B).
//
// Today in Ops, the Command Center and the capacity picture cache the day for under a minute under
// the tag 'day'; the Scheduler caches its snapshot under 'schedule'. A write that changes what those
// boards show and never busts them is how "assigned" read back as "Unassigned" for up to 45 seconds
// after a successful assign — a success that looks exactly like a failure. So every route that
// writes to Breezeway or to the breezeway_tasks_sync mirror calls bustBoards() once the write
// landed. Busting is best-effort and never throws: revalidateTag refuses inside a cached function
// and outside a request, and a board a few seconds stale is better than a failed write.
import { revalidateTag } from 'next/cache'

/** Today in Ops (lib/ops-day), the Command Center core (lib/command-day) and the capacity picture (lib/capacity-day). */
export const DAY_TAG = 'day'
/** The Scheduler's snapshot (lib/schedule-build). */
export const SCHEDULE_TAG = 'schedule'

/** The day only — for writes the Scheduler already reads live (its staged picks). */
export function bustDay(): void {
  try { revalidateTag(DAY_TAG) } catch { /* best-effort */ }
}

/** Every board that reads the Breezeway mirror: the day and the Scheduler. */
export function bustBoards(): void {
  bustDay()
  try { revalidateTag(SCHEDULE_TAG) } catch { /* best-effort */ }
}

// ── NEVER SERVE AN OLD DAY ─────────────────────────────────────────────────────────────────────
// unstable_cache (Next 14) hands back an EXPIRED entry once and refreshes it in the background. On
// a busy page that is a few seconds of lag; after a quiet hour it is an hour-old day, shown as if it
// were now. A reader that must not show that stamps its value when it is built and, past maxAgeMs,
// builds in place instead (the background refresh still lands for the next reader).

/** True when the stamp is missing, unreadable, or older than maxAgeMs. */
export function tooOld(stampIso: string | null | undefined, maxAgeMs: number): boolean {
  const t = Date.parse(String(stampIso || ''))
  return !Number.isFinite(t) || Date.now() - t > maxAgeMs
}

/** Read through the cache; rebuild in place when the cached value's stamp is older than maxAgeMs. */
export async function freshEnough<T>(cached: () => Promise<T>, build: () => Promise<T>, stampOf: (v: T) => string | null | undefined, maxAgeMs: number): Promise<T> {
  const v = await cached()
  return tooOld(stampOf(v), maxAgeMs) ? build() : v
}
