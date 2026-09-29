// WHERE THE TAG SITS IS THE WHOLE INSTRUCTION — the pure half of lib/eve/slack-triage.ts.
//
// Kept in a file with NO imports so lib/eve/__tests__/tag-position.test.mjs can run it with plain
// node (no build). slack-triage.ts re-exports it; the Slack events route imports it from there.
//
// Jon, 2026-09-28: "in Slack if the tag is @Eve at the end, it translates to Spanish and never asks
// a question. If you have @Eve at the beginning, then it answers the question. Make sure that rule
// always works."
//
//   front  — the tag is the first thing said (a greeting or a colleague's tag before it is fine:
//            "Hi @Eve …", "Hola @Eve …", "@Roberto @Eve …"). She answers.
//   end    — the tag is the LAST thing said (trailing punctuation, emoji or "gracias" after it do
//            not count). She translates, and says nothing else.
//   middle — anywhere else ("can @Eve check this?"). Treated as FRONT: a tag inside a sentence is a
//            sentence addressed to her, and answering is the safe reading. The earlier rule sent
//            every non-front tag to the translator, so "can @Eve check 401" came back as Spanish
//            instead of an answer — that is the bug this fixes.
//   none   — no tag for her (a reply in her own room). The caller decides.
//
// THE TAIL, WIDENED (2026-09-28 audit, F35). "Ya terminé el 401 @Eve ✅", "… @Eve — gracias" and
// "… @Eve… " were read as MIDDLE, so she answered instead of translating: the tail only knew ASCII
// punctuation and surrogate-pair emoji. ✅ ✔ ❤ ☀ ⭐ are single BMP characters, the em-dash and the
// ellipsis are general punctuation, and ❤️ carries a variation selector. All of them are tail now.
export type TagPosition = 'front' | 'end' | 'middle' | 'none'

const GREETING = /^(?:(?:hi|hey|hello|hola|buenas|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|good\s+(?:morning|afternoon|evening)|team|equipo|por\s+favor|please|ok|okay)[\s,.!:;-]*)+/i

// What may follow the tag and still leave it "at the end": whitespace and ASCII punctuation; the
// general-punctuation block (U+2000–U+206F: em/en dash, ellipsis, curly quotes, the zero-width
// joiner inside emoji); BMP arrows, symbols and dingbats (U+2190–U+2BFF: ✅ ✔ ❤ ☀ ⭐ ➡); the
// emoji variation selector (U+FE0F).
const TAIL_CHARS = '\\s,.!?:;)\\]"\'*_~`\\u2000-\\u206F\\u2190-\\u2BFF\\uFE0F-'
// The words either language ends a message with.
const THANKS = '(?:muchas\\s+|mil\\s+)?gracias|thanks|thank you|thx|ty|please|por favor|pls|plz'

export function tagPosition(rawText: string, botUserId: string): TagPosition {
  if (!botUserId) return 'front'
  const tag = `<@${botUserId}>`
  const t = String(rawText || '').replace(/\s+/g, ' ').trim()
  if (!t.includes(tag)) return 'none'
  // Slack sometimes leads with a blockquote marker or stray punctuation; allow those through,
  // then a greeting, then other people's tags.
  const others = `<@(?!${botUserId}>)[A-Z0-9]+>`
  const lead = t.replace(/^[>\s*_~`-]+/, '').replace(GREETING, '').replace(new RegExp(`^(?:${others}[\\s,]*)+`), '')
  if (lead.startsWith(tag)) return 'front'
  // Trailing punctuation, emoji, "gracias"/"thanks"/"please" and other people's tags after the
  // tag still count as "at the end" — the tag is the last thing SAID.
  const tail = t
    .replace(new RegExp(`(?:[${TAIL_CHARS}]|:[a-z0-9_+-]+:|[\\uD800-\\uDFFF].|${others}|\\b(?:${THANKS})\\b)+$`, 'i'), '')
    .trim()
  if (tail.endsWith(tag)) return 'end'
  return 'middle'
}
