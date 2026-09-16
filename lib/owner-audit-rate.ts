// WHAT A NIGHT SHOULD HAVE COST, ONCE YOU KNOW HOW LONG THEY STAYED.
//
// Jon, 2026-09-16: "we're getting a lot of low-rate flags at properties that maybe don't need it."
//
// The benchmark in lib/owner-audit is careful about a lot of things — it splits Friday and Saturday
// from midweek, pools by building and bedroom count, subtracts the stay's own nights so nothing is
// compared against itself, and refuses a cohort under twenty nights. It does not know how long the
// guest stayed, and in this portfolio that is the single largest driver of nightly rate:
//
//   Jul–Aug 2026, 1,919 bookings
//     1–6 nights    1,519 bookings    $156.99 / night
//     7–13 nights     267 bookings    $106.20 / night   68% of short-stay
//     14–27 nights     81 bookings    $101.31 / night   65%
//     28+ nights       52 bookings     $77.67 / night   49%
//
// The relative flag fires below 55% of expected. A monthly booking averages 49%. So EVERY monthly
// stay sat at or under the line by construction, before anything was actually wrong, and the
// week-long band sat one soft month away from it. Four hundred of those 1,919 bookings are
// discounted by length and were being measured against a benchmark made mostly of weekend traffic.
// It clusters on whichever units take long stays, which is exactly why it read as "certain
// properties".
//
// WHY A PORTFOLIO-WIDE FACTOR AND NOT ANOTHER COHORT DIMENSION. The obvious fix is to add length to
// the cohort key beside weekday/weekend. It is the wrong one: building + bedrooms + length band +
// night class slices 1,900 bookings into samples of three or four, and a benchmark built on four
// nights is worse than no benchmark. The length discount is a property of how this company prices,
// not of a particular tower, so it is measured once across everything and applied as a multiplier.
// Thousands of nights behind it, and it moves with the real book rather than a hardcoded guess.

/** The bands people actually price in: a weekend, a week, a fortnight-plus, a month. */
export type LengthBand = 'short' | 'week' | 'extended' | 'monthly'

export function lengthBand(nights: number): LengthBand {
  const n = Math.max(0, Math.round(Number(nights) || 0))
  if (n >= 28) return 'monthly'
  if (n >= 14) return 'extended'
  if (n >= 7) return 'week'
  return 'short'
}

export const BAND_LABEL: Record<LengthBand, string> = {
  short: 'stays under a week', week: 'week-long stays', extended: 'two-week-plus stays', monthly: 'monthly stays',
}

export type RateSample = { nights: number; nightly: number }
/** short is 1 by definition; the others are what this portfolio actually charges relative to it. */
export type LengthFactors = Record<LengthBand, number>

/** Below this many bookings a band has not earned an opinion and keeps the neutral 1. */
export const BAND_MIN_SAMPLES = 12
/** Guard rails. A factor outside this is a data problem, not a pricing pattern. */
const FLOOR = 0.35, CEIL = 1.15

export const NEUTRAL_FACTORS: LengthFactors = { short: 1, week: 1, extended: 1, monthly: 1 }

/**
 * Measure the length discount from the book itself.
 *
 * MEDIAN, NOT MEAN. One $9,000 corporate month would drag a mean badly, and the whole point of this
 * number is to describe the typical booking rather than the loudest one.
 */
export function lengthFactors(samples: RateSample[]): LengthFactors {
  const by: Record<LengthBand, number[]> = { short: [], week: [], extended: [], monthly: [] }
  for (const s of samples) {
    const nightly = Number(s.nightly) || 0
    const nights = Number(s.nights) || 0
    if (nightly <= 0.5 || nights <= 0) continue
    by[lengthBand(nights)].push(nightly)
  }
  const med = (xs: number[]): number | null => {
    if (xs.length < BAND_MIN_SAMPLES) return null
    const a = xs.slice().sort((x, y) => x - y)
    const m = Math.floor(a.length / 2)
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }
  const base = med(by.short)
  // No trustworthy short-stay baseline means no trustworthy ratios. Say nothing rather than guess.
  if (!base || base <= 0) return { ...NEUTRAL_FACTORS }
  const out: LengthFactors = { ...NEUTRAL_FACTORS }
  for (const band of ['week', 'extended', 'monthly'] as LengthBand[]) {
    const m = med(by[band])
    if (m == null || m <= 0) continue
    out[band] = Math.min(CEIL, Math.max(FLOOR, m / base))
  }
  return out
}

/**
 * The expected rate for THIS stay: the cohort's number, scaled for how long they stayed.
 *
 * The cohort average is dominated by short stays, so it is treated as the short-stay expectation
 * and discounted from there. A factor of exactly 1 leaves the old behaviour untouched, which is
 * what happens for short stays and for any band without enough bookings behind it.
 */
export function expectedForLength(cohortPerNight: number, nights: number, f: LengthFactors): number {
  const base = Number(cohortPerNight) || 0
  if (base <= 0) return 0
  return base * (f[lengthBand(nights)] ?? 1)
}

/** For the sentence a person reads: only worth saying when the stay was long enough to matter. */
export function lengthNote(nights: number, f: LengthFactors): string {
  const band = lengthBand(nights)
  const factor = f[band] ?? 1
  if (band === 'short' || factor >= 0.98) return ''
  return ' Expected is discounted to ' + Math.round(factor * 100) + '% for ' + BAND_LABEL[band]
    + ', measured across the portfolio — a monthly booking is not a short stay that went wrong.'
}
