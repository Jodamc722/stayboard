// WHAT MAKES A GUEST ISSUE — the judgement, with no server imports so it can be tested bare
// (node lib/__tests__/guest-issue-judge.test.mjs). lib/guest-issue.ts does the reading and filing.
export type IssueSeverity = 'security' | 'issue' | 'watch' | 'none'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ── WHAT MAKES SOMETHING URGENT ─────────────────────────────────────────────────────────────────
// A safety or security problem is not "a guest issue" in the ordinary sense: it is somebody in a
// room they are now afraid of. It escalates past customer care to leadership the same minute.
// These patterns come from the Jenna call and from the categories the team already files under.
// TIGHTENED 2026-10-10 (Eve audit): "lock is" matched "the smart lock is not accepting the code" and
// "fell" matched "fell asleep", so Capri 110's code-that-worked-after-troubleshooting went to two rooms
// as a Safety matter. A lock is a safety matter when it will NOT lock, not whenever a lock is mentioned.
const SECURITY_RE = /\b(lock(?:s|ed|ing)?\s+(?:is |are |was |were )?(?:not (?:locking|working|engaging|catching|closing)|n't|won'?t|doesn'?t|does not|broken|fail(?:s|ed|ing)?|jammed)|(?:won'?t|will not|does ?not|doesn'?t|did ?not|didn'?t|cannot|can'?t|could ?not|couldn'?t|not) lock(?:ing)?\b|door (?:won'?t|will not|doesn'?t|does not|didn'?t|did not) (?:lock|close|latch|shut)|deadbolt|broke[rn]? in|break[- ]?in|intrud|tried to (?:open|get in|enter)|someone (?:was|is) (?:at|outside|trying)|stranger|unsafe|not safe|afraid|scared|threat|stalk|harass|assault|weapon|gun|robbed|stolen|theft|burglar|police|911|fire(?! ?(?:pit|place|alarm test))|smoke|gas leak|carbon monoxide|flood(?:ing|ed)|electrical (?:fire|shock)|injur|fell (?:down|off|in the|on the)|blood|hospital)\b/i
// Problems that stop the stay working but are not a safety matter.
const HARD_RE = /\b(no (?:hot )?water|no (?:a\/?c|air|power|electricity|wifi|internet)|not working|doesn'?t work|won'?t turn|broken|leak|flood|mold|roach|bed ?bug|pest|infest|filthy|dirty|unclean|smell|sewage|locked out|lock(?:ed)? out|can'?t get in|couldn'?t get in|no access|code (?:doesn'?t|did not|didn'?t|does not|is not|isn'?t) work|double ?book|wrong unit|cancel)\b/i
// ROUTINE ASKS ARE NOT ISSUES (Eve audit 2026-10-10). The model lists what a call was ABOUT under
// issues[] — "asked for check-in instructions", "early check-in request", "post-checkout feedback
// call" — and each one posted to #vr-customercareteam as a Guest issue tagging three people, nine to
// fourteen times a day. A call whose every named item is an ordinary ask is recorded on the Detected
// tab and never alerts. Anything concrete (HARD_RE / SECURITY_RE) in the same list still wins.
const ROUTINE_RE = /\b(early check[- ]?in|late check[- ]?out|check[- ]?in (?:instructions|info(?:rmation)?|time|details|process|procedure)|check[- ]?out (?:instructions|time|process|procedure)|how to (?:get in|check in|access|enter)|feedback call|post[- ]?check[- ]?out (?:call|feedback|follow[- ]?up)|follow[- ]?up call|courtesy call|welcome call|parking (?:info|instructions|question|details|pass)|wi-?fi (?:password|name|info|details|network)|directions|luggage|bag storage|extend(?:ing|ed)? (?:the |their |his |her )?stay|extension request|receipt|invoice|confirm(?:ation|ing|ed) (?:the |their )?(?:booking|reservation|stay|dates)|asked (?:about|for|when|where|how|if|whether)|wanted to know|inquir(?:y|ed|ing)|question about|requested? (?:a |an )?(?:early|late|extra|additional)|house ?keeping schedule|towels?|toiletries|amenit(?:y|ies) (?:question|request)|recommendation)\b/i
// SETTLED ON THE CALL (Eve audit 2026-10-10). "The code worked after troubleshooting" is a glitch for
// the record and nothing for customer care to do — they took the call. Filed quietly: no alert, no post.
const RESOLVED_RE = /\b(was resolved|resolved (?:on|during) the call|got it working|now works?|worked after|is working now|working again|was able to (?:get in|enter|access|open|log ?in)|got in(?:side)?|let (?:them|him|her) in(?:side)?|issue (?:was |is )?fixed|fixed (?:it|on the call|during the call)|no further (?:action|issues?|help) (?:needed|required)|all set|settled|resolved the issue|walked (?:them|him|her) through)\b/i

const STRONG_SAFETY_RE = /\b(afraid|scared|unsafe|not safe|intrud(?:er|ed|ing)?|broke[rn]? in|break[- ]?in|stranger|911|gas leak|carbon monoxide|weapon|gun|assault(?:ed)?|threat(?:en(?:ed|ing)?)?|robbed|burglar|stalk|harass|smoke (?:in|coming|filling)|fire in|flooding|electrical shock|bleeding|ambulance)\b/i

/** One judgement for a call or a thread: how loud, and whether customer care needs telling at all. */
export function judgeIssue(issues: string[], context: string, sentiment: string | null | undefined, opts: { followUp?: boolean } = {}): { severity: IssueSeverity; quiet: boolean; why: string } {
  const named = issues.map(s => str(s)).filter(Boolean)
  const namedText = named.join(' · ')
  // Safety: the named issues, plus the unmistakable words wherever they appear — a guest describing
  // somebody at the door belongs here even when the model filed it under the summary, not issues[].
  if (SECURITY_RE.test(namedText) || STRONG_SAFETY_RE.test(str(context)))
    return { severity: 'security', quiet: false, why: 'safety words' }
  if (!named.length) return { severity: 'watch', quiet: false, why: 'nothing named' }
  const concrete = named.filter(i => HARD_RE.test(i) || SECURITY_RE.test(i))
  if (!concrete.length && named.every(i => ROUTINE_RE.test(i))) return { severity: 'watch', quiet: false, why: 'routine ask' }
  const settled = RESOLVED_RE.test(str(context)) && opts.followUp !== true
  if (concrete.length) return { severity: 'issue', quiet: settled, why: settled ? 'concrete, settled on the call' : 'concrete' }
  if (sentiment === 'unhappy' || sentiment === 'negative') return { severity: 'issue', quiet: settled, why: settled ? 'unhappy, settled on the call' : 'unhappy' }
  return { severity: 'watch', quiet: false, why: 'nothing concrete' }
}

/** Category, from the CAT_CHIPS vocabulary the Glitches board already files under. */
export function categoryFor(text: string): string {
  const t = text.toLowerCase()
  if (SECURITY_RE.test(t) || /\block|door|key|fob|entry|access|code\b/.test(t)) {
    // An access problem that is only "the code did not work" is a building/access matter; a lock
    // that will not lock, or somebody at the door, is security.
    if (SECURITY_RE.test(t)) return 'Safety/Security Concern'
    return 'Maintenance - Building/Common Areas'
  }
  if (/\b(a\/?c|air con|heat|hot|cold|temperature|hvac|thermostat)\b/.test(t)) return 'Maintenance - HVAC/Temperature'
  if (/\b(hot water|water heater|shower.*(cold|no water))\b/.test(t)) return 'Maintenance - Water Heater'
  if (/\b(dirty|filthy|unclean|clean(?:liness|ing)|stain|trash|dishes|linen|towel)\b/.test(t)) return 'Cleanliness - Inadequate Cleaning'
  if (/\b(toilet|sink|drain|plumb|leak|water everywhere|clog)\b/.test(t)) return 'Maintenance - Plumbing'
  if (/\b(fridge|refrigerator|oven|stove|microwave|washer|dryer|dishwasher|appliance|tv|television)\b/.test(t)) return 'Maintenance - Appliances'
  if (/\b(power|outlet|electric|light|breaker|fuse)\b/.test(t)) return 'Maintenance - Electrical'
  if (/\b(roach|bug|bed ?bug|ant|rodent|mouse|rat|pest|infest)\b/.test(t)) return 'Pests/Bed Bugs'
  if (/\b(park|garage|valet|vehicle|car)\b/.test(t)) return 'Parking/Vehicle'
  if (/\b(elevator|lobby|gym|pool|common|building|hallway|construction|noise)\b/.test(t)) return 'Maintenance - Building/Common Areas'
  return 'Other'
}

/** How loud. Security wins; otherwise a concrete fault is an issue and a grumble is a watch. */
export function severityFor(text: string, sentiment?: string | null): IssueSeverity {
  const t = text.toLowerCase()
  if (SECURITY_RE.test(t)) return 'security'
  if (HARD_RE.test(t)) return 'issue'
  if (sentiment === 'unhappy' || sentiment === 'negative') return 'issue'
  return 'watch'
}

