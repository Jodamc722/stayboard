// THE LINES A PUBLIC SCORE IS JUDGED AGAINST, PER CHANNEL — and the arithmetic of how close a unit is.
//
// "Needs attention" on /reviews used to mean "below our own par in this window". That finds a unit
// that is under-performing; it does not find the unit sitting at 4.81 on 14 reviews, where ONE
// disappointed guest takes it under 4.8. This file answers the second question with plain division:
//
//     how many 3-star reviews until the average falls under the line it is standing on?
//     how many straight 5-star reviews until it clears the next line up?
//
// THE LINES. Badge programmes are the channels' own; each note says whether the channel judges the
// LISTING or the HOST ACCOUNT, because a unit can only be "at risk of losing Superhost" in the sense
// that it drags an account-level average. The channels change these — the notes say "about" where
// the channel does not publish an exact number, and the page links each score to the live listing so
// a person can check it. Stored scale throughout is 5-point (Booking.com halved at sync).
//
// Client-safe: no imports beyond the scale helpers.
import { isBookingChannel } from './review-scale'

export type ScoreLine = {
  key: string
  /** Stored 5-point value. */
  at: number
  /** How a person says it, in the channel's own scale. */
  label: string
  /** 'badge' = a programme you hold or lose; 'floor' = a line that costs placement or filtering. */
  kind: 'badge' | 'floor'
  scope: 'listing' | 'account'
  note: string
}

// Checked against the channels' published rules, 2026-11: Superhost 4.8 with a 90% response rate
// and under 1% cancellations; Guest Favorite has no published number (4.9 is "about"); Vrbo Premier
// Host 4.6 per listing; Booking.com Genius needs 7.5 with three or more reviews, Preferred 7.0.
// EACH LIST IS HIGHEST FIRST — standingOf() takes the first line the score is at or above.
const AIRBNB: ScoreLine[] = [
  { key: 'guest_favorite', at: 4.9, label: 'Guest Favorite ~4.9', kind: 'badge', scope: 'listing', note: 'Airbnb awards Guest Favorite per listing and publishes no number for it. About 4.9+ with at least five reviews, strong category scores and a clean reliability record is where listings hold it.' },
  { key: 'superhost', at: 4.8, label: 'Superhost 4.8', kind: 'badge', scope: 'account', note: 'Superhost is judged on the host account over the last 365 days: 4.8+ overall rating, 90%+ response rate, under 1% cancellations, and the stay-count test. One listing under 4.8 pulls the account average down; it does not lose the badge on its own.' },
  { key: 'placement', at: 4.7, label: '4.7', kind: 'floor', scope: 'listing', note: 'The house line: under 4.7 a listing starts losing search placement.' },
  { key: 'filter', at: 4.5, label: '4.5', kind: 'floor', scope: 'listing', note: 'The score guests filter against.' },
]
const VRBO: ScoreLine[] = [
  { key: 'premier_host', at: 4.6, label: 'Premier Host 4.6', kind: 'badge', scope: 'listing', note: 'Vrbo Premier Host (rules from 1 Jan 2026, judged per listing): 4.6+ average with 5+ reviews, 99%+ acceptance, no owner-initiated cancellations, 5+ bookings or 60 nights. Reviewed 1 Feb / 1 May / 1 Aug / 1 Nov.' },
  { key: 'vrbo_wonderful', at: 4.5, label: '4.5', kind: 'floor', scope: 'listing', note: 'Vrbo shows the score out of 10; 4.5 stars is the 9/10 band guests filter for.' },
]
const BOOKING: ScoreLine[] = [
  { key: 'booking_superb', at: 4.5, label: '9.0 Superb', kind: 'badge', scope: 'listing', note: 'Booking.com labels 9.0+ "Superb" on the property page.' },
  { key: 'booking_8', at: 4.0, label: '8.0', kind: 'floor', scope: 'listing', note: 'Under 8.0 a Booking.com listing reads as ordinary.' },
  { key: 'booking_genius', at: 3.75, label: 'Genius 7.5', kind: 'badge', scope: 'listing', note: 'Booking.com Genius needs a review score of 7.5 or higher with at least three reviews. Under it the property drops out of the Genius programme and its visibility.' },
  { key: 'booking_7', at: 3.5, label: 'Preferred 7.0', kind: 'floor', scope: 'listing', note: 'Booking.com Preferred Partner needs 7.0 or higher; under 7.0 is also a complaint score on Booking.com.' },
]

// HOW LONG A REVIEW CAN STILL BE ACTED ON, counted from CHECKOUT (2026-11): Airbnb closes reviews
// for both sides 14 days after checkout; Vrbo's window is 180 days. Booking.com publishes no such
// clock here, so it has none. Used for the "closes in Nd" tag on the reply queue.
export function reviewWindowDays(channel?: any): number | null {
  const c = String(channel || '').toLowerCase()
  if (/airbnb/.test(c)) return 14
  if (/vrbo|homeaway/.test(c)) return 180
  return null
}

/** Highest first. Channels with no known lines return an empty list — nothing is invented for them. */
export function linesFor(channel?: any): ScoreLine[] {
  const c = String(channel || '').toLowerCase()
  if (isBookingChannel(c)) return BOOKING
  if (/airbnb/.test(c)) return AIRBNB
  if (/vrbo|homeaway/.test(c)) return VRBO
  return []
}

/** A stored 5-point number in the channel's own scale: 4.31 on Booking.com reads 8.6. */
export function inChannelScale(v: number, channel?: any): number {
  return isBookingChannel(channel) ? Math.round(v * 2 * 10) / 10 : Math.round(v * 100) / 100
}

export type Standing = {
  channel: string
  n: number
  avg: number
  /** The line the score is standing on (highest line at or under it), or null when under them all. */
  holds: ScoreLine | null
  /** avg − holds.at. */
  margin: number | null
  /** 3-star reviews (6/10 on Booking.com) it can take before falling under `holds`. 1 = the next one does it. */
  lowsToDrop: number | null
  /** What one 3-star review makes the average. */
  afterOneLow: number
  /** The next line up, or null at the top. */
  next: ScoreLine | null
  /** Straight 5-star reviews needed to reach `next`. */
  fivesToNext: number | null
}

const LOW = 3

/** Where a score stands against its channel's lines. Null when the channel has none or n is 0. */
export function standingOf(avg: number, n: number, channel: string): Standing | null {
  const lines = linesFor(channel)
  if (!lines.length || !(n > 0) || !Number.isFinite(avg)) return null
  const sum = avg * n
  const holds = lines.find(l => avg >= l.at) || null
  const above = lines.filter(l => avg < l.at)
  const next = above.length ? above[above.length - 1] : null
  let lowsToDrop: number | null = null
  if (holds && holds.at > LOW) lowsToDrop = Math.max(1, Math.floor((sum - holds.at * n) / (holds.at - LOW)) + 1)
  let fivesToNext: number | null = null
  if (next && next.at < 5) fivesToNext = Math.max(1, Math.ceil((next.at * n - sum) / (5 - next.at)))
  return {
    channel, n, avg,
    holds, margin: holds ? Math.round((avg - holds.at) * 100) / 100 : null,
    lowsToDrop,
    afterOneLow: Math.round(((sum + LOW) / (n + 1)) * 100) / 100,
    next, fivesToNext,
  }
}

export type RiskRow = {
  kind: 'hold' | 'climb'
  /** Bigger = look at it sooner. */
  weight: number
  /** One sentence, in the channel's own scale. */
  reason: string
  line: string
}

/**
 * Is this standing worth a row on the "at risk" list?
 *   hold  — the next disappointed guest takes it under a line it holds today.
 *   climb — it sits just under a line and a handful of five-star stays clear it.
 * `last5` is the average of the newest five reviews on the live listing (stored scale), when known:
 * a recent run well under the lifetime score is what turns "close" into "about to".
 */
export function riskOf(s: Standing, last5: number | null): RiskRow | null {
  const booking = isBookingChannel(s.channel)
  const lowWord = booking ? '6/10' : '3-star'
  const fiveWord = booking ? '10/10' : 'five-star'
  const show = (v: number) => String(inChannelScale(v, s.channel)) + (booking ? '/10' : '')
  const sliding = last5 != null && last5 < s.avg - 0.25
  if (s.holds && s.lowsToDrop != null && s.lowsToDrop <= 2) {
    const base = s.holds.kind === 'floor' ? 100 : (s.holds.scope === 'listing' ? 85 : 70)
    const weight = base - (s.lowsToDrop - 1) * 25 - Math.min(20, (s.margin || 0) * 100) + (sliding ? 15 : 0)
    return {
      kind: 'hold', weight, line: s.holds.label,
      reason: (s.lowsToDrop === 1 ? 'One ' + lowWord + ' review' : 'Two ' + lowWord + ' reviews') + ' takes it under ' + s.holds.label
        + ' (' + show(s.avg) + ' → ' + show(s.afterOneLow) + ' after one, on ' + s.n + ' review' + (s.n === 1 ? '' : 's') + ')'
        + (sliding && last5 != null ? ' · last five average ' + show(last5) : ''),
    }
  }
  if (s.next && s.fivesToNext != null && s.fivesToNext <= 6) {
    const base = s.next.kind === 'floor' ? 75 : (s.next.scope === 'listing' ? 60 : 50)
    return {
      kind: 'climb', weight: base - s.fivesToNext * 5 + (sliding ? 10 : 0), line: s.next.label,
      reason: s.fivesToNext + ' straight ' + fiveWord + ' review' + (s.fivesToNext === 1 ? '' : 's') + ' clears ' + s.next.label
        + ' (now ' + show(s.avg) + ' on ' + s.n + ')'
        + (sliding && last5 != null ? ' · last five average ' + show(last5) : ''),
    }
  }
  return null
}
