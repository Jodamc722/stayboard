// THE REFUND DOCTRINE — how Stay Hospitality decides, in order.
//
// Jon, 2026-09-22: "The goal is never a refund. The goal is to remediate or solve the issue quickly
// and promptly, but if that's not enough, then the refund is a tool to ensure a positive guest
// experience."
//
// That sentence is the whole design. lib/refund-policy.ts already prices a refund well; what it
// never did was argue against one. A calculator that answers "how much?" the moment a guest
// complains teaches a team that money is the first move, because money is the only move it knows.
// So the money now sits at the BOTTOM of a ladder, and three rungs come before it:
//
//   1. FIX IT      Every category has a clock — a first response and a fix target. Hit the clock
//                  and most cases never reach a refund at all, which is the point.
//   2. HOLD THEM   What goes in their hands while the fix happens: hardware on site, or a comped
//                  service. A portable AC inside four hours is worth more than $200 the next day,
//                  and the framework prices it that way (mitigation 'effective' cuts the base by
//                  25-40%).
//   3. THE MONEY   Only when the clock was blown, the fix was impossible, or the stay was already
//                  damaged by the time we got there.
//   4. WHO SIGNS   Every amount has an owner. Nobody sits on a decision waiting for permission that
//                  their own tier already gives them.
//
// WHY THE LADDER IS ALSO CHEAPER, arithmetically and not just morally. Take a moderate AC failure
// on a $320 night. Fixed same day with a portable unit dropped off: 25% base, x0.75 speed, x0.68
// mitigation = about 13% of one night, $41. The same failure left overnight with an apology:
// 40% x 1.0 x 0.95 = 38%, $122, and now you are also carrying the review. The ladder is not a
// nicer way to lose money; hitting the clock is worth roughly three times the refund it avoids.
//
// NOTHING HERE OVERRIDES THE ENGINE. The bands, multipliers and caps all still live in
// lib/refund-policy.ts and every number this file shows is COMPUTED from it (see buildMatrix
// below) rather than typed out beside it. A printed matrix that drifts from the live recommendation
// is worse than no matrix, because the team trusts the paper and the tool quietly disagrees.
import type { Severity, ResolutionSpeed, Mitigation } from './refund-policy'
import { computeRefund, BASE, SPEED, MITIGATION } from './refund-policy'

// ── WHO SIGNS ───────────────────────────────────────────────────────────────────────────────────
// Jon, 2026-09-22, chose dollar tiers over percentage tiers: a number you can hold in your head at
// 9pm beats one you have to work out. The percentage ceiling rides along on the top tier only, so a
// $180 refund on a $600 stay — 30%, which is a lot of the stay — still reaches him.
export type AuthorityTier = {
  key: 'front' | 'supervisor' | 'owner'
  who: string
  ceiling: number
  /** Percentage-of-stay ceiling, where one applies. */
  pctCeiling?: number
  rule: string
  then: string
}

export const AUTHORITY: AuthorityTier[] = [
  {
    key: 'front', who: 'Front line (CS, guest comms, whoever is on the phone)', ceiling: 150,
    rule: 'Up to $150 — decide it and log it. No approval, no waiting.',
    then: 'Log it on the glitch with what happened and why. That log is the approval.',
  },
  {
    key: 'supervisor', who: 'Supervisor / market lead', ceiling: 500,
    rule: '$150.01 to $500 — your call, and tell Jon after.',
    then: 'Log it, then drop a line in the market channel the same day. He is not approving it; he is not finding out from a statement.',
  },
  {
    key: 'owner', who: 'Jon', ceiling: Infinity, pctCeiling: 40,
    rule: 'Over $500, or a big share of the stay, or any full-stay refund — Jon.',
    then: 'Put the recommendation and the facts in front of him. Do not promise the guest a number before he has seen it.',
  },
]

/**
 * The four numbers, in one place and editable without a deploy (app_settings.refund_authority).
 *
 * WHY THE PROPORTION RIDER IS 40 AND NOT 25. Jon picked dollar tiers on 2026-09-22 with a
 * "> 25% of the stay" rider, and the first run of the arithmetic showed why that number cannot
 * stand on its own: 25% of a $600 two-night booking is $150, which IS the front-line ceiling. The
 * rider therefore fired on essentially every supervisor-sized refund on a normal Capri or Pelican
 * stay, the supervisor tier disappeared below a $2,000 booking, and Jon would have been signing off
 * $160 decisions. At 40% the rider catches what it was meant to catch — a stay that substantially
 * failed — and leaves the ordinary cases with the people who are already on the phone. It is a
 * setting, not a law: put it back to 25 on the page if the live cases say otherwise.
 */
export type AuthorityConfig = {
  /** Front line decides up to this, no approval. */
  front: number
  /** Supervisor decides up to this, tells Jon after. */
  supervisor: number
  /** Above this share of the stay, the decision moves up ONE tier. */
  pctRider: number
  /** At or above this share of the stay, it is Jon's whatever the dollars. */
  fullStay: number
}

export const DEFAULT_AUTHORITY: AuthorityConfig = { front: 150, supervisor: 500, pctRider: 40, fullStay: 90 }

export function normAuthority(v: any): AuthorityConfig {
  const n = (x: any, fb: number, lo: number, hi: number) => {
    const num = Number(x)
    return Number.isFinite(num) ? Math.min(hi, Math.max(lo, Math.round(num))) : fb
  }
  const o = v && typeof v === 'object' ? v : {}
  const front = n(o.front, DEFAULT_AUTHORITY.front, 0, 100000)
  return {
    front,
    // A supervisor ceiling below the front line's would silently invert the ladder.
    supervisor: Math.max(front, n(o.supervisor, DEFAULT_AUTHORITY.supervisor, 0, 1000000)),
    pctRider: n(o.pctRider, DEFAULT_AUTHORITY.pctRider, 1, 100),
    fullStay: n(o.fullStay, DEFAULT_AUTHORITY.fullStay, 1, 100),
  }
}

/** The tiers with live ceilings written in, for display. */
export function authorityTiers(cfg: AuthorityConfig = DEFAULT_AUTHORITY): AuthorityTier[] {
  const money = (n: number) => '$' + n.toLocaleString('en-US')
  return [
    { ...AUTHORITY[0], ceiling: cfg.front, rule: `Up to ${money(cfg.front)} — decide it and log it. No approval, no waiting.` },
    { ...AUTHORITY[1], ceiling: cfg.supervisor, rule: `${money(cfg.front)} to ${money(cfg.supervisor)} — your call, and tell Jon after.` },
    { ...AUTHORITY[2], pctCeiling: cfg.pctRider, rule: `Over ${money(cfg.supervisor)}, over ${cfg.pctRider}% of the stay, or anything close to a full-stay refund — Jon.` },
  ]
}

export function tierFor(amount: number, stayValue?: number | null, cfg: AuthorityConfig = DEFAULT_AUTHORITY): AuthorityTier {
  const tiers = authorityTiers(cfg)
  const a = Math.max(0, Number(amount) || 0)
  const sv = Number(stayValue) || 0
  const pct = sv > 0 ? (a / sv) * 100 : 0

  // The dollar tier is the spine.
  let idx = a <= cfg.front ? 0 : a <= cfg.supervisor ? 1 : 2
  // The proportion rider escalates ONE step — see the note above for why it is not a jump to Jon.
  if (pct > cfg.pctRider && idx < 2) idx += 1
  // Refunding essentially the whole stay is a different kind of decision at any size.
  if (sv > 0 && pct >= cfg.fullStay) idx = 2

  return tiers[idx]
}

/** Why this tier, in one line — so the UI can say it rather than just showing a name. */
export function tierReason(amount: number, stayValue?: number | null, cfg: AuthorityConfig = DEFAULT_AUTHORITY): string {
  const a = Math.max(0, Number(amount) || 0)
  const sv = Number(stayValue) || 0
  const pct = sv > 0 ? Math.round((a / sv) * 100) : 0
  const t = tierFor(a, sv, cfg)
  if (sv > 0 && pct >= cfg.fullStay) return `That is ${pct}% of the stay — effectively refunding the booking, which is Jon's call at any size.`
  if (sv > 0 && pct > cfg.pctRider && t.key !== 'front') return `$${a.toFixed(2)} is ${pct}% of a $${sv.toFixed(0)} stay. Over ${cfg.pctRider}% of the booking moves it up a level.`
  return t.rule
}

// ── WHAT WE HAND THEM BEFORE MONEY ──────────────────────────────────────────────────────────────
// Jon picked three of these on 2026-09-22 and deliberately left relocation out: moving a guest or
// buying a hotel night is not a standard rung here, it is an exception he signs off. The pest and
// safety ladders below say so explicitly, because those are the two cases where staying put is not
// a real option and the team must not improvise.
export type RemedyRung = { key: string; label: string; what: string; worth: string; mitigation: Mitigation }

export const REMEDIES: RemedyRung[] = [
  {
    key: 'hardware', label: 'Hardware on site, fast',
    what: 'Portable AC, space heater, fans, air purifier, a loaner appliance — in their hands, not ordered.',
    worth: 'Counts as an EFFECTIVE workaround only if it actually solves the problem. A fan when the AC is out in July is a gesture and the framework prices it as one.',
    mitigation: 'effective',
  },
  {
    key: 'service', label: 'Comped service',
    what: 'Re-clean, restock, extra linens, late checkout, early check-in, comped parking, comped cleaning fee.',
    worth: 'A same-day re-clean is the single highest-value move we own: it turns a cleanliness complaint back into a normal stay, and the guest usually never mentions it in the review.',
    mitigation: 'effective',
  },
  {
    key: 'credit', label: 'Credit toward a future stay',
    what: 'A dollar credit against a direct rebooking, honoured for 12 months.',
    worth: 'Cheaper than cash — it only costs us if they come back, and a guest who comes back was never really lost. Offer it ALONGSIDE a small refund, never instead of one the guest is plainly owed.',
    mitigation: 'partial',
  },
]

// ── THE CLOCK, PER CATEGORY ─────────────────────────────────────────────────────────────────────
// The categories are the eleven on the glitch sheet, verbatim, so a ladder can be looked up from a
// real glitch row without a mapping table nobody maintains.
//
// `firstResponseMins` is when the guest hears a human. `fixTargetHours` is when it is actually put
// right. Blow the second one and the refund band opens — that is the mechanism, and it is the only
// thing on this page the team cannot argue with, because the engine reads the same clock.
export type Ladder = {
  category: string
  label: string
  /** Where this normally lands before anything we do. The ladder is what moves it. */
  baseline: Severity
  firstResponseMins: number
  fixTargetHours: number
  /** Why this clock and not a rounder number. */
  clockWhy: string
  fix: string[]
  hold: string[]
  /** The line that decides critical. Written so a person can answer it yes or no at 10pm. */
  criticalWhen: string
  /** Set where staying in the unit is not an option — these never get improvised. */
  escalate?: string
}

export const LADDERS: Ladder[] = [
  {
    category: 'Maintenance - HVAC/Temperature', label: 'Temperature / AC',
    baseline: 'moderate', firstResponseMins: 15, fixTargetHours: 4,
    clockWhy: 'South Florida. An apartment with no cooling is uncomfortable within an hour and unsleepable by night — the four-hour target is set so a mid-afternoon report is solved before bedtime, which is the only deadline that matters.',
    fix: [
      'Call, do not message. Walk the thermostat with them: mode on COOL, setpoint, fan on AUTO not ON, and check the breaker.',
      'If the air is blowing but warm, or not blowing at all, dispatch HVAC now — do not wait for a second confirmation.',
      'Elser / 17 West / Amrit: check whether the building chiller is down before blaming the unit. Building-wide is a different conversation and a different ladder.',
    ],
    hold: [
      'Portable AC in the bedroom within four hours. That is the move that keeps this out of critical, because it makes the night survivable.',
      'Fans only if a portable is genuinely not available, and say so honestly — a fan is a gesture, not a fix.',
    ],
    criticalWhen: 'They sleep a night with no working cooling and no portable unit in the bedroom.',
  },
  {
    category: 'Maintenance - Water Heater', label: 'Hot water',
    baseline: 'moderate', firstResponseMins: 15, fixTargetHours: 6,
    clockWhy: 'Nothing we can hand a guest substitutes for hot water, so the hold rung is nearly empty and the whole weight sits on the fix. Six hours covers a plumber call-out inside a working day.',
    fix: [
      'Check the breaker and the water-heater reset button first — it is the cause often enough to be worth the two minutes before a call-out.',
      'Confirm it is the unit and not the building. On the older buildings a building-wide outage has its own timeline and the guest needs to hear that timeline, not ours.',
      'Plumber same day. No hot water overnight is a different case entirely.',
    ],
    hold: [
      'There is no hardware fix here. Be straight with them about the timeline and check back when you said you would — the check-back is the remedy.',
      'If it runs past one night, this is a Jon call about alternatives.',
    ],
    criticalWhen: 'No hot water at all for a full day, or across a night into a second morning.',
  },
  {
    category: 'Cleanliness - Inadequate Cleaning', label: 'Cleanliness',
    baseline: 'moderate', firstResponseMins: 15, fixTargetHours: 3,
    clockWhy: 'A re-clean is fast, cheap and completely fixes the problem, which makes three hours realistic and makes missing it inexcusable. This is the category where the ladder earns its keep most often.',
    fix: [
      'Ask for photos, always — not to doubt them, but because the photos decide severity and they are the only record that survives to the claim or the review reply.',
      'Get a cleaner back in today. A same-day re-clean is the highest-value thing we own on this board.',
      'If they are still out, aim for while they are out. Coming back to a fixed unit lands differently than watching someone fix it.',
    ],
    hold: [
      'If nobody can get there today, send supplies and be specific about when a person arrives.',
      'Comp the cleaning fee when the clean was genuinely bad. It is small money and it is the cleanest possible admission.',
    ],
    criticalWhen: 'Biohazard — someone else’s bodily fluids, mould, or a unit that was plainly never cleaned between guests.',
  },
  {
    category: 'Maintenance - Plumbing', label: 'Plumbing',
    baseline: 'moderate', firstResponseMins: 10, fixTargetHours: 4,
    clockWhy: 'A leak damages the owner’s asset every hour it runs, so this clock protects the unit as much as the stay.',
    fix: [
      'Active leak: shut the supply first, then dispatch. Photograph before anyone mops.',
      'Backup or overflow in the only bathroom is not a maintenance ticket, it is an emergency — plumber now.',
      'A slow drain or a running toilet is a normal same-day fix; do not treat it as a crisis and do not leave it either.',
    ],
    hold: ['In a two-bathroom unit, one working bathroom keeps this out of critical. In a one-bathroom unit there is no hold rung and the clock is the only thing keeping it survivable.'],
    criticalWhen: 'The only bathroom is unusable, or sewage entered the living space.',
  },
  {
    category: 'Maintenance - Appliances', label: 'Appliance',
    baseline: 'minor', firstResponseMins: 60, fixTargetHours: 24,
    clockWhy: 'An appliance is an amenity, not the stay. A day is fair — unless it is the fridge, which is food and money.',
    fix: [
      'Fridge or freezer down is not an appliance case, it is same-day: they are losing groceries by the hour.',
      'Washer, dryer, dishwasher, microwave: next-day repair or swap is a fine answer, said plainly.',
      'Check it is not user error before a call-out. Walk it with them on the phone rather than assuming either way.',
    ],
    hold: [
      'Fridge: a cooler and ice today, and reimburse spoiled groceries on a receipt.',
      'Washer or dryer on a long stay: pay for a wash-and-fold run. It is about $40 and it closes the complaint.',
    ],
    criticalWhen: 'Fridge or freezer out for a day on a stay with a stocked kitchen, or the only cooking appliance in a stay booked for cooking.',
  },
  {
    category: 'Maintenance - Electrical', label: 'Electrical',
    baseline: 'moderate', firstResponseMins: 10, fixTargetHours: 4,
    clockWhy: 'Electrical splits hard between trivial and dangerous, and the first response is what tells you which one you have.',
    fix: [
      'Walk the breaker panel with them — a tripped breaker is the answer often enough to try it first.',
      'Anything burning, sparking, or warm at the outlet: tell them to stop using it, and treat it as safety, not maintenance.',
      'A dead outlet or a bulb is a real fix but a small one. Say so without dismissing it.',
    ],
    hold: ['Extension leads from a working circuit buy time for a dead outlet. They do not buy time for anything that smells hot.'],
    criticalWhen: 'No power to the unit or to a room they need, or anything that reads as a fire risk.',
    escalate: 'Burning smell, sparking, or scorched outlet: the guest stops using it, an electrician goes today, and Jon hears about it tonight. Do not let this sit in a queue.',
  },
  {
    category: 'Pests/Bed Bugs', label: 'Pests',
    baseline: 'critical', firstResponseMins: 10, fixTargetHours: 2,
    clockWhy: 'Two hours is a decision clock, not a repair clock. Nothing about pests is fixed in two hours; what has to happen in two hours is a person deciding what happens to that guest tonight.',
    fix: [
      'Bed bugs: the guest does not sleep there again. Full stop. Photograph, pull the unit from the calendar, get pest control booked, and treat every bag they own as exposed.',
      'Roaches or ants: same-day treatment and a deep clean. Sustained and visible is a different severity from one sighting.',
      'Never argue with a guest about whether they saw what they saw. Take the report, look at the photo, act.',
    ],
    hold: ['There is no hold rung for bed bugs. Anything we hand them while they are still in that bed makes this worse, not better.'],
    criticalWhen: 'Bed bugs, always. Any infestation that keeps recurring during the stay.',
    escalate: 'Bed bugs are a Jon call inside the hour — where the guest sleeps tonight is his decision, not the front line’s, and it is one of the few places we will move a guest or buy a room.',
  },
  {
    category: 'Maintenance - Building/Common Areas', label: 'Building / common areas',
    baseline: 'minor', firstResponseMins: 30, fixTargetHours: 24,
    clockWhy: 'We do not control the building, so the clock is on our COMMUNICATION rather than the repair. What we owe is a real timeline, fast.',
    fix: [
      'Get the actual timeline from building management and pass it on with the building’s name on it. "The building says Thursday" is trusted; "soon" is not.',
      'Elevator out in a tower: check whether anyone in the booking cannot manage stairs before deciding how bad this is.',
      'Pool, gym or amenity closed: if it was in the listing, it is something they paid for.',
    ],
    hold: ['Point them at the nearest working alternative and cover it where it is cheap — a day pass, a nearby garage.'],
    criticalWhen: 'The unit is genuinely unreachable — elevator out with a guest who cannot do stairs, or building access is down.',
  },
  {
    category: 'Safety/Security Concern', label: 'Safety / security',
    baseline: 'critical', firstResponseMins: 5, fixTargetHours: 2,
    clockWhy: 'Five minutes. Someone who does not feel safe where they are sleeping is the one case with no acceptable queue.',
    fix: [
      'Door, lock or window not securing: a locksmith or a code change today, and stay on the phone until they are secure.',
      'Smoke or CO alarm chirping or dead: replace today, no exceptions — this is a legal exposure as much as a guest one.',
      'If there is a person involved rather than a thing, the answer may be police and Jon, not maintenance.',
    ],
    hold: ['Nothing buys time here. Either they are secure tonight or we are having a different conversation.'],
    criticalWhen: 'Always treat as critical until proven otherwise.',
    escalate: 'Jon now, whatever the hour. This is the one ladder where waking him is correct.',
  },
  {
    category: 'Parking/Vehicle', label: 'Parking',
    baseline: 'minor', firstResponseMins: 30, fixTargetHours: 4,
    clockWhy: 'A guest circling a block with luggage in the car needs an answer in minutes, not a repair in days.',
    fix: [
      'Confirm what they actually booked — the listing, the fee, the garage instructions. Half of these are an instruction problem, not a parking problem.',
      'Fob or code not working: reissue today.',
      'Spot taken or garage full: find them a garage and tell them exactly where it is.',
    ],
    hold: ['Pay the nearby garage for the nights affected. It is the cheapest complete fix on this board.'],
    criticalWhen: 'Almost never. A guest who paid for parking and genuinely cannot park has a moderate case, not a critical one.',
  },
  {
    category: 'Other', label: 'Something else',
    baseline: 'minor', firstResponseMins: 30, fixTargetHours: 24,
    clockWhy: 'A default clock for the things the eleven categories do not cover. If a case keeps landing here, it wants its own ladder.',
    fix: ['Work out what they actually lost — that is what severity means and it is what the refund is priced against.', 'If it maps onto another ladder, use that ladder.'],
    hold: ['Whatever puts the thing they lost back in their hands.'],
    criticalWhen: 'The unit is unfit or unsafe to stay in.',
  },
]

export function ladderFor(category: any): Ladder {
  const c = String(category || '').trim().toLowerCase()
  for (const l of LADDERS) if (l.category.toLowerCase() === c) return l
  // Tolerate the short labels and free text — a glitch typed in by hand still gets a ladder.
  if (/hvac|temp|\bac\b|air con|heat|cool/.test(c)) return LADDERS[0]
  if (/water heater|hot water/.test(c)) return LADDERS[1]
  if (/clean/.test(c)) return LADDERS[2]
  if (/plumb|leak|toilet|drain|sewage/.test(c)) return LADDERS[3]
  if (/applian|fridge|washer|dryer|dishwasher|oven/.test(c)) return LADDERS[4]
  if (/electric|power|outlet|breaker/.test(c)) return LADDERS[5]
  if (/pest|bug|roach|ant|rodent/.test(c)) return LADDERS[6]
  if (/building|common|elevator|pool|gym/.test(c)) return LADDERS[7]
  if (/safety|secur|lock|alarm/.test(c)) return LADDERS[8]
  if (/park|vehicle|garage/.test(c)) return LADDERS[9]
  return LADDERS[LADDERS.length - 1]
}

// ── THE RULES THAT ARE NOT NEGOTIABLE ───────────────────────────────────────────────────────────
export type DoctrineRule = { key: string; rule: string; why: string }

export const RULES: DoctrineRule[] = [
  {
    key: 'fix-first', rule: 'Fix it before you price it.',
    why: 'A refund offered before the fix teaches the guest that money is what we do instead of solving things, and it costs about three times what hitting the clock costs. Nobody on this team opens with a number.',
  },
  {
    key: 'never-buy-review', rule: 'We never buy a review. Not ever, in any wording.',
    why: 'No refund is conditional on a review, no refund is offered in exchange for changing or removing one, and we do not mention reviews to a guest while money is on the table. Airbnb and Vrbo both treat that as review manipulation and the penalty is the listing, not a warning. Review exposure changes how FAST we move and where in a defensible band we land — it never becomes a thing we say to the guest.',
  },
  {
    key: 'ceiling-not-debt', rule: 'The number is a ceiling on what is defensible, not a debt we owe.',
    why: 'The engine answers "how much could we justify here?" — never "how much must we pay?". On a case we fixed inside the clock, or one that does not hold up, the right settlement is often well under the number and sometimes zero. Read it as the top of the range and then decide.',
  },
  {
    key: 'zero-is-an-answer', rule: 'Zero is a real answer, and it gets logged like any other.',
    why: 'When we fixed it inside the clock and they were made whole, no refund is correct. Log the decline with the reason so the question stops coming back and so the board shows what good looks like.',
  },
  {
    key: 'guest-caused', rule: 'If the guest caused it, there is no refund — and the documentation is the job.',
    why: 'That record is the entire defence if they escalate through the channel or the card. Photograph it, write it down the same day, file the claim inside the channel window.',
  },
  {
    key: 'no-number-first', rule: 'Never put a number in front of a guest before the person who can sign it has.',
    why: 'A number you take back is worse than a number you were slow to give. Say what we are doing about the problem; say the money once it is yours to say.',
  },
  {
    key: 'one-pass', rule: 'Settle it once.',
    why: 'Piecemeal goodwill — $50 now, $75 tomorrow, a credit on Friday — reads as haggling and invites more. Work out the whole number, say it once, and stand on it.',
  },
  {
    key: 'write-it-down', rule: 'Tone, timings and what we offered go on the glitch while you remember them.',
    why: 'The engine cannot price what nobody recorded, and half of these arrive by phone where the only record is whoever picked up. An unrecorded same-day fix gets priced as a next-day one, and that difference is real money.',
  },
]

// ── THE MATRIX ──────────────────────────────────────────────────────────────────────────────────
// Severity down the side, what actually happened to the clock across the top. Every percentage is
// computed by running the real engine over a canonical one-night case, so this table cannot drift
// from what the glitch advisor recommends. The dial is held at the middle of each band; review
// exposure is what moves it, and that lives in lib/review-exposure.ts.
export const MATRIX_SPEEDS: Array<{ key: ResolutionSpeed; label: string; sub: string }> = [
  { key: 'same_day', label: 'Fixed same day', sub: 'inside the clock' },
  { key: 'next_day', label: 'Fixed next day', sub: 'one night carried it' },
  { key: 'two_days', label: 'Two days', sub: 'the stay bent around it' },
  { key: 'three_plus', label: 'Three days or never', sub: 'we failed them' },
]

export type MatrixCell = {
  severity: Severity
  speed: ResolutionSpeed
  /** Percent of ONE night's rate, per affected night, at the middle of the band. */
  pctMid: number
  /** The same cell at the bottom and top of its defensible band (dial 0 and 1). */
  pctLow: number
  pctHigh: number
  /** With an effective workaround in their hands — the number the ladder is trying to reach. */
  pctWithRemedy: number
  /** Cash on a canonical night, mid-band, for a reader who thinks in dollars not percentages. */
  usdMid: number
  action: string
}

const ACTION: Record<Severity, Record<ResolutionSpeed, string>> = {
  minor: {
    same_day: 'Fix it and say so. No money.',
    next_day: 'Fix it. Money only if they raise it.',
    two_days: 'Apologise properly and settle it small.',
    three_plus: 'We forgot them. Settle it and find out why it sat.',
    unresolved: 'Never fixed. Settle it and close the loop on why not.',
  },
  moderate: {
    same_day: 'Fix it, hand them something for the gap, small settlement at most.',
    next_day: 'Fix it, then settle the night it spoiled.',
    two_days: 'Settle both nights and have a supervisor call them.',
    three_plus: 'Supervisor calls today. Settle generously and look at what broke internally.',
    unresolved: 'Never fixed. Supervisor calls, settle generously, and the unit does not take the next booking until it is right.',
  },
  critical: {
    same_day: 'All hands on the fix. Settle the day it cost them.',
    next_day: 'Supervisor call. Settle the night in full territory.',
    two_days: 'Jon sees this. Expect most of the affected nights back.',
    three_plus: 'Jon takes it. The stay was not what we sold and the number will say so.',
    unresolved: 'Never fixed. Jon takes it, the unit comes off the calendar, and expect the affected nights back in full.',
  },
}

/** Build the printable grid. `nightly` only affects the dollar column. */
export function buildMatrix(nightly = 300, channel = 'airbnb'): MatrixCell[] {
  const cells: MatrixCell[] = []
  const severities: Severity[] = ['minor', 'moderate', 'critical']
  const run = (severity: Severity, speed: ResolutionSpeed, mitigation: Mitigation, dial: number) =>
    computeRefund({
      nightlyRate: nightly, totalNights: 3, affectedNights: 1,
      channel, severity, speed, mitigation, dial,
    })
  for (const severity of severities) {
    for (const s of MATRIX_SPEEDS) {
      const mid = run(severity, s.key, 'none', 0.5)
      cells.push({
        severity, speed: s.key,
        pctMid: mid.finalPct,
        pctLow: run(severity, s.key, 'none', 0).finalPct,
        pctHigh: run(severity, s.key, 'none', 1).finalPct,
        pctWithRemedy: run(severity, s.key, 'effective', 0.5).finalPct,
        usdMid: mid.refund,
        action: ACTION[severity][s.key],
      })
    }
  }
  return cells
}

/** The severity definitions, in the words the team actually has to apply at 10pm. */
export const SEVERITY_TEST: Record<Severity, { label: string; test: string; examples: string }> = {
  minor: {
    label: 'Minor — the stay is intact',
    test: 'Would they still describe this as a good stay if we fixed it today?',
    examples: 'A bulb out, a dishwasher down, a slow drain, a missing utensil, wifi wobbling.',
  },
  moderate: {
    label: 'Moderate — the stay is degraded but livable',
    test: 'Did they lose something they paid for, while still being able to stay?',
    examples: 'Intermittent hot water, AC struggling, washer down on a long stay, a clearly inadequate clean, parking they paid for and cannot use.',
  },
  critical: {
    label: 'Critical — the unit is unfit',
    test: 'Would you let your own family sleep there tonight as it stands?',
    examples: 'No AC in heat, no hot water at all, sewage, bed bugs, no power, a door that will not lock, a lockout running hours.',
  },
}
