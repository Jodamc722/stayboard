// THE YEAR, AND WHY IT IS SHAPED THIS WAY.
//
// Jon, 2026-09-17: "the drop is way too dramatic, use real data on rev in south florida, based
// on seasons", then "change it to 65% of the revenue \u2014 especially our lux portfolio is more
// seasonal."
//
// Both notes are in here, and they pull against each other, so the reasoning matters.
//
// WHAT WAS WRONG. The old shape was a hand-drawn 0-6 scale with September at 0, which the chart
// renders as the curve touching the axis: a slide telling a new owner their unit earns NOTHING
// in September. Nothing measured says that.
//
// WHAT THE DATA SAYS. Revenue per booked unit by check-in month, our own book, Sep 2025 - Aug
// 2026, one clean year normalised per listing so portfolio growth cannot fake a season:
//   J 66 / F 81 / M 100 / A 70 / M 49 / J 45 / J 46 / A 42 / S 24 / O 22 / N 31 / D 65
// Sep-Nov there is thin coverage rather than thin demand: the mirror holds 83/99/125 listings
// with bookings in those months against 160-221 across the winter. Two market sources put the
// real trough higher \u2014 PriceLabs has Miami RevPAR at $179 in March against under $100 in
// August-September, and AirROI has September at 45% of March.
//
// WHY 65% AND NOT 55%. Blending our book with those two market sources gives December-April at
// 55% of the year. Jon's call is 65%, and the reason is a real one that a market-wide average
// cannot see: those sources average all of Miami, and our book is weighted to a luxury
// portfolio, which concentrates into the winter far harder than the median condo does. 65% is
// the house figure.
//
// WHAT THAT COSTS. The share and the depth of the trough are the same fact. Five months holding
// 65% of the year averages 13% each against 5% for the other seven, so the low months have to
// land near a third of the high ones; at 55% they would sit near 40%. There is no arrangement
// of twelve numbers that puts 65% in five months AND keeps the year flat.
//
// A PLATEAU, NOT A SPIKE (Jon, 2026-09-17: "for the slide the peak should not show so much
// higher"). What CAN be fixed is the shape inside the season. The first 65% curve put March at
// 100 against December at 65 — a 35-point tower with everything else falling away from it, so
// the slide read as one enormous month rather than a season. The same 65% now sits across
// December through April as a plateau: 14 points from end to end, March only 4 above February.
// The season is what stands up on the chart, which is the point being made, and September lifts
// from 25% of the peak to 31% as a side effect of not exaggerating March.
//
// If the share moves again, this curve has to move with it or the slide will contradict the
// number printed beside it — ReportView reads both from here for exactly that reason.
//
// Index against March = 100. Shares: Dec 12.2 / Jan 12.6 / Feb 13.6 / Mar 14.2 / Apr 13.2 = 65,
// May 6.4 / Jun 5.2 / Jul 5.1 / Aug 4.8 / Sep 4.4 / Oct 4.5 / Nov 5.0 = 35.
export const SEASON_SHAPE: { m: string; level: number; peak?: boolean }[] = [
  { m: 'J', level: 89, peak: true }, { m: 'F', level: 96, peak: true },
  { m: 'M', level: 100, peak: true }, { m: 'A', level: 93, peak: true },
  { m: 'M', level: 45 }, { m: 'J', level: 37 }, { m: 'J', level: 36 }, { m: 'A', level: 34 },
  { m: 'S', level: 31 }, { m: 'O', level: 32 }, { m: 'N', level: 35 },
  { m: 'D', level: 86, peak: true },
]

/** The headline beside the curve. Tied to the curve above: change one, change the other. */
export const SEASON_PEAK_SHARE = '65%'
export const SEASON_PEAK_LABEL = 'of annual revenue, December through April'

/**
 * The paragraph under the curve. It lives here with the share and the shape because it makes the
 * same claims in words, and a deck generated before any of this still carries the old version:
 * "Your season is November through April... July and August are the floor" — printed directly
 * beneath a chart whose band starts in December and whose floor dot is on September. Three
 * statements, two of them contradicted by the picture above them.
 */
export const SEASON_BODY =
  'December through April is peak season, with March the high point. Demand and rates fall through summer; September is the low, and bookings recover from October.'
/** Older paragraphs, by a phrase each one alone contained. A deck carrying one is repaired. */
export const SEASON_BODY_RETIRED_MARKS = ['July and August are the floor', 'That is when the demand is, that is when the rate is', 'what the rest of the year is preparing for']
export function seasonBodyStale(body: unknown): boolean {
  const s = String(body || '')
  return !s.trim() || SEASON_BODY_RETIRED_MARKS.some(m => s.includes(m))
}
