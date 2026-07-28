// On-the-books pacing tone (P14).
//
// Jon's rule, verbatim: "I wouldn't use it as a benchmark. I would use it to create a
// draft... If it's August, this July 20th, and in August we're above 30%, I would say
// we're pacing well for 60 days out, and we're at 20%. That's even better."
//
// Two things follow from that, and both matter:
//
// 1. On-the-books percentages are LEAD-TIME SENSITIVE. 30% on the books for the month
//    we are about to enter reads well. 20% on the books for a month that is still 60
//    days out reads just as well or better, because there is far more booking window
//    left to sell into. A single fixed number applied to every future month is wrong.
//
// 2. These numbers shape HOW WE WRITE, not what the owner sees. There is no benchmark
//    line on a chart, no target printed on a card, no threshold quoted in a sentence.
//    The tiers below exist so a chip can read "PACING WELL" and so the drafting model
//    knows when a month is genuinely worth calling out — nothing more.
//
// This only describes FUTURE months. A month already in progress accumulates occupancy
// simply by being underway, so it keeps its own status and is never tiered.

export type PaceTier = 'exceptional' | 'strong' | 'building' | 'early' | 'inmonth'

export type PaceThresholds = { exceptional: number; strong: number; building: number }

// Indexed by months out: [1] = the month we are about to enter, [2] = ~60 days out,
// [3] = ~90+ days out. Anything further out uses the last row.
const TIERS: PaceThresholds[] = [
  { exceptional: 60, strong: 30, building: 15 }, // 1 month out — going into the month
  { exceptional: 45, strong: 20, building: 10 }, // 2 months out — ~60 days
  { exceptional: 30, strong: 12, building: 6 },  // 3+ months out — long lead time
]

/** Thresholds appropriate to how far out a month sits. Clamped to the table. */
export function paceThresholds(monthsOut: number): PaceThresholds {
  const n = Math.max(1, Math.min(TIERS.length, Math.round(Number(monthsOut) || 1)))
  return TIERS[n - 1]
}

export function paceTier(occPct: unknown, monthsOut = 1): PaceTier {
  const n = Number(occPct)
  if (!isFinite(n)) return 'early'
  const th = paceThresholds(monthsOut)
  if (n >= th.exceptional) return 'exceptional'
  if (n >= th.strong) return 'strong'
  if (n >= th.building) return 'building'
  return 'early'
}

export const PACE_LABEL: Record<PaceTier, string> = {
  exceptional: 'EXCEPTIONAL',
  strong: 'PACING WELL',
  building: 'BUILDING',
  early: 'EARLY',
  inmonth: 'IN MONTH',
}

/** How emphatic the chip should read: 'hi' = best, 'hot' = good, 'cold' = neutral. */
export const PACE_TONE: Record<PaceTier, 'hi' | 'hot' | 'cold'> = {
  exceptional: 'hi', strong: 'hot', building: 'cold', early: 'cold', inmonth: 'hot',
}

/** Status string persisted on an `ahead` month. `inMonth` months keep "IN MONTH". */
export function paceStatus(occPct: unknown, inMonth: boolean, monthsOut = 1): string {
  return inMonth ? PACE_LABEL.inmonth : PACE_LABEL[paceTier(occPct, monthsOut)]
}

/**
 * Drafting guidance handed to the copy model. Deliberately describes TONE, not a rule
 * the owner ever sees — no threshold number may reach the page.
 */
export function paceGuidance(): string {
  return [
    'PACING TONE (drafting guidance only — never quote any of these numbers, and never use the words',
    'benchmark, target, threshold, goal or par in the copy):',
    'On-the-books occupancy is lead-time sensitive. Read it against how far out the month sits.',
    'For the month we are about to enter, roughly 30% or more on the books is pacing well and 60%+ is exceptional.',
    'For a month about 60 days out, roughly 20% or more is pacing well — that is as strong or stronger than 30%',
    'entering a month, because far more of the booking window is still open. Further out again, low-teens is healthy.',
    'Write it plainly and with confidence: "August is pacing well at 34% on the books with two months still to sell."',
    'Never call a month soft, slow, weak, quiet, a shoulder season or a down month. If a month genuinely has little',
    'on the books, say it is early in the booking window and note what is being done to fill it — then stop.',
  ].join(' ')
}
