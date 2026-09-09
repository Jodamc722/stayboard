// REVIEW SCALE RULES (Jon 2026-08-07).
//
// Every rating is STORED on the 5-star scale — Booking.com's 0-10 score is divided by 2 at sync
// (lib/guesty mapReview) — so combined and building averages are honest "out of 5" math with no
// channel inflating the number. But when a rating is shown FOR BOOKING ALONE (a Booking review
// row, the Booking chip in a channel split) it reads on Booking's native /10 — the number the
// guest and the OTA page actually show.
//
// Client-safe: imported by 'use client' components and server code alike.
export const isBookingChannel = (ch: any) => /booking/i.test(String(ch || ''))

/** Display a stored (5-scale) rating in its channel's native scale. */
export function ratingDisplay(rating: number | null | undefined, channel?: any): string {
  const r = Number(rating)
  if (rating == null || !Number.isFinite(r)) return '—'
  if (isBookingChannel(channel)) return String(Math.round(r * 2 * 10) / 10) + '/10'
  return String(Math.round(r * 10) / 10)
}

// ── A SCORE ONLY MEANS SOMETHING AGAINST ITS OWN CHANNEL (Jon, 2026-09-09: "feel like some of
// the data is broken") ──────────────────────────────────────────────────────────────────────────
// Halving Booking's 0-10 makes the arithmetic honest and the JUDGEMENTS wrong. Booking guests rate
// hard: 8/10 is a normal good stay, and stored as 4.0 it tripped every "below 4.5" rule in the app.
// A Booking-heavy unit therefore sat permanently in the at-risk list, permanently in review
// recovery, and permanently near the bottom of the league table — with nothing wrong with it. That
// is exactly the kind of number that teaches a team to stop trusting the page.
//
// So the thresholds are per scale, set at the same point in each channel's OWN working range:
//   five-star   Airbnb/Vrbo 4.9+   ·   Booking 9/10+   ("Superb" — the band Booking itself labels)
//   low         Airbnb/Vrbo 3.0-   ·   Booking 7/10-   (below "Good"; a 6/10 is a complaint)
// Everything comparative on the reviews dashboard is done against PAR — the portfolio's own average
// on that channel in the window — which needs no constants at all and self-calibrates.
export const isFiveStarReview = (rating: any, channel?: any) =>
  Number(rating) >= (isBookingChannel(channel) ? 4.5 : 4.9)

export const isLowReview = (rating: any, channel?: any) =>
  Number(rating) <= (isBookingChannel(channel) ? 3.5 : 3)
