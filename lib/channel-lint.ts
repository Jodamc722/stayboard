// THE CHANNEL LINT — one check, run before ANY copy leaves for Guesty (single-listing push, bulk
// property/portfolio push, and shown on the Optimize page as you type).
//
// Jon, 2026-11-02: "look into optimizing from app to Guesty and to different channels, so different
// formats that Guesty allows … let's keep [one copy everywhere] but make sure optimize."
//
// WHERE OUR WORDS ACTUALLY GO (research 2026-11-02, claude/channel-formats-and-bulk-reaudit-2026-11-02.md):
//   Airbnb      every section in its own slot; title ≤50; summary HARD 500; photo ORDER does not sync
//   Vrbo        ONE description = every section concatenated, 400–10,000 BYTES (newlines count as
//               <br>, overflow silently truncated); only the first 150 chars of house rules; headline
//               20–80 by Guesty's rule, 20–40 by Vrbo's own page — ≤50 keeps both channels happy
//   Booking.com takes NO description from Guesty (auto-generated from facilities + location); the title
//               syncs once at first publish
//   Expedia     all content managed in Expedia
//   Guesty site / Google VR  shows everything as written
//
// WHAT GETS CONTENT REJECTED (Guesty's own list, enforced on every channel): email, URL, phone number,
// emoji/symbols, "Mr"/"Ms"-style abbreviations, repeated special characters, ALL-CAPS words, and two
// words joined by a dot ("word.word"). Airbnb adds: no 3+ capitalised words in a row, no brand/OTA
// names, no cancellation or payment terms in the body. Vrbo/Expedia policy adds: no HTML, no access
// details (door codes), no promotions outside structured fields.
//
// Pure: no I/O. `block` = Guesty or a channel will refuse or silently truncate it; `warn` = allowed
// but costs conversion or is read differently on one channel.

export type CopyField = 'title' | 'summary' | 'space' | 'access' | 'interactionWithGuests' | 'neighborhood' | 'transit' | 'notes' | 'houseRules'
export type Severity = 'block' | 'warn'
export type LintHit = { field: CopyField | 'vrbo'; severity: Severity; message: string }

export const TITLE_MAX = 50
export const TITLE_MIN_VRBO = 20
export const SUMMARY_MAX = 500
export const VRBO_MIN_BYTES = 400
export const VRBO_MAX_BYTES = 10_000
export const VRBO_HOUSE_RULES_CHARS = 150

/** Which channels a field's text reaches, for the "where this goes" strip. */
export type ChannelFate = { channel: 'Airbnb' | 'Vrbo' | 'Booking.com' | 'Expedia' | 'Site & Google'; fate: 'own' | 'combined' | 'partial' | 'none'; note: string }
export function fateOf(field: CopyField): ChannelFate[] {
  const vrbo: ChannelFate = field === 'title'
    ? { channel: 'Vrbo', fate: 'own', note: 'Headline (20–80 chars; Vrbo’s own editor says 40)' }
    : field === 'houseRules'
      ? { channel: 'Vrbo', fate: 'partial', note: 'Only the first 150 characters sync' }
      : { channel: 'Vrbo', fate: 'combined', note: 'Joined with every other section into one description (400–10,000 bytes)' }
  const booking: ChannelFate = field === 'title'
    ? { channel: 'Booking.com', fate: 'partial', note: 'Property name syncs once, at first publish' }
    : { channel: 'Booking.com', fate: 'none', note: 'Booking.com writes its own description from facilities and location' }
  return [
    { channel: 'Airbnb', fate: 'own', note: field === 'title' ? 'Title (≤50)' : field === 'summary' ? 'Listing description (hard 500)' : 'Its own section' },
    vrbo,
    booking,
    { channel: 'Expedia', fate: 'none', note: 'Content is managed in Expedia' },
    { channel: 'Site & Google', fate: 'own', note: 'Shown as written' },
  ]
}

const LABEL: Record<CopyField, string> = {
  title: 'Title', summary: 'Summary', space: 'About the space', access: 'Guest access', interactionWithGuests: 'Interaction with guests',
  neighborhood: 'Neighborhood', transit: 'Getting around', notes: 'Other things to note', houseRules: 'House rules',
}

/** Vrbo counts bytes of the formatted string; a newline becomes <br> (+3 bytes). */
export function vrboBytes(text: string): number {
  const withBreaks = String(text || '').replace(/\r\n|\r|\n/g, '<br>')
  return new TextEncoder().encode(withBreaks).length
}

/** The Vrbo description as Guesty will most likely assemble it (order undocumented; this is the Airbnb section order). */
export const VRBO_ORDER: CopyField[] = ['summary', 'space', 'access', 'interactionWithGuests', 'neighborhood', 'transit', 'notes']
export function vrboCombined(copy: Partial<Record<CopyField, string>>): string {
  const parts = VRBO_ORDER.map(k => String(copy[k] || '').trim()).filter(Boolean)
  const hr = String(copy.houseRules || '').trim()
  if (hr) parts.push(hr.slice(0, VRBO_HOUSE_RULES_CHARS))
  return parts.join('\n\n')
}

/** Content Guesty refuses on every channel, as plain reasons. */
export function rejectReasons(s: string): string[] {
  const out: string[] = []
  if (!s) return out
  if (/[\w.-]+@[\w.-]+\.\w+/.test(s)) out.push('an email address')
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|co)\b/i.test(s)) out.push('a web address')
  if (/(?:\+?\d[\s().-]?){7,}\d/.test(s)) out.push('a phone number')
  if (/[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(s)) out.push('an emoji')
  if (/[!*#$%^&_~]{2,}|[!?]{2,}/.test(s)) out.push('repeated symbols (!!! / ***)')
  if (/\b(Mr|Mrs|Ms|Dr|Jr|Sr|St)\.\s/.test(s)) out.push('an abbreviation like “Mr.” (channels reject it — write the word out)')
  // "word.word" — a sentence end with no space after the full stop. Decimal numbers and ellipses are fine.
  if (/[a-z]{2,}\.[A-Za-z]{2,}/.test(s) && !/\.(com|net|org|io|co)\b/i.test(s)) out.push('a full stop with no space after it (“word.word”)')
  return out
}

/** ALL-CAPS words, ignoring short codes and known room/bed tokens guests search for. */
const CAPS_OK = new Set(['TV', 'AC', 'A/C', 'BBQ', 'USA', 'FL', 'NYC', 'HVAC', 'OK', 'ID', 'WIFI', 'HDTV', 'BR', 'BA', 'EV', 'VIP', 'SUV', 'ATM', 'A1A', 'I-95', 'US1', 'SW', 'NE', 'NW', 'SE', 'PM', 'AM', 'ET', 'QR'])
export function capsWords(s: string): string[] {
  return (String(s || '').match(/\b[A-Z][A-Z0-9/&-]{3,}\b/g) || []).filter(w => !CAPS_OK.has(w) && !/^\d/.test(w))
}
function capsRun(s: string): boolean {
  // Three or more consecutive words that are each capitalised and at least 2 letters (Airbnb's body rule), excluding Title Case names is impossible here — so only flag ALL-CAPS runs.
  return /\b[A-Z]{2,}\s+[A-Z]{2,}\s+[A-Z]{2,}\b/.test(String(s || ''))
}

const OTA_NAMES = /\b(airbnb|vrbo|booking\.com|expedia|homeaway|tripadvisor|hotels\.com)\b/i
const MONEY_TERMS = /\b(cancellation policy|non-?refundable|refund(?:s|able)?|security deposit of|\$\s?\d{2,}|per night|nightly rate|discount|promo(?:tion)?|coupon|book direct)\b/i
const ACCESS_SECRETS = /\b(door code|lock code|keypad code|lockbox code|the code is|key is (?:under|in|behind)|gate code)\b|\b\d{4,6}#?\b(?=.*\b(code|keypad|lockbox|door)\b)/i
const HTML = /<\/?[a-z][^>]*>/i

/**
 * Lint one field. `whole` = the full set, for the Vrbo combined checks (run once via lintCopy).
 */
export function lintField(field: CopyField, raw: string): LintHit[] {
  const text = String(raw || '')
  const out: LintHit[] = []
  if (!text.trim()) return out
  const label = LABEL[field]
  const push = (severity: Severity, message: string) => out.push({ field, severity, message })

  for (const r of rejectReasons(text)) push('block', `${label} contains ${r} — Guesty will not sync it to any channel.`)
  if (HTML.test(text)) push('block', `${label} contains HTML tags — Vrbo and Airbnb strip or reject them. Use plain paragraphs and “- ” bullets.`)

  if (field === 'title') {
    if (text.length > TITLE_MAX) push('block', `Title is ${text.length} characters — Airbnb and Guesty cap it at ${TITLE_MAX}.`)
    if (text.trim().length < TITLE_MIN_VRBO) push('warn', `Title is under ${TITLE_MIN_VRBO} characters — Vrbo will pad it with description text. Aim for 42–50.`)
    if (text === text.toUpperCase() && /[A-Z]/.test(text)) push('block', 'Title is all caps — Airbnb, Vrbo and Booking.com all reject that.')
    else if (text === text.toLowerCase() && /[a-z]/.test(text)) push('warn', 'Title is all lowercase — Vrbo rejects all-lowercase headlines.')
    const caps = capsWords(text)
    if (caps.length) push('block', `Title has an ALL-CAPS word (${caps.join(', ')}) — Airbnb rejects it; use Title Case.`)
    if (/\d{5,}/.test(text)) push('block', 'Title has a run of 5+ digits — Booking.com reads it as a phone number and rejects it.')
    if (OTA_NAMES.test(text)) push('block', 'Title names another booking site — channels reject that.')
    return out
  }

  if (field === 'summary' && text.length > SUMMARY_MAX) push('block', `Summary is ${text.length} characters — Airbnb’s hard limit is ${SUMMARY_MAX}; everything past it is cut.`)
  const caps = capsWords(text)
  if (caps.length) push('warn', `${label} has ALL-CAPS word${caps.length > 1 ? 's' : ''} (${caps.slice(0, 3).join(', ')}) — Airbnb flags more than a few capitals; write it in sentence case.`)
  if (capsRun(text)) push('block', `${label} has three or more ALL-CAPS words in a row — Airbnb rejects that.`)
  if (OTA_NAMES.test(text)) push('warn', `${label} names another booking site — Airbnb and Vrbo reject competitor or OTA names in copy.`)
  if (MONEY_TERMS.test(text)) push('warn', `${label} mentions prices, discounts or refund terms — Airbnb and Vrbo want those only in the structured fields; remove them from the copy.`)
  if (ACCESS_SECRETS.test(text)) push('block', `${label} looks like it contains access details (a code or key location) — never in public copy.`)
  if (field === 'houseRules' && text.length > VRBO_HOUSE_RULES_CHARS) push('warn', `House rules: Vrbo shows only the first ${VRBO_HOUSE_RULES_CHARS} characters — put the rules that matter most first.`)
  return out
}

/** Lint a whole copy set: every field plus the Vrbo combined-description checks. */
export function lintCopy(copy: Partial<Record<CopyField, string>>): LintHit[] {
  const out: LintHit[] = []
  for (const k of Object.keys(copy) as CopyField[]) out.push(...lintField(k, copy[k] || ''))
  const combined = vrboCombined(copy)
  if (combined) {
    const bytes = vrboBytes(combined)
    // Only judge the floor when the set carries the sections Vrbo would combine — a one-field edit is not a whole description.
    const sections = VRBO_ORDER.filter(k => String(copy[k] || '').trim()).length
    if (bytes > VRBO_MAX_BYTES) out.push({ field: 'vrbo', severity: 'block', message: `Vrbo’s single description would be ${bytes.toLocaleString()} bytes — over its 10,000 limit, and Vrbo truncates silently. Trim the longest sections.` })
    else if (sections >= 4 && bytes < VRBO_MIN_BYTES) out.push({ field: 'vrbo', severity: 'warn', message: `Vrbo’s combined description would be only ${bytes} bytes — under its 400 minimum.` })
  }
  return out
}

export const blocks = (hits: LintHit[]) => hits.filter(h => h.severity === 'block')
export const warns = (hits: LintHit[]) => hits.filter(h => h.severity === 'warn')
