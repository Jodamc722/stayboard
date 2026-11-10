// THE REPEAT RULE, ON ITS OWN (2026-11-10, brain pass 3). No imports, so the rule that decides
// "this apartment's A/C failed AGAIN" is tested with plain events (lib/brain/__tests__/repeat-rule.test.mjs)
// instead of being trusted. lib/brain/maintenance.ts calls it once per event.
//
// WHY A THIRD PASS. The strict rule of pass 2 still showed Oasis Mango "repeating" on six systems.
// Two holes let unrelated jobs through:
//   1. THE FIX WINDOW IGNORED THE PART. "Back within 30 days of a closed fix" counted whatever part was
//      named, so a light bulb changed on the 1st made an outlet on the 20th a repeat, and a blind
//      re-hung made a wobbly chair one. A fix "did not hold" only when the second job could be the
//      same failure: the same part, or a part nobody named on one side. Two DIFFERENT named parts are
//      two jobs, whatever the dates.
//   2. ONE INCIDENT FILED TWICE. A guest glitch closed at noon and a separate Breezeway task opened at
//      two for the same leak was "a fix that failed in two hours". The same-incident exemption only
//      covered an earlier event that was still open. Now: an event from a DIFFERENT source (glitch /
//      Breezeway task / work order) opened within 72 hours of the earlier one is the same incident,
//      open or closed. The same source within 72 hours of a CLOSED job is still a real repeat — the
//      fix failed the next day.
//
// THE RULE, PRECISELY. For an event E on one apartment and one system, each earlier event P of that
// apartment and system that OPENED in the 90 days before E is read, newest first:
//   • never a repeat when E's system is 'other' or 'cleaning'
//   • P is skipped (same incident) when E opened under 72 h after P opened AND
//       (P was still open when E opened  OR  P came from a different source)
//   • E is a repeat of P when
//       SAME PART      both name a part and it is the same part, any time in the 90 days; or
//       FIX DID NOT HOLD  P was closed before E opened, E opened within 30 days of that close, and
//                         the two do not name two different parts
//   • the newest P that qualifies is the one recorded (prior_event_id)
// `loose` is every P in the 90 days, kept for the drivers jsonb only — it scores nothing.

export const REPEAT_WINDOW_DAYS = 90
export const FIX_HOLD_DAYS = 30
export const SAME_INCIDENT_HOURS = 72
export const NEVER_REPEAT_SYSTEMS: readonly string[] = ['other', 'cleaning']

export type RepeatEvent = {
  id: string
  /** 'glitch' | 'bz_task' | 'work_order' */
  source: string
  system: string
  /** The part of the system it names (lib/task-categories subsystemOf), or null when none is named. */
  part: string | null
  /** ms since epoch */
  openedAt: number
  /** ms since epoch; null while open */
  closedAt: number | null
}

export type RepeatVerdict = {
  /** Earlier events of the same system on the apartment in the 90 days — the loose count. */
  loose: number
  /** The earlier event that makes this one a repeat, or null. */
  hit: string | null
  why: 'same_part' | 'fix_did_not_hold' | null
}

const DAY = 86400_000

/** Decide one event against the earlier events of the same apartment and system (any order). */
export function repeatVerdict(e: RepeatEvent, earlier: RepeatEvent[]): RepeatVerdict {
  const priors = earlier
    .filter(p => p && p.id !== e.id && Number.isFinite(p.openedAt) && p.openedAt <= e.openedAt && e.openedAt - p.openedAt <= REPEAT_WINDOW_DAYS * DAY)
    .sort((a, b) => b.openedAt - a.openedAt || (a.id < b.id ? 1 : -1))
  const out: RepeatVerdict = { loose: priors.length, hit: null, why: null }
  if (NEVER_REPEAT_SYSTEMS.indexOf(e.system) >= 0) return out
  for (const p of priors) {
    const gap = e.openedAt - p.openedAt
    const closedBefore = p.closedAt != null && Number.isFinite(p.closedAt) && p.closedAt <= e.openedAt
    if (gap < SAME_INCIDENT_HOURS * 3600_000 && (!closedBefore || p.source !== e.source)) continue
    const bothNamed = !!e.part && !!p.part
    if (bothNamed && e.part === p.part) { out.hit = p.id; out.why = 'same_part'; return out }
    const partsDiffer = bothNamed && e.part !== p.part
    if (closedBefore && !partsDiffer && e.openedAt - (p.closedAt as number) <= FIX_HOLD_DAYS * DAY) { out.hit = p.id; out.why = 'fix_did_not_hold'; return out }
  }
  return out
}
