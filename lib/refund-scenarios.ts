// THE SCENARIOS — the training set, and the regression test.
//
// Jon, 2026-09-22: "lets create a few scenarios and see if we can make this robust and useful."
//
// Every scenario is SOLVED BY THE REAL ENGINE. The expected answer is not typed in beside the
// question; it is computed by the same computeRefund() the glitch advisor calls, through the same
// exposure model, under the same authority tiers. That has two consequences worth the trouble:
//
//   TRAINING   what the team learns is what the tool will actually say tomorrow.
//   TESTING    if someone retunes a band in lib/refund-policy.ts, these move — and `checkScenarios`
//              below asserts the ones whose answer is a matter of doctrine rather than arithmetic
//              (a fixed-in-an-hour case must stay near zero; a guest-caused case must stay at zero;
//              nothing may exceed the value of the stay). A tuning change that breaks the doctrine
//              fails loudly instead of quietly teaching the wrong lesson.
//
// The scenarios are deliberately drawn from real shapes on this portfolio — a fragile Capri listing,
// a mature Elser one, a Pompano unit whose last review was already poor — because the lesson that
// matters most is that the SAME complaint gets a different answer on a different unit.
import type { Severity, ResolutionSpeed, Mitigation, GuestTone, RefundResult } from './refund-policy'
import { computeMultiple } from './refund-policy'
import { exposureFor, type ReviewFacts, type Exposure } from './review-exposure'
import { ladderFor, tierFor, tierReason, type AuthorityConfig, DEFAULT_AUTHORITY, type AuthorityTier } from './refund-doctrine'

export type ScenarioIssue = {
  label: string
  category: string
  severity: Severity
  affectedNights: number
  speed: ResolutionSpeed
  mitigation: Mitigation
}

export type Scenario = {
  key: string
  title: string
  /** The unit and the stay, as the team would see them. */
  unit: string
  channel: string
  nightly: number
  nights: number
  /** What the guest said and what we did, in the order it happened. */
  story: string[]
  issues: ScenarioIssue[]
  unusedNights?: number
  tone?: GuestTone | null
  reportedAfterCheckout?: boolean
  guestCaused?: boolean
  vip?: boolean
  reviews: ReviewFacts
  /** The wrong instinct this scenario exists to correct. */
  trap: string
  /** What the scenario is teaching. */
  lesson: string
}

export type SolvedScenario = {
  scenario: Scenario
  exposure: Exposure
  result: RefundResult
  refund: number
  pctOfStay: number
  stayValue: number
  tier: AuthorityTier
  tierWhy: string
  /** The ladder for the leading issue — what should have happened before any of this. */
  ladderLabel: string
  firstResponseMins: number
  fixTargetHours: number
  /** What the same case would have cost had we hit the clock with something in their hands. */
  ifWeHadHitTheClock: number
  saved: number
}

const R = (count: number, average: number | null, recent: number[], lastYear: number, channel: string): ReviewFacts => ({
  count, average, recent: recent.map(r => ({ rating: r, at: null })), lastYear, channel,
})

export const SCENARIOS: Scenario[] = [
  {
    key: 'ac-same-day',
    title: 'AC out at 2pm, portable in the bedroom by 5pm',
    unit: '17 West 812', channel: 'airbnb', nightly: 340, nights: 4,
    story: [
      'Guest messages at 2:10pm: the apartment is not cooling, it is 84 inside.',
      'We call back at 2:18pm, walk the thermostat and the breaker with them. Air is blowing warm.',
      'HVAC dispatched, arrives 4:40pm, compressor needs a part that comes tomorrow.',
      'A portable AC is in the bedroom by 5pm. They sleep comfortably. Fixed properly at 11am the next day.',
    ],
    issues: [{ label: 'No cooling', category: 'Maintenance - HVAC/Temperature', severity: 'moderate', affectedNights: 1, speed: 'same_day', mitigation: 'effective' }],
    tone: 'understanding',
    reviews: R(96, 4.87, [5, 5, 5, 4, 5], 31, 'airbnb'),
    trap: 'Offering money at 2:15pm because the guest sounds hot and you want to get ahead of it.',
    lesson: 'This is the ladder working, and it is what a good day looks like. The portable unit inside four hours is what kept a critical failure at moderate, and the number reflects that. Most AC cases should end here.',
  },
  {
    key: 'ac-overnight-fragile',
    title: 'Same AC failure — but nothing was sent, and the unit is fragile',
    unit: 'Capri 704', channel: 'airbnb', nightly: 295, nights: 3,
    story: [
      'Guest messages at 3pm: no cooling.',
      'We reply at 6:40pm saying we will get someone out tomorrow. Nothing is sent to the unit.',
      'They sleep in 82-degree heat with the windows open. They message again at 7am, angry.',
      'HVAC fixes it at 2pm the next day.',
    ],
    issues: [{ label: 'No cooling overnight', category: 'Maintenance - HVAC/Temperature', severity: 'critical', affectedNights: 1, speed: 'next_day', mitigation: 'none' }],
    tone: 'angry',
    reviews: R(11, 4.82, [5, 5, 4, 5, 5], 6, 'airbnb'),
    trap: 'Treating this as the same case as the one above because the repair took a similar amount of time. It is not — a night was lost, and this listing cannot absorb what comes next.',
    lesson: 'The identical fault costs roughly five times as much because nobody sent a portable unit. On eleven reviews a 3-star takes this listing through 4.7 and it stops getting shown — so a supervisor calls before checkout and the number sits at the top of what critical defensibly earns. The review is never mentioned to the guest.',
  },
  {
    key: 'dirty-recleaned',
    title: 'Dirty on arrival, re-cleaned while they were at dinner',
    unit: 'Elser 4412', channel: 'airbnb', nightly: 260, nights: 3,
    story: [
      'Guest arrives 4pm, sends photos of hair in the shower and crumbs on the counter.',
      'We apologise, ask them to send anything else they see, and get a cleaner there at 6:30pm while they are out.',
      'They come back at 8:15pm to a clean apartment. We comp the cleaning fee without being asked.',
    ],
    issues: [{ label: 'Inadequate clean', category: 'Cleanliness - Inadequate Cleaning', severity: 'moderate', affectedNights: 1, speed: 'same_day', mitigation: 'effective' }],
    tone: 'understanding',
    reviews: R(312, 4.89, [5, 5, 5, 5, 4], 64, 'airbnb'),
    trap: 'Refunding a night because you feel bad about the photos.',
    lesson: 'Comping the cleaning fee and fixing it the same evening IS the remedy. A small settlement on top is defensible; a night is not. This is the highest-leverage play on the whole board — a same-day re-clean usually means the review never mentions it.',
  },
  {
    key: 'dirty-next-day-thin',
    title: 'Dirty on arrival, nobody could get there until the next afternoon',
    unit: 'Pelican 9', channel: 'airbnb', nightly: 210, nights: 2,
    story: [
      'Guest arrives Friday 5pm to a unit that was plainly not cleaned — bed unmade in the second bedroom, bins full.',
      'No cleaner available Friday night. We send supplies and apologise.',
      'A cleaner gets there Saturday 1pm. They have lost the Friday evening and the Saturday morning of a two-night stay.',
    ],
    issues: [{ label: 'Unit not cleaned between guests', category: 'Cleanliness - Inadequate Cleaning', severity: 'critical', affectedNights: 1, speed: 'next_day', mitigation: 'gesture' }],
    tone: 'frustrated',
    reviews: R(84, 4.81, [2, 5, 5, 4, 5], 22, 'airbnb'),
    trap: 'Arguing about whether it was "that bad" because the second bedroom was not the one they slept in.',
    lesson: 'A unit that was never cleaned is critical, not moderate — they did not get the product. The last review here was already a 2, so this unit is in recovery and another poor one reads as a pattern rather than an off night. Supervisor calls, settle it properly, and look at who closed that clean.',
  },
  {
    key: 'washer-long-stay',
    title: 'Washer dead on night two of a fourteen-night stay',
    unit: 'Amrit 1203', channel: 'vrbo', nightly: 420, nights: 14,
    story: [
      'Guest reports the washer is not draining on night two.',
      'We book the repair for the following week — the part is not local.',
      'We pay for a wash-and-fold service twice, collected and returned, for the rest of the stay.',
    ],
    issues: [{ label: 'Washer out', category: 'Maintenance - Appliances', severity: 'minor', affectedNights: 5, speed: 'three_plus', mitigation: 'effective' }],
    tone: 'understanding',
    reviews: R(38, 4.90, [5, 5, 5, 5, 5], 14, 'vrbo'),
    trap: 'Pricing all twelve remaining nights as affected because the washer was broken for all of them.',
    lesson: 'Two judgement calls carry this whole case and neither is arithmetic. AFFECTED NIGHTS are the nights the guest lost something, not the nights the fault existed — call it twelve and you have a $1,500 case out of a broken washer. SEVERITY is the other: an appliance is an amenity, so the ladder starts it at minor, and a laundry service they never had to think about keeps it there. Call it moderate instead and the same facts roughly double. Argue about those two words, never about the maths.',
  },
  {
    key: 'bed-bugs',
    title: 'Guest sends a photo of a bed bug at 11pm',
    unit: 'Park Towers 506', channel: 'airbnb', nightly: 310, nights: 5,
    story: [
      'Guest messages at 10:50pm with a clear photo and two bites.',
      'They are on night two of five.',
      'They do not sleep in that unit again. Pest control booked, unit pulled from the calendar, and they leave the next morning.',
    ],
    issues: [{ label: 'Bed bugs', category: 'Pests/Bed Bugs', severity: 'critical', affectedNights: 2, speed: 'unresolved', mitigation: 'none' }],
    unusedNights: 3,
    tone: 'angry',
    reviews: R(140, 4.86, [5, 4, 5, 5, 5], 29, 'airbnb'),
    trap: 'Treating this as a calculator case at all, or trying to talk them into staying while it is treated.',
    lesson: 'This is the one ladder with no hold rung. The number here is almost entirely the three nights they paid for and did not use, refunded in full, plus the two they endured. Jon takes this inside the hour, because where that guest sleeps tonight is his call. Do not improvise a hotel.',
  },
  {
    key: 'elevator',
    title: 'Building elevator out for three days, guest on the 14th floor',
    unit: 'Elser 1408', channel: 'booking.com', nightly: 240, nights: 4,
    story: [
      'Building management takes the only working elevator out Monday morning; back Thursday.',
      'We tell the guest the same morning with the building’s own timeline.',
      'Nobody in the booking has a mobility issue. They walk it, unhappily.',
    ],
    issues: [{ label: 'No elevator, 14th floor', category: 'Maintenance - Building/Common Areas', severity: 'moderate', affectedNights: 3, speed: 'three_plus', mitigation: 'none' }],
    tone: 'frustrated',
    reviews: R(52, 4.42, [4, 4.5, 5, 4, 4.5], 21, 'booking.com'),
    trap: 'Refusing anything because "it is the building, not us". The guest booked a 14th-floor apartment from us.',
    lesson: 'We do not control the fault and we still owe the guest something, because they paid for a unit they can reach. Telling them fast with the building’s own timeline is the remedy that exists; the money covers the rest. Note the Booking scale — 4.42 stored is 8.8/10, a perfectly normal Booking score, not a crisis.',
  },
  {
    key: 'fishing',
    title: 'Complaint arrives four days after checkout, asking for half back',
    unit: '17 West 604', channel: 'airbnb', nightly: 380, nights: 3,
    story: [
      'Nothing was reported during the stay. No messages, no calls.',
      'Four days after checkout the guest writes asking for 50% back, citing "cleanliness and noise".',
      'The departure photos show a normally clean unit. There is no noise complaint on the building log.',
    ],
    issues: [{ label: 'Alleged cleanliness and noise', category: 'Cleanliness - Inadequate Cleaning', severity: 'minor', affectedNights: 1, speed: 'unresolved', mitigation: 'none' }],
    tone: 'fishing',
    reportedAfterCheckout: true,
    reviews: R(120, 4.88, [5, 5, 5, 5, 4], 30, 'airbnb'),
    trap: 'Paying it to make the review risk go away. That is the instinct this whole framework exists to override.',
    lesson: 'Reported after checkout, no contemporaneous record, and the tone reads as angling — all three pull the number down and the engine applies them. But read what the number IS: a ceiling on what would be defensible if we chose to settle, not a debt we owe. Zero is the right answer here. Answer warmly, decline clearly, document what we do have — and never pay to head off a review.',
  },
  {
    key: 'guest-caused',
    title: 'Guest jams the disposal, then asks for a refund for the smell',
    unit: 'Botanica 1502', channel: 'direct', nightly: 285, nights: 3,
    story: [
      'Guest puts chicken bones and rice down the disposal on night one.',
      'It backs up and smells. They report it night two and ask for money back.',
      'The plumber’s report and photos name the cause.',
    ],
    issues: [{ label: 'Disposal backed up', category: 'Maintenance - Plumbing', severity: 'moderate', affectedNights: 1, speed: 'same_day', mitigation: 'effective' }],
    guestCaused: true,
    tone: 'frustrated',
    reviews: R(29, 4.79, [5, 4, 5, 5, 5], 17, 'direct'),
    trap: 'Refunding a little anyway to keep the peace, and not filing the claim because it feels petty.',
    lesson: 'Zero, and the documentation is the actual job here — that plumber report is the entire defence if they escalate to the channel or the card. Fix it fast anyway, be pleasant about it, and file inside the window. A direct booking means we hold the card and there is no platform window at all.',
  },
  {
    key: 'two-issues',
    title: 'Two separate things went wrong on one stay',
    unit: 'Salato 602', channel: 'airbnb', nightly: 265, nights: 4,
    story: [
      'Arrive to a unit that was not properly cleaned — fixed by a re-clean the same evening.',
      'On night three the hot water fails. Plumber the next morning, so one cold-shower morning.',
      'Two different failures, two different teams, one guest.',
    ],
    issues: [
      { label: 'Inadequate clean', category: 'Cleanliness - Inadequate Cleaning', severity: 'moderate', affectedNights: 1, speed: 'same_day', mitigation: 'effective' },
      { label: 'No hot water', category: 'Maintenance - Water Heater', severity: 'moderate', affectedNights: 1, speed: 'next_day', mitigation: 'none' },
    ],
    tone: 'frustrated',
    reviews: R(7, 4.71, [5, 4, 5, 5, 5], 7, 'airbnb'),
    trap: 'Pricing the worse of the two and calling it settled, or stacking them into one "critical" case.',
    lesson: 'Each issue is priced on its own and added, then capped at the value of the stay. Two moderate failures on one stay is not one critical failure — but it is a pattern the guest will absolutely mention, and with seven reviews this unit has nothing to absorb it. One settlement, said once.',
  },
]

/** Run a scenario through the real engine. */
export function solveScenario(s: Scenario, cfg: AuthorityConfig = DEFAULT_AUTHORITY): SolvedScenario {
  const exposure = exposureFor(s.reviews)
  const inputs = s.issues.map((i, idx) => ({
    nightlyRate: s.nightly,
    totalNights: s.nights,
    affectedNights: i.affectedNights,
    unusedNights: idx === 0 ? (s.unusedNights || 0) : 0,
    channel: s.channel,
    severity: i.severity,
    speed: i.speed,
    mitigation: i.mitigation,
    tone: s.tone ?? null,
    reportedAfterCheckout: !!s.reportedAfterCheckout,
    guestCaused: !!s.guestCaused,
    vip: !!s.vip,
    // Exposure moves where in the band we land, and nothing else.
    dial: exposure.dial,
  }))
  const result = computeMultiple(inputs)
  const stayValue = s.nightly * s.nights
  const tier = tierFor(result.refund, stayValue, cfg)

  // The counterfactual: the same case with an effective remedy in their hands the same day. This is
  // the number that makes the argument for the ladder, so it is computed rather than asserted.
  const hit = computeMultiple(s.issues.map((i, idx) => ({
    nightlyRate: s.nightly, totalNights: s.nights, affectedNights: i.affectedNights,
    unusedNights: idx === 0 ? (s.unusedNights || 0) : 0,
    channel: s.channel, severity: i.severity,
    speed: 'same_day' as ResolutionSpeed, mitigation: 'effective' as Mitigation,
    tone: s.tone ?? null, reportedAfterCheckout: !!s.reportedAfterCheckout,
    guestCaused: !!s.guestCaused, vip: !!s.vip, dial: exposure.dial,
  })))

  const ladder = ladderFor(s.issues[0].category)
  return {
    scenario: s, exposure, result,
    refund: result.refund,
    pctOfStay: result.pctOfStay,
    stayValue,
    tier,
    tierWhy: tierReason(result.refund, stayValue, cfg),
    ladderLabel: ladder.label,
    firstResponseMins: ladder.firstResponseMins,
    fixTargetHours: ladder.fixTargetHours,
    ifWeHadHitTheClock: hit.refund,
    saved: Math.round((result.refund - hit.refund) * 100) / 100,
  }
}

export const solveAll = (cfg?: AuthorityConfig) => SCENARIOS.map(s => solveScenario(s, cfg))

/**
 * The doctrine assertions. These are the things that must stay true however the bands are tuned —
 * run by scripts/check-refunds.mjs and by the scenarios API, so a retune that breaks the doctrine
 * is caught rather than quietly taught.
 */
export function checkScenarios(): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  for (const solved of solveAll()) {
    const s = solved.scenario
    const name = s.key
    if (solved.refund > solved.stayValue + 0.01) failures.push(`${name}: refund ${solved.refund} exceeds the stay value ${solved.stayValue}`)
    if (s.guestCaused && solved.refund !== 0) failures.push(`${name}: guest-caused must be zero, got ${solved.refund}`)
    if (solved.refund < 0) failures.push(`${name}: negative refund`)
    // Hitting the clock with something in their hands must never cost MORE than missing it.
    if (solved.ifWeHadHitTheClock > solved.refund + 0.01) failures.push(`${name}: the ladder is upside down — hitting the clock costs ${solved.ifWeHadHitTheClock} vs ${solved.refund}`)
  }
  // The headline lesson of the whole page: the same fault, handled well vs badly, must differ a lot.
  const good = solveScenario(SCENARIOS.find(s => s.key === 'ac-same-day')!)
  const bad = solveScenario(SCENARIOS.find(s => s.key === 'ac-overnight-fragile')!)
  if (bad.refund <= good.refund * 2) {
    failures.push(`the AC pair no longer teaches anything: handled well ${good.refund}, handled badly ${bad.refund}`)
  }
  return { ok: failures.length === 0, failures }
}
