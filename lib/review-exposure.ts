// WHAT A BAD REVIEW ON THIS UNIT WOULD ACTUALLY COST — the arithmetic, not the anxiety.
//
// Jon, 2026-09-22: "Airbnb reviews are extremely important, and we need to look at whether the last
// review is bad or good, or the average review score, or the total number of reviews. Maintaining a
// high average review score is extremely important, and negative reviews can really hurt us."
//
// All true, and all of it was being handled by a flat 10-15% bump on any Airbnb booking. That bump
// says a bad review costs the same on a unit with eleven reviews as on one with four hundred, which
// is not close to true. One review moves an average by (average - rating) / (n + 1):
//
//     Capri 704   ·  11 reviews at 4.82  ·  a 3-star drops it to 4.67   (-0.15, through TWO floors)
//     Elser 4412  ·  312 reviews at 4.89 ·  a 3-star drops it to 4.88   (-0.01, nothing moves)
//
// Same complaint, same night, same channel. The first one deserves a supervisor on the phone before
// checkout; the second one deserves the standard clock. That is the whole point of this file.
//
// WHAT IT CHANGES AND WHAT IT MUST NEVER CHANGE. Exposure moves two things: how FAST we move, and
// where inside the already-defensible band the number lands (the engine's `dial`, 0 = the mild end,
// 1 = the severe end). It can never push a refund ABOVE the band its severity earns — Jon's rule on
// 2026-09-22, and the right one. A fragile listing does not make a guest's loss bigger; it makes our
// urgency bigger and our generosity-within-reason larger.
//
// AND IT IS NEVER SAID TO THE GUEST. We do not buy reviews, mention reviews while money is on the
// table, or make anything conditional on one. Airbnb and Vrbo both call that review manipulation
// and the penalty is the listing itself. This number is an internal prioritisation signal and the
// UI says so wherever it appears.
//
// Client-safe: pure arithmetic, no database. The pull lives in lib/review-exposure-server.ts.
import { isBookingChannel, isLowReview } from './review-scale'

export type ExposureLevel = 'low' | 'raised' | 'high' | 'critical'

/**
 * A named line in the sand, on the stored 5-point scale.
 *
 * `hard` floors are the ones that cost us bookings — search placement and the score guests filter
 * against. `soft` floors are real but cosmetic or account-level: worth knowing, not worth waking
 * anyone. The distinction is what stops every unit hovering near 4.80 from reading as an emergency
 * and killing the signal.
 */
export type Floor = { at: number; label: string; why: string; hard: boolean }

// The floors that matter on Airbnb/Vrbo. 4.9 is this codebase's own five-star band
// (lib/review-scale); 4.8 is Superhost; below 4.7 a listing starts losing placement; 4.5 is where
// guests filter you out. Booking rates harder — 9/10 is its own "Superb" label — so its floors sit
// at the equivalent points of ITS working range, stored halved like every Booking rating.
const FLOORS_FIVE: Floor[] = [
  { at: 4.9, label: '4.9', why: 'the five-star band — where the listing reads as flawless', hard: false },
  { at: 4.8, label: '4.8', why: 'the Superhost line; it is the account average that is judged, so one listing slipping under only contributes', hard: false },
  { at: 4.7, label: '4.7', why: 'below this a listing starts losing search placement — this is the one that costs bookings', hard: true },
  { at: 4.5, label: '4.5', why: 'the score guests actively filter against', hard: true },
]
const FLOORS_BOOKING: Floor[] = [
  { at: 4.5, label: '9/10 (Superb)', why: "Booking's own Superb badge", hard: false },
  { at: 4.0, label: '8/10', why: 'below 8 a Booking listing reads as ordinary', hard: true },
  { at: 3.5, label: '7/10', why: 'below 7 is a complaint score on Booking', hard: true },
]

export const floorsFor = (channel?: any): Floor[] => (isBookingChannel(channel) ? FLOORS_BOOKING : FLOORS_FIVE)

/** Render a stored 5-scale number in the channel's own scale, for a floor label or an average. */
export const inScale = (v: number, channel?: any): string =>
  isBookingChannel(channel) ? (Math.round(v * 2 * 10) / 10).toFixed(1) + '/10' : (Math.round(v * 100) / 100).toFixed(2)

export type ReviewFacts = {
  /** Reviews counting toward the score on this channel for this listing. */
  count: number
  average: number | null
  /** Newest first, the ratings we hold — used for recency, not for the average. */
  recent: Array<{ rating: number; at: string | null }>
  /** How many landed in the last 12 months — a unit nobody reviews is exposed differently. */
  lastYear: number
  channel: string
  /** Portfolio-wide fallbacks, used when this unit alone is too thin to say anything. */
  portfolioAverage?: number | null
}

export type Hit = {
  /** The rating we are modelling — 3 for a disappointed guest, 1 for a furious one. */
  rating: number
  newAverage: number
  drop: number
  crosses: Floor[]
}

export type Exposure = {
  level: ExposureLevel
  channel: string
  count: number
  average: number | null
  /** What a disappointed review and a furious one would each do. */
  ifThree: Hit | null
  ifOne: Hit | null
  lastWasBad: boolean
  lastRating: number | null
  badInRecent: number
  thin: boolean
  /** Where in the band this pushes us. 0.5 is neutral; 1 is the top of the defensible band. */
  dial: number
  /** How fast this has to move, in words the team uses. */
  urgency: 'normal' | 'today' | 'same_day' | 'now'
  /** Plain sentences for the card. Written to be read out loud on a call with a supervisor. */
  lines: string[]
  /** One line for the top of the card. */
  headline: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** What one more review at `rating` does to an average of `average` over `count` reviews. */
export function hitOf(count: number, average: number, rating: number, channel?: any): Hit {
  const n = Math.max(0, Math.round(count))
  const newAverage = round2((average * n + rating) / (n + 1))
  const crosses = floorsFor(channel).filter(f => average >= f.at && newAverage < f.at)
  return { rating, newAverage, drop: round2(average - newAverage), crosses }
}

/**
 * Score the exposure. Pure, so the training page and the live glitch advisor produce the same
 * answer from the same facts, and so it can be tested without a database.
 */
export function exposureFor(f: ReviewFacts): Exposure {
  const channel = String(f.channel || '')
  const booking = isBookingChannel(channel)
  const count = Math.max(0, Math.round(Number(f.count) || 0))
  const average = Number.isFinite(Number(f.average)) && count > 0 ? Number(f.average) : null
  const recent = (f.recent || []).slice(0, 5)
  const lastRating = recent.length ? Number(recent[0].rating) : null
  const lastWasBad = lastRating != null && isLowReview(lastRating, channel)
  const badInRecent = recent.filter(r => isLowReview(r.rating, channel)).length
  // Two realistic bad outcomes, not one worst case. Modelling only a 1-star overstates the risk on
  // every unit, because a guest we fixed slowly writes a 3-star, not a 1-star. Stored ratings are
  // on the 5-point scale for every channel (Booking's /10 is halved at sync), so 3.0 and 1.0 read
  // as a 3-star and a 1-star on Airbnb and as a 6/10 and a 2/10 on Booking — the realistic
  // disappointed and furious marks on each.
  const disappointed = 3
  const furious = 1

  const ifThree = average != null ? hitOf(count, average, disappointed, channel) : null
  const ifOne = average != null ? hitOf(count, average, furious, channel) : null
  const thin = count > 0 && count < 20

  const lines: string[] = []
  let level: ExposureLevel = 'low'

  // A DIRECT BOOKING CANNOT PRODUCE A CHANNEL REVIEW. Borrowing the unit's Airbnb profile here
  // would invent a risk that does not exist on this stay and push the refund up for it — the exact
  // review anxiety this file was built to replace with arithmetic. They may leave a Google review
  // or never come back, which are real costs, but neither is the listing score.
  if (/^direct$/i.test(channel) || /be-?api|website|manual|owner/i.test(channel)) {
    return {
      level: 'low', channel, count, average, ifThree: null, ifOne: null, lastWasBad: false, lastRating: null,
      badInRecent: 0, thin: false, dial: 0.5, urgency: 'normal',
      lines: ['A direct booking does not produce a channel review, so there is no listing score at risk on this stay. Price it on what the guest actually lost. What is at risk is a repeat guest and a word-of-mouth referral, which is a reason to handle it well rather than a reason to pay more.'],
      headline: 'Direct booking — no listing score at risk',
    }
  }

  if (average == null || count === 0) {
    // A brand-new listing is the most exposed thing we own: its first review IS its score.
    level = count === 0 ? 'critical' : 'raised'
    lines.push(count === 0
      ? 'This unit has no reviews on this channel yet. The first one becomes the listing’s entire score, and a bad first review can sit at the top of the page for months.'
      : 'Not enough review history on this channel to model the damage — treat it as exposed rather than safe.')
    return {
      level, channel, count, average, ifThree, ifOne, lastWasBad, lastRating, badInRecent, thin: true,
      dial: level === 'critical' ? 1 : 0.7, urgency: level === 'critical' ? 'same_day' : 'today', lines,
      headline: count === 0 ? 'No reviews yet — the first one is the score' : 'Too little history to be safe',
    }
  }

  // The ladder, worst signal wins.
  const threeCrosses = ifThree?.crosses.length ? ifThree.crosses : []
  const oneCrosses = ifOne?.crosses.length ? ifOne.crosses : []
  const threeHard = threeCrosses.filter(c => c.hard)
  const oneHard = oneCrosses.filter(c => c.hard)

  let cause = ''

  // ALREADY UNDER THE FLOOR. Found on 2026-09-22 testing this against a live glitch: Botanica 2208
  // sits at 4.18 over 11 reviews, so it is beneath every hard floor and `crosses` is therefore
  // empty — the damage has already happened. Read naively that looks like SAFETY ("a bad review
  // breaks nothing") when it is the opposite: this is the worst-placed listing we own, it is the
  // one actively losing bookings, and on a thin review count it needs dozens of good stays to climb
  // back. A unit in that state gets the full treatment, not a shrug.
  // Which hard floors is it ALREADY under? Below the lowest is an emergency; below a higher one is
  // a listing that has already lost placement and is quietly costing us bookings every week.
  const hardFloors = floorsFor(channel).filter(x => x.hard)
  const lowestHard = hardFloors.length ? hardFloors[hardFloors.length - 1] : null
  const breached = hardFloors.filter(x => average < x.at)
  if (breached.length) {
    const worst = breached[breached.length - 1]
    const atRockBottom = !!lowestHard && average < lowestHard.at
    level = atRockBottom ? 'critical' : 'high'
    cause = `already below ${worst.label}`
    // Roughly how many clean five-star stays it takes to climb back over the floor it is under.
    const climb = Math.max(1, Math.ceil(((worst.at - average) * count) / Math.max(0.01, 5 - worst.at)))
    lines.push(`This listing is already at ${inScale(average, channel)}, under ${worst.label} — ${worst.why}. ${atRockBottom
      ? 'Nothing further "breaks" because it is already broken, and that is the emergency rather than the reassurance: it is losing bookings now.'
      : 'It has already slipped, so the job here is climbing back rather than holding a line.'} On ${count} review${count === 1 ? '' : 's'} it needs roughly ${climb} straight five-star stay${climb === 1 ? '' : 's'} to clear ${worst.label} again. Every stay here is a recovery stay.`)
  }

  if (count < 10) {
    level = 'critical'; cause = `only ${count} review${count === 1 ? '' : 's'} to absorb it`
    lines.push(`Only ${count} review${count === 1 ? '' : 's'} on this channel. Every single one moves the number by ${ifThree ? ifThree.drop.toFixed(2) : '—'} or more, so there is nothing here to absorb a bad night.`)
  }
  if (lastWasBad) {
    level = 'critical'; cause = 'the last review was already poor'
    lines.push(`The most recent review was already a ${inScale(Number(lastRating), channel)}. Two poor reviews in a row is what a guest scrolling the listing actually sees, and it reads as a pattern rather than an off night.`)
  }
  if (threeHard.length) {
    // A merely disappointed guest costs us search placement. This is the real emergency.
    level = 'critical'; cause = cause || `a 3-star breaks ${threeHard[0].label}`
    lines.push(`A merely disappointed review here — a ${booking ? '6/10' : '3-star'} — takes the average from ${inScale(average, channel)} to ${inScale(ifThree!.newAverage, channel)}, through ${threeHard.map(c => c.label).join(' and ')}: ${threeHard[0].why}.`)
  } else if (oneHard.length) {
    if (level === 'low') level = 'high'
    cause = cause || `a 1-star breaks ${oneHard[0].label}`
    lines.push(`A furious review — a ${booking ? '2/10' : '1-star'} — would take ${inScale(average, channel)} to ${inScale(ifOne!.newAverage, channel)} and break ${oneHard.map(c => c.label).join(' and ')}. A normal bad review would not, so this is about avoiding the worst case rather than the likely one.`)
  } else if (threeCrosses.length) {
    // Soft floors only — worth knowing, not worth an emergency.
    if (level === 'low') level = 'raised'
    cause = cause || `a 3-star slips under ${threeCrosses[0].label}`
    lines.push(`A ${booking ? '6/10' : '3-star'} would take ${inScale(average, channel)} to ${inScale(ifThree!.newAverage, channel)}, under ${threeCrosses.map(c => c.label).join(' and ')} — ${threeCrosses[0].why}. Placement is not at risk; the badge is.`)
  }
  if (thin && level === 'low') {
    level = 'high'; cause = cause || `${count} reviews is thin`
    lines.push(`${count} reviews is thin. One bad night moves this average by ${ifThree!.drop.toFixed(2)} — on a mature listing the same review would move it by a hundredth.`)
  }
  if (badInRecent >= 2) {
    level = 'critical'; cause = `${badInRecent} of the last ${recent.length} were poor`
    lines.push(`${badInRecent} of the last ${recent.length} reviews were poor. This unit is already in recovery and another one compounds.`)
  }

  if (level === 'low') {
    lines.push(`${count} reviews at ${inScale(average, channel)}. Even a ${booking ? '2/10' : '1-star'} only moves this to ${inScale(ifOne!.newAverage, channel)} and crosses nothing. Fix it on the normal clock and price it on its merits — the review is not the risk here.`)
  }
  if (f.lastYear === 0 && count > 0) {
    lines.push('No reviews on this unit in the last year, so whatever lands next will be the review guests read first.')
    if (level === 'low') level = 'raised'
  }

  const dial = level === 'critical' ? 1 : level === 'high' ? 0.8 : level === 'raised' ? 0.65 : 0.5
  const urgency = level === 'critical' ? 'same_day' : level === 'high' ? 'today' : 'normal'

  const at = `${count} reviews at ${inScale(average, channel)}`
  const headline = level === 'critical' ? `Fragile — ${at}, ${cause}`
    : level === 'high' ? `Exposed — ${at}, ${cause}`
    : level === 'raised' ? `Some exposure — ${at}${cause ? ', ' + cause : ''}`
    : `Resilient — ${at} absorbs this`

  return { level, channel, count, average, ifThree, ifOne, lastWasBad, lastRating, badInRecent, thin, dial, urgency, lines, headline }
}

/** What the team should DO about the exposure, separate from what it does to the money. */
export function exposureActions(e: Exposure): string[] {
  if (e.level === 'critical') return [
    'Fix it today. This one does not wait for the normal clock.',
    'A supervisor calls the guest before checkout — a voice fixes what a message cannot.',
    'Settle at the top of what the severity defensibly earns, and settle it before they leave.',
    'Never mention the review. Not as a hint, not as a favour, not as a reason.',
  ]
  if (e.level === 'high') return [
    'Fix it today rather than tomorrow.',
    'Call rather than message once it is fixed.',
    'Settle toward the upper end of the band for this severity.',
    'Never mention the review.',
  ]
  if (e.level === 'raised') return [
    'Keep it on the normal clock but do not let it slip.',
    'Confirm the fix with the guest in writing so the record exists.',
  ]
  return [
    'Normal clock. Price it on what the guest actually lost.',
    'This unit can absorb one bad night — do not overpay out of review anxiety.',
  ]
}
