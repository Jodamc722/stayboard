// WHICH RECENT REVIEW EARNS A QUALITY INSPECTION BEFORE THE NEXT GUEST — ONE RULE.
//
// The Command Center's arrival-feedback rows (lib/command-day) and the automation that now files
// those inspections by itself (lib/auto-inspections runArrivalFeedbackInspections, Jon 2026-09-30:
// "quality inspection should be auto-generated. It shouldn't be required or asked for") must agree
// on exactly which review qualifies, or Today would show a row the automation never files, or the
// automation would file one Today never showed. So the rule lives here, once, with no imports.
//
//   the worst of the unit's LAST FIVE reviews (the caller bounds them by date and passes them newest
//   first) that is ≤2★, or ≤3★ AND names a defect somebody can be sent to look at (keywordsOf).
//
// Without the defect bar every arrival day was a wall of rows (100 of 287 units carry some ≤3★).
// Ratings are the stored 5-star scale (lib/review-scale — Booking is halved at sync).
// "Walked since the review" is NOT decided here — that is lib/review-inspections, read by both.

/** The defect words in a review, so the inspection says what to look at. Three at most. */
export function keywordsOf(text: string): string[] {
  const t = String(text || '').toLowerCase()
  const out: string[] = []
  const KW: [RegExp, string][] = [
    [/dirty|unclean|filthy|hair|stain|dust|smell|odor|mold|mould|damp|grime|crumbs|sticky/, 'cleanliness'],
    [/\ba\/?c\b|air ?con|ac unit|hot inside|cooling|thermostat/, 'A/C'],
    [/wifi|wi-fi|internet|tv\b|remote|netflix/, 'Wi-Fi / TV'],
    [/lock|code|key|door|check[- ]?in|access|elevator|gate/, 'access'],
    [/noise|loud|construction|party|neighbo/, 'noise'],
    [/water|shower|leak|plumb|toilet|drain|hot water|pressure/, 'plumbing'],
    [/bed|mattress|pillow|linen|sheet|towel|blanket/, 'bedding / linens'],
    [/bug|roach|ant\b|ants\b|pest|mosquito/, 'pests'],
    [/broken|not work|didn.t work|doesn.t work|fix|repair|maintenance/, 'repairs'],
    [/kitchen|stove|oven|fridge|refrigerator|microwave|coffee|dishwasher|utensil|pan\b|pots/, 'kitchen'],
    [/parking|garage|valet/, 'parking'],
  ]
  for (const [re, label] of KW) if (re.test(t) && !out.includes(label)) out.push(label)
  return out.slice(0, 3)
}

export type FeedbackReview = { id?: any; rating?: any; content?: any; created_at?: any; channel?: any; [k: string]: any }

/**
 * The review that asks for an inspection, from one unit's reviews NEWEST FIRST — or null.
 * Only the last five count: a unit that has had five stays since a complaint has moved on.
 */
export function worstFeedbackReview<T extends FeedbackReview>(newestFirst: T[]): T | null {
  let worst: T | null = null
  for (const rv of (newestFirst || []).slice(0, 5)) {
    const n = Number(rv && rv.rating)
    if (!Number.isFinite(n) || n <= 0 || n > 3) continue
    if (n > 2 && keywordsOf(String(rv.content ?? '')).length === 0) continue
    if (!worst || n < Number(worst.rating)) worst = rv
  }
  return worst
}
