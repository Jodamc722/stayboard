// THE YEAR, FROM REAL NUMBERS (Jon, 2026-09-17: "the drop is way too dramatic, use real data
// on rev in south florida, based on seasons — just to get a real idea of the trends").
//
// The old shape was a hand-drawn 0-6 scale with September at 0, which the chart renders as the
// curve touching the axis: a slide telling a new owner their unit earns NOTHING in September.
// That is not what happens and it is not what our own book says.
//
// These are index values against March = 100, blended from three sources that agree on the
// shape and disagree only about how deep the trough goes:
//
//   1. OUR OWN BOOK. Revenue per booked unit by check-in month, Sep 2025 - Aug 2026, one clean
//      year normalised per listing so portfolio growth cannot fake a season:
//      J 66 / F 81 / M 100 / A 70 / M 49 / J 45 / J 46 / A 42 / S 24 / O 22 / N 31 / D 65.
//   2. PriceLabs, Miami: RevPAR peaks at $179 in March, $130 April, $112 May, under $100 in
//      August-September; low season runs 40-55% below peak.
//   3. AirROI, Miami: March is the high (revenue $6,509, 59.7% occupancy), September the floor
//      (revenue $2,915, 27.8% occupancy) — a trough at 45% of the peak.
//
// WHERE THEY DISAGREE, THE MARKET WINS, AND ONLY FOR SEP-NOV. Our mirror holds 83/99/125
// listings with bookings in those months against 160-221 across the winter, so the 22-31 in our
// own data is thin coverage, not demand. Those three months are floored at the 40-48 both
// market sources support. Every other month is ours as measured.
//
// This puts December-April at 55% of the year, not the 65% the deck claimed. See peakShare.
export const SEASON_SHAPE: { m: string; level: number; peak?: boolean }[] = [
  { m: 'J', level: 66, peak: true }, { m: 'F', level: 81, peak: true },
  { m: 'M', level: 100, peak: true }, { m: 'A', level: 70, peak: true },
  { m: 'M', level: 49 }, { m: 'J', level: 45 }, { m: 'J', level: 46 }, { m: 'A', level: 42 },
  { m: 'S', level: 40 }, { m: 'O', level: 43 }, { m: 'N', level: 48 },
  { m: 'D', level: 65, peak: true },
]
