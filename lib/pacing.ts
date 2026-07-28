// On-the-books pacing benchmarks (P14).
//
// Jon's yardstick, verbatim: "ALOS PACING ABOVE 20% GOING INTO MONTH IS GREAT,
// 63% FOR AUGUST WOULD BE ABSOLUTELY AMAZING." So 20% on the books entering a
// month is the bar we hold ourselves to, and the 60s are exceptional.
//
// This only describes FUTURE months. A month already in progress accumulates
// occupancy simply by being underway, so the same thresholds would flatter it —
// the in-progress month keeps its own status and is never tiered.

export type PaceTier = 'exceptional' | 'strong' | 'building' | 'early' | 'inmonth'

/** At or above this, a future month is pacing well. */
export const PACE_BENCHMARK = 20
/** At or above this, a future month is exceptional. */
export const PACE_EXCEPTIONAL = 60
/** Below the benchmark but with real volume already on the books. */
export const PACE_BUILDING = 10

export function paceTier(occPct: unknown): PaceTier {
  const n = Number(occPct)
  if (!isFinite(n)) return 'early'
  if (n >= PACE_EXCEPTIONAL) return 'exceptional'
  if (n >= PACE_BENCHMARK) return 'strong'
  if (n >= PACE_BUILDING) return 'building'
  return 'early'
}

export const PACE_LABEL: Record<PaceTier, string> = {
  exceptional: 'EXCEPTIONAL',
  strong: 'AHEAD OF PACE',
  building: 'BUILDING',
  early: 'EARLY',
  inmonth: 'IN MONTH',
}

/** How emphatic the chip should read: 'hi' = best, 'hot' = good, 'cold' = neutral. */
export const PACE_TONE: Record<PaceTier, 'hi' | 'hot' | 'cold'> = {
  exceptional: 'hi', strong: 'hot', building: 'cold', early: 'cold', inmonth: 'hot',
}

/** One short clause explaining the chip, safe to show an owner. */
export function paceNote(occPct: unknown): string {
  const n = Number(occPct) || 0
  const t = paceTier(n)
  if (t === 'exceptional') return n + '% on the books — well past the ' + PACE_BENCHMARK + '% benchmark'
  if (t === 'strong') return n + '% on the books — above the ' + PACE_BENCHMARK + '% benchmark'
  if (t === 'building') return n + '% on the books — building toward the ' + PACE_BENCHMARK + '% benchmark'
  return 'Early in the booking window · ' + PACE_BENCHMARK + '% is the benchmark'
}

/** Status string persisted on an `ahead` month. `inMonth` months keep "IN MONTH". */
export function paceStatus(occPct: unknown, inMonth: boolean): string {
  return inMonth ? PACE_LABEL.inmonth : PACE_LABEL[paceTier(occPct)]
}
