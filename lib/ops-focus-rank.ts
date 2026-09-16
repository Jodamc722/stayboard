// RANKING FOCUS WITHOUT A MODEL.
//
// Pure functions, no server imports, no I/O — so this can be unit-tested, which is the whole reason
// it is a separate file. The weights are the argument; keep them where they can be read.
import type { Suggestion } from './suggestions'
import type { ReviewItem } from './review-queue'
import type { DupGroup } from './task-audit'

export type FocusPick = { id: string; reason: string; do: 'add' | 'move' | 'cancel' }
export type FocusVerdict = {
  headline: string
  focus: FocusPick[]
  review: { id: string; note: string }[]
  parked: string
}

/** Stable id for a duplicate group, shared by the ranker, the prompt and the client. */
export const dupId = (g: DupGroup) => 'dup:' + g.listingId + '|' + g.date + '|' + g.key

/** Never more than this on the Focus card — a list you cannot finish is not a focus. */
export const MAX_FOCUS = 6

// ── THE RANKER: THE SAME JUDGEMENT, WRITTEN DOWN (Jon, 2026-09-16) ──────────────────────────────
//
// Jon: "can we build this in a way that it's more coded than fable needed?" — and he is right, for a
// reason that only shows up once you read what the engines already hand over.
//
// THE ENGINES ALREADY WROTE THE SENTENCE. `ReviewItem.recommendation` is documented in its own type
// as "the sentence a supervisor reads instead of working it out"; `Suggestion.why` is "the sentence
// a coordinator reads. Written here so every surface says the same thing." The model's headline
// output — a reason per pick — was being regenerated from data that already contained it.
//
// What the model was really supplying was RANKING, and every signal that ranking turns on is a
// field on the candidate: proximity (is somebody already in that building), hasTrade (is somebody
// already driving to that unit), daysOver / waitingDays (how late), vacantTonight, the per-person
// utilisation from the capacity model, and the building for batching. None of that needs judgement
// in the literary sense. It needs weights, and weights belong in code where they can be read,
// argued with and changed — not re-derived from a prompt every two hours at $5/$25 per million.
//
// So this runs by default and the model runs when somebody presses Investigate. The scale below is
// deliberately blunt; it is meant to be legible, not precise.
const W = {
  /** A duplicate is the only candidate that REMOVES work, so it sits above anything the other
   *  branches can reach (freeTrip 80 + lateCap 15 = 95). Set deliberately clear of that ceiling:
   *  a first draft used 90 and a badly late free trip quietly outscored it. */
  duplicate: 120,
  /** Somebody is already driving to that unit that day. The trip is paid for. */
  freeTrip: 80,
  /** The unit is empty today and nobody is booked — the window is now, but somebody must go. */
  emptyToday: 62,
  /** Empty on a later day. Real, but not today's decision. */
  emptyLater: 38,
  /** On the books with no workable day in the horizon. Visible, rarely actionable. */
  noWindow: 16,
  /** Cadence jobs, by how close the nearest able person already is. */
  inBuilding: 68, inArea: 42, nobodyNear: 20,
  /** Per day late, capped — lateness should break ties, not dominate them. */
  perDayLate: 0.5, lateCap: 15,
  vacantTonight: 8,
  someoneNear: 6,
  // A crew with no headroom is handled as a RULE, not a weight — see below. A penalty was the first
  // attempt and it was wrong: -28 only demoted a badly-late job in-building, so "nobody has room"
  // still ended with work being proposed. Some things are not tie-breaks.
}
/** At most this many picks from one building, so Focus is never six jobs in one tower. */
const MAX_PER_BUILDING = 2

type Ranked = { pick: FocusPick; score: number; building: string }

export function rankFocus(
  today: string, sugs: Suggestion[], waiting: ReviewItem[], groups: DupGroup[],
  crew: { people?: { person: string; utilisationPct: number; headroomCleans: number; verdict?: string }[] } | null,
): FocusVerdict {
  // Is there anybody who could actually take another job? The capacity model already priced it.
  const people = (crew?.people || []).filter(p => p.verdict !== 'implausible')
  const crewHasRoom = !people.length || people.some(p => p.utilisationPct < 100 && p.headroomCleans > 0)
  const late = (d: number | null | undefined) => Math.min(W.lateCap, Math.max(0, Number(d) || 0) * W.perDayLate)

  const ranked: Ranked[] = []

  // Duplicates: work already done twice. Cancelling one is the cheapest win on the page.
  for (const g of groups) {
    ranked.push({
      score: W.duplicate,
      building: String((g as any).building || g.unit || ''),
      pick: { id: dupId(g), do: 'cancel', reason: g.unit + ' has this logged twice on ' + g.date + ' — cancel the extra before somebody drives out for it.' },
    })
  }

  // Waiting maintenance: the prize is a day the unit is empty, and the jackpot is a day somebody is
  // already going there.
  for (const w of waiting) {
    const t = w.target
    const base = !t ? W.noWindow : t.hasTrade ? W.freeTrip : (t.date === today ? W.emptyToday : W.emptyLater)
    ranked.push({
      score: base + late(w.waitingDays),
      building: String((w as any).building || w.unit || ''),
      // The engine's own sentence. It is better than anything a re-description would produce, and
      // it is the same words the Review tab shows for the same row.
      pick: { id: w.taskId, do: 'move', reason: w.recommendation },
    })
  }

  // Cadence jobs the engine says are due. These ADD work to the day, so when nobody has room they
  // are not ranked low — they are not offered at all. Proposing a job to a crew that is already
  // over is how a coordinator learns to stop reading this card. They stay in Review, where the
  // parked sentence says why.
  if (crewHasRoom) {
    for (const s of sugs) {
      const base = s.proximity === 'building' ? W.inBuilding : s.proximity === 'area' ? W.inArea : W.nobodyNear
      ranked.push({
        score: base + late(s.daysOver) + (s.vacantTonight ? W.vacantTonight : 0) + (s.candidates.length ? W.someoneNear : 0),
        building: String(s.building || s.unit || ''),
        pick: { id: s.id, do: 'add', reason: s.why },
      })
    }
  }

  ranked.sort((a, b) => b.score - a.score)

  const focus: FocusPick[] = []
  const perBuilding: Record<string, number> = {}
  const skippedForSpread: Ranked[] = []
  for (const r of ranked) {
    if (focus.length >= MAX_FOCUS) break
    const b = r.building || '—'
    if ((perBuilding[b] || 0) >= MAX_PER_BUILDING) { skippedForSpread.push(r); continue }
    perBuilding[b] = (perBuilding[b] || 0) + 1
    focus.push(r.pick)
  }

  // ── the headline, written from what was actually picked ──
  const n = { cancel: 0, move: 0, add: 0 }
  for (const f of focus) n[f.do]++
  const bits: string[] = []
  if (n.cancel) bits.push(n.cancel + ' duplicate' + (n.cancel === 1 ? '' : 's') + ' to cancel')
  if (n.move) bits.push(n.move + ' already on the books with a day that works')
  if (n.add) bits.push(n.add + ' preventative job' + (n.add === 1 ? '' : 's') + ' worth filing')
  const headline = !focus.length
    ? (crewHasRoom
        ? 'Nothing worth pushing today — everything outstanding is either scheduled or has no workable day.'
        : 'Nobody has room today, so nothing new is worth adding. The list is in Review when the crew frees up.')
    : focus.length + ' worth doing today: ' + bits.join(', ') + '.'

  // Everything not picked is reviewable. The note is the shape of the row, not a re-judgement.
  const picked = new Set(focus.map(f => f.id))
  const review = [
    ...groups.filter(g => !picked.has(dupId(g))).map(g => ({ id: dupId(g), note: 'done twice' })),
    ...waiting.filter(w => !picked.has(w.taskId)).map(w => ({
      id: w.taskId,
      note: !w.target ? 'no workable day in 21' : w.target.hasTrade ? 'free trip ' + w.target.date : 'unit empty ' + w.target.date,
    })),
    ...sugs.filter(s => !picked.has(s.id)).map(s => ({
      id: s.id,
      note: s.proximity === 'building' ? 'somebody in the building' : s.daysOver > 0 ? s.daysOver + 'd over' : 'due',
    })),
  ]

  const parkedCount = review.length
  const parked = !parkedCount ? ''
    : parkedCount + ' more in Review'
      + (skippedForSpread.length ? ', including ' + skippedForSpread.length + ' held back so Focus is not all one building' : '')
      + (!crewHasRoom ? ' — the crew is at capacity, so nothing new was added' : '')
      + '.'

  return { headline, focus, review, parked }
}

