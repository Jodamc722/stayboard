// THE COMPLAINT TAXONOMY — one list, used everywhere.
//
// This used to live inside listingIntel.ts, which meant the field blocks and the reviews board could
// drift into disagreeing about what "a cleanliness complaint" is. Both now read from here, so a theme
// added once shows up in the cleaner's task, the inspector's task AND the action board.
//
// Each theme carries WHO should act and WHAT they should do — the action text is written to be read
// by the person holding the phone in the unit, not by a manager. Word-start boundaries throughout,
// because "ac" inside "back" produced phantom A/C complaints in the first version of this matcher.

export type IntelKind = 'clean' | 'inspection' | 'maintenance'

export type Theme = {
  key: string
  label: string
  re: RegExp
  who: IntelKind[]
  action: string
}

export const THEMES: Theme[] = [
  { key: 'cleanliness', label: 'cleanliness', re: /\b(dirty|not clean|unclean|dust|dusty|hair|grimy|filthy|stain|stained|sticky|crumbs)\b/i, who: ['clean', 'inspection'],
    action: 'Go slower on surfaces, floors, under and behind furniture, and check the linens before you put them on.' },
  { key: 'smell', label: 'smell or damp', re: /\b(smell|smells|smelly|odou?r|musty|damp|mildew|mold|mould|stinks)\b/i, who: ['clean', 'inspection', 'maintenance'],
    action: 'Check the drains, bins, fridge, washer gasket and A/C. Air the unit out before you leave.' },
  { key: 'bathroom', label: 'the bathroom', re: /\b(shower|toilet|water pressure|hot water|drain|grout|sink|bathtub|tub)\b/i, who: ['clean', 'inspection', 'maintenance'],
    action: 'Scrub grout, glass and drains, then run the shower and the hot water to make sure both work.' },
  { key: 'kitchen', label: 'the kitchen', re: /\b(kitchen|stove|oven|fridge|refrigerator|microwave|dishwasher|cookware|pans|pots|utensils|dishes|coffee)\b/i, who: ['clean', 'inspection', 'maintenance'],
    action: 'Empty and wipe the fridge, run the dishwasher empty, and count the cookware and utensils back to a full set.' },
  { key: 'supplies', label: 'missing supplies', re: /\b(towel|towels|sheet|sheets|linen|linens|amenit|soap|shampoo|toilet paper|paper towel|supplies|restock|no coffee)\b/i, who: ['clean', 'inspection'],
    action: 'Restock to par: towels, linens, toiletries, paper goods, coffee.' },
  { key: 'bed', label: 'the beds', re: /\b(mattress|bed was|beds were|uncomfortable bed|sofa ?bed|pull-?out|springs|saggy|sagging|pillows)\b/i, who: ['inspection', 'maintenance'],
    action: 'Look at the mattress, the sofa bed mechanism and the pillows. Photograph anything worn.' },
  { key: 'ac', label: 'air conditioning', re: /\b(a\/?c|air con|aircon|air condition\w*|too hot|too warm|too cold|freezing|cooling|thermostat|humid|stuffy)\b/i, who: ['inspection', 'maintenance', 'clean'],
    action: 'Set the thermostat and confirm it actually cools. Check the filter.' },
  { key: 'wifi', label: 'Wi-Fi and TV', re: /\b(wi-?fi|internet|router|streaming|netflix|tv|television|remote)\b/i, who: ['inspection', 'maintenance'],
    action: 'Test the Wi-Fi on your phone and check the TV turns on and signs in.' },
  { key: 'access', label: 'getting in', re: /\b(check-?in|lockbox|key|keys|code|codes|access|entry|door lock|fob|gate|garage|parking)\b/i, who: ['inspection', 'maintenance'],
    action: 'Test the door code yourself, plus the building and garage access.' },
  { key: 'noise', label: 'noise', re: /\b(noise|noisy|loud|thin walls|construction|traffic|barking)\b/i, who: ['inspection'],
    action: 'Listen for the source: appliances, A/C, doors, neighbours. Note what you hear.' },
  { key: 'furniture', label: 'tired furniture', re: /\b(furniture|sofa|couch|chair|chairs|table|worn|scuffed|scratched|chipped|dated|shabby)\b/i, who: ['inspection'],
    action: 'Photograph the worn pieces so they can be priced for the owner.' },
  { key: 'pests', label: 'pests', re: /\b(bug|bugs|pest|pests|roach|roaches|ants?|insects?|spiders?)\b/i, who: ['clean', 'inspection', 'maintenance'],
    action: 'Check the kitchen, bathroom and baseboards, and report anything you see the same day.' },
]

export const THEME_BY_KEY: Record<string, Theme> = THEMES.reduce((m, t) => { m[t.key] = t; return m }, {} as Record<string, Theme>)

// ── IS THIS ACTUALLY A COMPLAINT? ───────────────────────────────────────────────────────────────
// The theme patterns match a WORD, not a feeling. "Check-in was seamless" hits the access theme just
// as hard as "the check-in code did not work", so matching alone turned five-star praise into work
// orders. Anything that wants to raise a JOB off a review has to pass this too.
// A CONTRAST WORD IS A COMPLAINT MARKER. "Lovely place, but the shower ran cold" is a shower job,
// and the praise in front of it is what makes the naive positive/negative test get it wrong.
const CONTRAST = /\b(but|however|although|though|unfortunately|except|aside from|other than|only (?:issue|complaint|downside)|downside|drawback)\b/i
const NEG = /\b(no|not|n't|never|without|lack\w*|missing|broke\w*|broken|dirty|filthy|gross|stain\w*|smell\w*|musty|mold\w*|mould\w*|old|worn|outdated|dated|slow|weak|poor|bad|worst|awful|terrible|horrible|disappoint\w*|issue\w*|problem\w*|complain\w*|uncomfortable|unclean|unusable|difficult|hard time|struggl\w*|confus\w*|wrong|fail\w*|didn|couldn|wouldn|wasn|weren|isn|cold|lukewarm|freezing|stuffy|humid|loud|noisy|cramped|leak\w*|clog\w*|stuck|jam\w*|rust\w*|chip\w*|crack\w*|sticky|grimy|dusty|too (?:hot|cold|small|loud|noisy|warm)|needs?\b|should be|could be better|barely|hardly)\b/i
const POS = /\b(great|good|perfect|excellent|amazing|wonderful|fantastic|lovely|beautiful|spotless|immaculate|pristine|clean and|easy|seamless|smooth|simple|convenient|comfortable|cozy|loved|love|enjoyed|nice|well[- ]stocked|plenty|helpful|quick|fast|no issues|no problems|highly recommend)\b/i

/**
 * Does this sentence read like a complaint rather than praise?
 *
 * Deliberately conservative in BOTH directions: a sentence with a negative cue counts even if it
 * also has a positive one ("clean and comfortable but the shower was cold" is still a shower job),
 * and a sentence that is purely positive is thrown away. A sentence with neither cue is ambiguous,
 * so it only counts when the review itself was poor — the rating breaks the tie.
 */
export function looksNegative(sentence: string, rating: number): boolean {
  const s = String(sentence == null ? '' : sentence)
  if (NEG.test(s) || CONTRAST.test(s)) return true
  if (POS.test(s)) return false
  return Number.isFinite(rating) && rating <= 3
}

/** Just the sentence that mentions the thing. Nobody in a unit should have to read a paragraph. */
export function sentenceAbout(text: string, re: RegExp): string {
  const body = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  const parts = body.split(/(?<=[.!?])\s+/)
  const hit = parts.find(p => re.test(p))
  return (hit || body).trim().slice(0, 180)
}
