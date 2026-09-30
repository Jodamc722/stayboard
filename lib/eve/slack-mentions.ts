// MENTIONS SURVIVE TRANSLATION (2026-09-30).
//
// A translated post used to read "…toca la puerta primero. @U0A6C31LV1C" — the raw Slack user id,
// because the text handed to the translator had already been flattened to plain @ids for Eve's own
// reading. So the person named in the original was neither readable nor pinged in the translation.
//
// This swaps every other person's tag for a stable placeholder the translator will leave alone
// (@PERSON1, @PERSON2…), then puts the real Slack tags back afterwards. Eve's own tag is dropped: the
// translation is posted by her, and a message that tagged her at the end must not tag her again.
// Anything the translator mangled or lost is appended at the end, so a person is never silently
// un-tagged. No imports, so lib/eve/__tests__/slack-mentions.test.mjs runs it with plain node.

export type Protected = { text: string; restore: (out: string) => string }

const MENTION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g
const CHANNEL = /<#([A-Z0-9]+)\|([^>]*)>/g
const LINK = /<(https?:\/\/[^|>]+)(?:\|([^>]*))?>/g

/**
 * The message with people's tags as placeholders, Eve's own tag removed, channels and links flattened
 * to readable text — and a restore() that puts every person's real tag back into the translation.
 */
export function protectMentions(raw: string, botUserId: string): Protected {
  const ids: string[] = []
  const text = String(raw || '')
    .replace(MENTION, (_m, id: string) => {
      if (botUserId && id === botUserId) return ' '
      let i = ids.indexOf(id)
      if (i < 0) { ids.push(id); i = ids.length - 1 }
      return '@PERSON' + (i + 1)
    })
    .replace(CHANNEL, '#$2')
    .replace(LINK, (_m, url: string, label?: string) => (label ? label + ' (' + url + ')' : url))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
  const restore = (out: string): string => {
    let s = String(out || '')
    const seen: boolean[] = ids.map(() => false)
    // Tolerate what a translator might do to a placeholder: spacing, case, a stray word between.
    s = s.replace(/@\s*PERSON\s*(\d+)/gi, (_m, n: string) => {
      const i = Number(n) - 1
      if (!ids[i]) return _m
      seen[i] = true
      return '<@' + ids[i] + '>'
    })
    const lost = ids.filter((_id, i) => !seen[i]).map(id => '<@' + id + '>')
    if (lost.length) s = s.replace(/\s+$/, '') + ' ' + lost.join(' ')
    return s.trim()
  }
  return { text, restore }
}
