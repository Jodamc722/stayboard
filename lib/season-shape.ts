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
// 65% of the year averages 13% each against 5% for the other seven, so September has to land
// near a quarter of March; at 55% it would sit near 40%. These numbers are the 65% answer:
// September is 25% of March. That is deeper than the blend, and nowhere near the old cliff at
// zero. If the share moves again, this curve has to move with it or the slide will contradict
// the number printed beside it \u2014 ReportView reads both from here for exactly that reason.
//
// Index against March = 100. Shares: Dec 11.5 / Jan 11.6 / Feb 14.2 / Mar 17.5 / Apr 10.2 = 65,
// May 5.6 / Jun 5.0 / Jul 5.1 / Aug 4.7 / Sep 4.4 / Oct 4.6 / Nov 5.6 = 35.
export const SEASON_SHAPE: { m: string; level: number; peak?: boolean }[] = [
  { m: 'J', level: 66, peak: true }, { m: 'F', level: 81, peak: true },
  { m: 'M', level: 100, peak: true }, { m: 'A', level: 58, peak: true },
  { m: 'M', level: 32 }, { m: 'J', level: 29 }, { m: 'J', level: 29 }, { m: 'A', level: 27 },
  { m: 'S', level: 25 }, { m: 'O', level: 26 }, { m: 'N', level: 32 },
  { m: 'D', level: 66, peak: true },
]

/** The headline beside the curve. Tied to the curve above: change one, change the other. */
export const SEASON_PEAK_SHARE = '65%'
export const SEASON_PEAK_LABEL = 'of the year\u2019s revenue lands December through April'
