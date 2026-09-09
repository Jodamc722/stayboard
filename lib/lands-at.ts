// WILL THIS CLEAN LAND? (Jon, 2026-09-09 audit.)
//
// The board has always had a 4pm clock and a red "AT RISK" flag, and the flag was a clock threshold:
// `minsLeft <= atRiskMin && !running`. That says the same thing about every unstarted clean in the
// portfolio at 2:30pm, whether it is the cleaner's next stop or her fifth. It cannot answer the
// question a coordinator actually asks — "is THIS one going to make it?" — and it flags the wrong
// units at exactly the hour when acting on the wrong unit is most expensive.
//
// The answer was already computed and thrown away. lib/capacity orders each person's run
// (nearest-neighbour) and prices every stop in it — travel in, prep, the work itself against a
// measured per-market, per-bedroom standard, wrap. Add a start time and those minutes become
// clock times: this unit is reached at 12:40 and finishes at 14:25.
//
// ── WHAT THIS IS HONEST ABOUT ───────────────────────────────────────────────────────────────────
// A projection is a claim about the future and it must carry its own confidence:
//   started   the clean is running — we know when it began, so the finish is the strongest guess
//             available and the only one grounded in an observed fact.
//   ordered   not started, but the person's run is priced ahead of it: everything before it in
//             their day, plus travel, plus this unit. Good when the run order is roughly right.
//   loose     no start time on record for that person (no Homebase shift), so we assume a standard
//             morning. Directional only, and the UI says so rather than printing a confident time.
//   none      nobody is on it. There is no run to sit in, so there is no landing time — only the
//             fact that it needs a person, which the board already says loudly.
//
// A unit nobody owns is never "at risk" here — it is unowned, which is a different and worse thing,
// and conflating the two is how "at risk" came to mean nothing.
import 'server-only'
import type { DayLoad } from './capacity'

export type Landing = {
  /** The Breezeway task id this projection is about. */
  taskId: string
  /** ET minutes past midnight when the unit is expected to be finished. */
  endMin: number
  /** ET minutes when work is expected to START on it. */
  startMin: number
  confidence: 'started' | 'ordered' | 'loose'
  /** Who is expected to do it, per the run. */
  person: string
  /** How far past the deadline it lands. Negative = comfortable. */
  overMin: number
  /** Where it sits in that person's day, 1-based — "her fifth stop" is why it is late. */
  position: number
  of: number
}

/** 9:00 AM, when a person has work but no shift on record. Stated, never silently assumed. */
const ASSUMED_START_MIN = 9 * 60

/**
 * Project a finish time for every clean in the day, from the capacity model's own run order.
 *
 * `people` is DayPicture.people (each carrying `ordered`, `units` and `shiftStartMin`).
 * `startedAt` maps a task id to when it actually started, which beats any estimate.
 * `nowMin` lets a running job that has already overrun report the truth rather than its estimate.
 */
export function projectLandings(
  people: (DayLoad & { shiftStartMin?: number | null })[],
  opts: {
    startedAt?: Record<string, string | null>
    /** Tasks that will not be worked today (done, or an extended stay) — they cost the day nothing. */
    skip?: Set<string>
    nowMin: number
  },
): Record<string, Landing> {
  const out: Record<string, Landing> = {}
  const startedAt = opts.startedAt || {}
  const skip = opts.skip || new Set<string>()
  const now = opts.nowMin

  for (const p of people) {
    // A day the model refused to price (more work credited than a day can hold) cannot be turned
    // into clock times — the arithmetic would be confident nonsense.
    if (p.verdict === 'implausible') continue
    const units = p.units || []
    if (!units.length) continue

    // ── ONLY WHAT IS LEFT, FROM NOW ────────────────────────────────────────────────────────────
    // `p.units` is priced in ROUTE order (nearest-neighbour from an arbitrary first stop) and it
    // includes work already finished. Walking it start-to-end and letting each started task
    // re-anchor the clock made time run backwards: a pending 3pm clean sitting early in the route
    // came out "lands 9:50 AM", which then CLEARED its at-risk flag. A projection that clears the
    // flag on the units most likely to be in trouble is worse than no projection.
    //
    // So the walk is over remaining work only, and it starts at the later of now and the shift:
    // nothing pending can begin in the past. Route order is kept as the best available guess at the
    // order the rest of the day gets worked, which is what it is actually good for.
    const remaining = units.filter(u => !skip.has(String(u.id)))
    if (!remaining.length) continue

    const hasShift = Number.isFinite(p.shiftStartMin as any) && (p.shiftStartMin as number) > 0
    const baseConfidence: Landing['confidence'] = hasShift ? 'ordered' : 'loose'
    let cursor = Math.max(now, hasShift ? (p.shiftStartMin as number) : ASSUMED_START_MIN)

    // Whatever is under way right now goes first, and it is measured, not guessed: what is left of
    // it is its standard minus the time already spent — never less than five minutes, because a job
    // that has overrun is still not finished.
    const running = remaining.filter(u => !!startedAt[String(u.id)])
    const pending = remaining.filter(u => !startedAt[String(u.id)])
    const ordered = running.concat(pending)

    for (let i = 0; i < ordered.length; i++) {
      const u = ordered[i]
      const began = startedAt[String(u.id)] ? etMinutesOfIso(startedAt[String(u.id)] as string) : null
      let confidence: Landing['confidence'] = baseConfidence
      let cost = u.totalMin
      if (began != null) {
        confidence = 'started'
        // Elapsed against the standard. Past it, we only claim the floor — the honest statement is
        // "still going", not a finish time that has already passed.
        cost = Math.max(5, u.totalMin - Math.max(0, now - began))
      }
      const startMin = cursor
      const endMin = startMin + cost
      cursor = endMin

      out[String(u.id)] = {
        taskId: String(u.id),
        startMin, endMin,
        confidence,
        person: p.person,
        overMin: 0,          // filled in by the caller, which owns the deadline
        position: i + 1,
        of: ordered.length,
      }
    }
  }
  return out
}

/** Stamp each landing against the deadline the board is running to. */
export function againstDeadline(landings: Record<string, Landing>, deadlineMin: number): Record<string, Landing> {
  for (const k of Object.keys(landings)) landings[k].overMin = landings[k].endMin - deadlineMin
  return landings
}

/** '2:35 PM' from ET minutes past midnight. */
export function clockOf(min: number): string {
  const m = Math.max(0, Math.round(min))
  const day = Math.floor(m / (24 * 60))
  const h = Math.floor(m / 60) % 24, mi = m % 60
  // A run that spills past midnight must say so, or "12:30 AM" reads as this morning.
  return (h % 12 === 0 ? 12 : h % 12) + ':' + String(mi).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM') + (day ? ' +' + day + 'd' : '')
}

function etMinutesOfIso(iso: string): number | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t))
  return (Number(p.find(x => x.type === 'hour')?.value || 0) % 24) * 60 + Number(p.find(x => x.type === 'minute')?.value || 0)
}
