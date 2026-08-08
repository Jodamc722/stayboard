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
