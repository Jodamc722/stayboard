// WHAT IS A FAIR REFUND — Stay Hospitality's policy, as arithmetic.
//
// Jon, 2026-08-27: "I want to train ai in the glitch to help determine a reasonable refund amount,
// to guide the team in making decisions. If not enough info, the ai in tasks should ask questions,
// like guest tone, how fast it was fixed, the resolutions."
//
// THIS FILE IS NOT A NEW POLICY. It is the existing Stay Hospitality refund framework — severity
// tiers, base percentage per affected night, the resolution-speed and mitigation adjustments, the
// Airbnb bump — written out so a computer applies it the same way every time.
//
// WHY THE MODEL DOES NOT DO THE MATHS. The whole point of the framework is that "the same issue at
// the same severity should produce roughly the same refund regardless of which team member handles
// it." A language model asked to compute a refund will produce a defensible number and a slightly
// different one next Tuesday, which defeats the exercise. So the split is:
//
//   THE MODEL   reads the report and the guest thread and CLASSIFIES: how severe, how fast it was
//               fixed, what was offered, how the guest sounds. Judgement, which it is good at.
//   THIS FILE   turns those classifications into a number. Arithmetic, which it is bad at.
//
// Every input is a named band rather than a free number, so a recommendation can always be read
// backwards: this amount, because moderate severity, fixed next day, portable unit offered, Airbnb.
import 'server-only'

export type Severity = 'minor' | 'moderate' | 'critical'
export type ResolutionSpeed = 'same_day' | 'next_day' | 'two_days' | 'three_plus' | 'unresolved'
export type Mitigation = 'effective' | 'partial' | 'gesture' | 'none'
export type GuestTone = 'understanding' | 'frustrated' | 'angry' | 'fishing'

/**
 * Base share of ONE night's rate, per affected night.
 * Ranges exist so a case can sit at the mild or severe end of its tier — `dial` picks where.
 */
export const BASE: Record<Severity, [number, number]> = {
  minor: [0.10, 0.15],
  moderate: [0.25, 0.40],
  critical: [0.50, 0.75],
}

/**
 * How fast we fixed it — the biggest single adjustment, and the one the guest actually remembers.
 * Multiplies the base. Guests forgive a broken thing; they do not forgive being left with it.
 */
export const SPEED: Record<ResolutionSpeed, [number, number]> = {
  same_day:   [0.70, 0.80],   // reduce 20-30%
  next_day:   [1.00, 1.00],   // the base stands
  two_days:   [1.15, 1.20],
  three_plus: [1.25, 1.40],
  unresolved: [1.25, 1.40],
}

/**
 * What we put in their hands instead. The word that matters is MEANINGFUL: a fan when the AC is
 * out in July is a gesture, not a solution, and the bands are spaced to say so.
 */
export const MITIGATION: Record<Mitigation, [number, number]> = {
  effective: [0.60, 0.75],    // portable AC, hotel night, space heater in winter
  partial:   [0.85, 0.90],    // a fan for the AC, extra blankets for heat
  gesture:   [0.90, 0.95],    // apology, gift basket
  none:      [1.00, 1.00],
}

/**
 * Airbnb is the channel that punishes a bad review hardest, and that cost lands across every
 * listing rather than this one booking. The bump is cheaper than the review.
 */
export const OTA_BUMP: Record<string, [number, number]> = {
  airbnb: [1.10, 1.15],
}

export type RefundInput = {
  nightlyRate: number
  totalNights: number
  affectedNights: number
  /** Nights paid for but not stayed because the guest left over this issue. Refunded in full. */
  unusedNights?: number
  channel?: string | null
  severity: Severity
  speed: ResolutionSpeed
  mitigation: Mitigation
  tone?: GuestTone | null
  /** Reported only after checkout — the impact was probably lower than a day-one report. */
  reportedAfterCheckout?: boolean
  /** Repeat guest or VIP: lifetime value beats one refund. */
  vip?: boolean
  /** The guest caused it. No refund, and the documentation is the point. */
  guestCaused?: boolean
  /**
   * Where in each band to sit, 0 = mild end, 1 = severe end. The model supplies this from how the
   * case reads, which is exactly the judgement the bands were built to allow.
   */
  dial?: number
}

export type RefundStep = { label: string; effect: string; runningPct: number }

export type RefundResult = {
  refund: number
  finalPct: number
  basePct: number
  steps: RefundStep[]
  /** Plain sentences: how this number was reached, in order. */
  reasoning: string[]
  cappedByStayValue: boolean
  stayValue: number
  pctOfStay: number
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const pick = ([lo, hi]: [number, number], dial: number) => lo + (hi - lo) * clamp01(dial)
const money = (n: number) => Math.round(n * 100) / 100
const pct = (n: number) => Math.round(n * 1000) / 10

/**
 * Apply the framework. Deterministic: the same inputs always produce the same number, which is the
 * entire reason this is code and not a paragraph in a handbook.
 */
export function computeRefund(input: RefundInput): RefundResult {
  const dial = clamp01(input.dial ?? 0.5)
  const rate = Math.max(0, Number(input.nightlyRate) || 0)
  const nights = Math.max(0, Math.round(Number(input.totalNights) || 0))
  const affected = Math.max(0, Math.min(nights || 999, Math.round(Number(input.affectedNights) || 0)))
  const unused = Math.max(0, Math.round(Number(input.unusedNights) || 0))
  const stayValue = money(rate * nights)

  const steps: RefundStep[] = []
  const reasoning: string[] = []

  if (input.guestCaused) {
    return {
      refund: 0, finalPct: 0, basePct: 0, steps: [], stayValue, pctOfStay: 0, cappedByStayValue: false,
      reasoning: ['The issue was caused by the guest, so no refund is due. Document what happened — that record is the defence if they escalate through the channel.'],
    }
  }

  // 1. Base, from severity.
  let p = pick(BASE[input.severity], dial)
  const basePct = p
  steps.push({ label: `${input.severity} severity`, effect: `${pct(p)}% per affected night`, runningPct: pct(p) })
  reasoning.push(`A ${input.severity} issue starts at ${pct(p)}% of the nightly rate for each of the ${affected} affected night${affected === 1 ? '' : 's'}.`)

  // 2. How fast it was put right.
  const sf = pick(SPEED[input.speed], input.speed === 'same_day' ? 1 - dial : dial)
  p *= sf
  const speedWord: Record<ResolutionSpeed, string> = {
    same_day: 'fixed the same day', next_day: 'fixed the next day', two_days: 'took two days',
    three_plus: 'took three days or more', unresolved: 'was never resolved',
  }
  steps.push({ label: speedWord[input.speed], effect: sf === 1 ? 'no change' : `×${sf.toFixed(2)}`, runningPct: pct(p) })
  if (sf < 1) reasoning.push(`It was ${speedWord[input.speed]}, which brings it down to ${pct(p)}% — a quick fix is most of what a guest remembers.`)
  else if (sf > 1) reasoning.push(`It ${speedWord[input.speed]}, which pushes it up to ${pct(p)}%. Every extra day compounds the frustration and the review risk.`)
  else reasoning.push(`Fixed the next day, so the base stands at ${pct(p)}%.`)

  // 3. What was offered instead.
  const mf = pick(MITIGATION[input.mitigation], 1 - dial)
  p *= mf
  if (input.mitigation !== 'none') {
    const mWord: Record<Mitigation, string> = {
      effective: 'a real alternative was provided', partial: 'a partial workaround was offered',
      gesture: 'a gesture was made', none: '',
    }
    steps.push({ label: mWord[input.mitigation], effect: `×${mf.toFixed(2)}`, runningPct: pct(p) })
    reasoning.push(`Because ${mWord[input.mitigation]}, it comes down to ${pct(p)}%.`)
  } else {
    steps.push({ label: 'nothing was offered', effect: 'no reduction', runningPct: pct(p) })
    reasoning.push('Nothing was offered as a workaround, so there is no reduction here.')
  }

  // 4. Reported late.
  if (input.reportedAfterCheckout) {
    const lf = 0.75
    p *= lf
    steps.push({ label: 'reported after checkout', effect: `×${lf}`, runningPct: pct(p) })
    reasoning.push(`They did not raise it until after checkout, so the impact was likely lower than a day-one report — ${pct(p)}%.`)
  }

  // 5. Tone. Only ever moves toward the low end, and only for a guest who is plainly working us.
  if (input.tone === 'fishing') {
    const tf = 0.85
    p *= tf
    steps.push({ label: 'guest appears to be fishing', effect: `×${tf}`, runningPct: pct(p) })
    reasoning.push('The complaint reads as fishing for a discount, so this sits at the low end. Document everything.')
  }

  // 6. VIP / repeat.
  if (input.vip) {
    const vf = 1.08
    p *= vf
    steps.push({ label: 'repeat or VIP guest', effect: `×${vf}`, runningPct: pct(p) })
    reasoning.push('Repeat guest — worth a little more, because their lifetime value outruns this refund.')
  }

  // 7. Channel.
  const ch = String(input.channel || '').toLowerCase()
  const isAirbnb = ch.includes('airbnb')
  if (isAirbnb) {
    const of = pick(OTA_BUMP.airbnb, input.tone === 'angry' ? 1 : dial)
    p *= of
    steps.push({ label: 'Airbnb', effect: `×${of.toFixed(2)}`, runningPct: pct(p) })
    reasoning.push(`Airbnb booking, so add the channel bump to ${pct(p)}% — a bad review there costs more across every listing than the difference here.`)
  }

  // A NIGHT CANNOT BE WORTH MORE THAN ITSELF. The framework's ceiling: where a critical issue made
  // the unit unusable for a whole night and nothing was offered, you refund that night in full —
  // full, not more. Without this, a critical + unresolved + Airbnb case compounds past 100% of the
  // nightly rate and only gets caught by the whole-stay cap much later, which reads as a bug even
  // when the total lands somewhere defensible.
  if (p > 1) {
    steps.push({ label: 'capped at a full night', effect: 'from ' + pct(p) + '% to 100%', runningPct: 100 })
    reasoning.push(`That compounds past the value of the night itself, so it is capped at a full night's refund — ${pct(p)}% becomes 100%.`)
    p = 1
  }

  // 8. The money.
  let refund = money(rate * affected * p)
  if (unused > 0) {
    const unusedAmount = money(rate * unused)
    refund = money(refund + unusedAmount)
    steps.push({ label: `${unused} unused night${unused === 1 ? '' : 's'}`, effect: `+${unusedAmount}`, runningPct: pct(p) })
    reasoning.push(`They left early, so the ${unused} night${unused === 1 ? '' : 's'} they paid for and did not use are refunded in full.`)
  }

  // Never refund more than they paid.
  let capped = false
  if (stayValue > 0 && refund > stayValue) {
    refund = stayValue
    capped = true
    reasoning.push('Capped at the full value of the stay — we never refund more than the guest paid.')
  }

  return {
    refund,
    finalPct: pct(p),
    basePct: pct(basePct),
    steps,
    reasoning,
    cappedByStayValue: capped,
    stayValue,
    pctOfStay: stayValue > 0 ? Math.round((refund / stayValue) * 1000) / 10 : 0,
  }
}

/**
 * MULTIPLE THINGS WENT WRONG. Each issue is priced on its own and the results are added, then the
 * total is capped at the value of the stay — the policy's own rule, and the reason a glitch can now
 * carry more than one category.
 */
export function computeMultiple(inputs: RefundInput[]): RefundResult & { perIssue: RefundResult[] } {
  const per = inputs.map(computeRefund)
  const stayValue = per[0]?.stayValue ?? 0
  let total = money(per.reduce((a, r) => a + r.refund, 0))
  let capped = false
  if (stayValue > 0 && total > stayValue) { total = stayValue; capped = true }
  return {
    refund: total,
    finalPct: per.length === 1 ? per[0].finalPct : 0,
    basePct: per.length === 1 ? per[0].basePct : 0,
    steps: per.flatMap(r => r.steps),
    reasoning: per.length === 1 ? per[0].reasoning : [
      `${per.length} separate issues on one stay, each priced on its own and added together.`,
      ...per.flatMap((r, i) => r.reasoning.map(s => `Issue ${i + 1}: ${s}`)),
      ...(capped ? ['Capped at the full value of the stay — we never refund more than the guest paid.'] : []),
    ],
    cappedByStayValue: capped,
    stayValue,
    pctOfStay: stayValue > 0 ? Math.round((total / stayValue) * 1000) / 10 : 0,
    perIssue: per,
  }
}

/** What the model still has to find out before any of the above means anything. */
export const REQUIRED_FIELDS: Array<{ key: string; ask: string }> = [
  { key: 'nightlyRate', ask: 'What is the nightly rate on this booking?' },
  { key: 'affectedNights', ask: 'How many nights did the problem actually affect?' },
  { key: 'severity', ask: 'How bad was it — a small annoyance, a degraded stay, or was the unit genuinely compromised?' },
  { key: 'speed', ask: 'How quickly was it put right — same day, next day, longer, or is it still open?' },
  { key: 'mitigation', ask: 'What did we give them in the meantime? A real alternative like a portable unit, a partial workaround, or just an apology?' },
  { key: 'tone', ask: 'How is the guest sounding — understanding, frustrated, angry, or angling for a discount?' },
]
