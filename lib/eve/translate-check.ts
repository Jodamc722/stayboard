// IS THIS A TRANSLATION, OR DID SHE JOIN THE CONVERSATION? (2026-09-30)
//
// Jon, 2026-09-28: a tag at the end "translates and never asks a question". The first guard for that
// counted question marks — and rejected every English question translated into Spanish, because
// Spanish writes "¿…?" and so has twice the marks. Jon's own test ("can we work getting billables
// done for Miami please? Happy to train and help? Thanks @Eve") came back as the apology line, twice.
// An English question written without a "?" ("Testing how are you") had the same problem the other
// way: the translator punctuated it correctly and was rejected for it.
//
// The thing to catch was never a question mark. It is a SENTENCE THE AUTHOR DID NOT WRITE — an
// offer, a follow-up, a sign-off the model bolted onto the end ("¿Quieres que te ayude con algo
// más?", "Let me know if you need anything else."). So this looks only at the tail of the output,
// and only for the shapes of those. A trailing sentence that is one of them is cut; everything else
// is the translation and is posted as it came. Never a null: a trimmed translation beats an apology.
//
// No imports, so lib/eve/__tests__/translate-check.test.mjs runs it with plain node.

// Offers and follow-ups a translator has no business adding, in both languages. Anchored to the
// START of a trailing sentence so a real sentence that merely contains one of these words survives.
const BOLTED_ON = new RegExp(
  '^[¿¡]?\\s*(?:' + [
    // Spanish
    '(?:quieres|quiere|quieren|deseas|desea|necesitas|necesita|necesitan|te gustar[ií]a|le gustar[ií]a)\\s+que\\b',
    'te ayudo con', 'le ayudo con', 'puedo ayudar(?:te|le|les)? (?:con|en)', 'hay algo m[áa]s', 'algo m[áa]s en (?:lo )?que',
    'av[ií]same si', 'av[ií]senme si', 'd[ií]game si', 'dime si', 'espero que (?:esto )?(?:te |le )?(?:ayude|sirva)', 'estoy (?:aqu[ií] )?para ayudar',
    // English
    'do you (?:want|need) me to\\b', 'would you like (?:me )?to\\b', 'shall i\\b', 'can i help', 'is there anything else', 'anything else (?:i|you)',
    'let me know (?:if|when|whether)', 'feel free to\\b', 'hope (?:this|that) helps', 'i(?:\'| a)m here (?:to|if)', 'just let me know',
  ].join('|') + ')',
  'i',
)

/** The output split into sentences, with line breaks respected — the unit the tail check works in. */
function sentences(s: string): string[] {
  // No lookbehind (tsconfig targets ES5): a sentence is a run of text up to its end mark(s).
  return (String(s || '').match(/[^.!?…\n]+(?:[.!?…]+|$)/g) || [])
    .map(x => x.trim())
    .filter(Boolean)
}

/** Does this sentence appear (loosely) in the source? A translation of a sentence that IS in the source is never bolted on. */
function inSource(sentence: string, source: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9áéíóúñü ]+/gi, ' ').replace(/\s+/g, ' ').trim()
  const a = norm(sentence), b = norm(source)
  if (!a) return true
  if (b.includes(a)) return true
  // Same numbers and at least one shared 5+ letter word: the same sentence in the other language.
  const nums = (x: string): string[] => (x.match(/\d+/g) || [])
  const an = nums(a), bn = nums(b)
  return an.length > 0 && an.every(n => bn.includes(n))
}

/**
 * The translation with any bolted-on tail removed. `source` is the message that was translated.
 * Returns '' only when the whole output was bolted on (nothing to post). Line breaks in what is
 * kept survive: the tail is cut off the original string, not re-joined.
 *
 * SYMMETRY GUARD: if the AUTHOR ended with an offer ("avísame si necesitas algo"), its translation
 * ("let me know if you need anything") is the author's sentence and stays — the tail is only cut
 * when the source does not end that way.
 */
export function stripBoltedOn(source: string, out: string): string {
  let s = String(out || '').trim()
  const src = sentences(source)
  if (src.length && BOLTED_ON.test(src[src.length - 1])) return s
  for (let guard = 0; guard < 4; guard++) {
    const parts = sentences(s)
    if (!parts.length) return ''
    const last = parts[parts.length - 1]
    if (!BOLTED_ON.test(last) || inSource(last, source)) break
    const at = s.lastIndexOf(last)
    s = (at > 0 ? s.slice(0, at) : '').trim()
  }
  return s
}

/** For the retry decision: is there anything bolted on at all? */
export function hasBoltedOn(source: string, out: string): boolean {
  return stripBoltedOn(source, out) !== String(out || '').trim()
}
