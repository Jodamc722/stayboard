// ONE PLACE WHERE DOOR CODES ARE STRIPPED FROM EVE'S TOOL RESULTS (2026-09-18 audit, P0-6).
//
// The door-code flow (lib/eve/door-code.ts) is careful: occupancy check, per-person policy, an
// approval that parks in Slack, an audit row for every release. Meanwhile guesty_config,
// guesty_fields, reservation_detail, custom_fields and guesty_live returned the raw custom-field
// list — with the door code and the per-stay access code in it — to any surface, including the
// Slack staff and vendor tiers. The gate was real and the side door was open.
//
// This runs on EVERY tool result in registry.runTool except the door-code tool itself, which
// returns a code only when the policy says it may. It strips by field id (the two Guesty custom
// fields that hold codes) and by name (anything that calls itself a door / entry / access /
// keypad / lock code), and it also catches the Guesty custom-field SHAPE ({fieldId, value}) so a
// code hiding under a generic `value` key is still caught when its sibling names it.
//
// THE SECOND PASS (2026-09-28 audit, F1). guesty_fields still handed out a live code three ways:
// an `example` column beside a code field (only value/val/text were redacted), `{field, value}`
// rows (nameOf never read `field`), and names like "Salto code" or "Lockbox" plus free text like
// "use code 4821" that the patterns did not know. Now a code field keeps only its name, id and
// counts; the names and the text patterns know salto / lockbox / smart lock / passcode /
// combination / pin and a bare "code: 4821"; and a confirmation code (HMABC123, or a Booking.com
// number after the word "confirmation") is left alone. lib/eve/__tests__/redact.test.mjs proves it.
//
// NO IMPORTS, ON PURPOSE. The self-test loads this file with plain node (no build), so it cannot
// pull in server-only or the Supabase client. The field id below is the one lib/eve/code-integrity
// exports as DOOR_CODE_FIELD; the self-test reads that file and fails if the two ever drift.

/** Standing door code on the LISTING — the same id as DOOR_CODE_FIELD in lib/eve/code-integrity.ts. */
export const DOOR_CODE_FIELD_ID = '695af1454ebbdc00137c3f41'
/** Per-reservation access code (changes per stay) — the second Guesty custom field that is a secret. */
export const RES_CODE_FIELD = '693adec2ab73940025856e56'

export const REDACTED = '[redacted — ask for the code through the door-code flow]'

// Field NAMES that hold a code. `door` and `entry` on their own were too broad — "Doorman",
// "Outdoor space", "Entry instructions", "Country" are not codes — so both must be followed by
// code / pin / combo. `keypad` alone stays: that is what the Guesty field is called. Widened
// 2026-09-28 with the lock brands and words the portfolio actually uses.
const KEY_RE = /(door|entry|access|gate|lock|garage)[\W_]{0,3}(code|pin|combo)|keypad|^\s*door\s*$|salto|lock[\s_-]*box|smart[\s_-]*lock|pass[\s_-]*code|key[\s_-]*code|combination|\bpin\b|^\s*(?:code|c[oó]digo)\s*$|c[oó]digo\s+de/i
// CODE FIELD OR DEVICE FIELD (2026-09-29 review, N12). Of the names above, only one that SAYS it holds
// a code — code / pin / passcode / combination / combo / keycode (or a secret) — is a code field, and
// every value in it is redacted. The rest name a DEVICE: "Keypad", "Lockbox", "Salto", "Smart lock",
// "Door". There the value is redacted only when it is code-shaped (holdsCodeDigits), so "Salto locks
// offline: 3", "Smart lock battery: 20%" and "Lockbox location: left rail" keep their values while
// "Keypad: 5512" and "Lockbox: 2468" still lose theirs.
const SAYS_CODE_RE = /(?:^|[^a-z0-9])(?:codes?|pins?|pass[\s_-]*codes?|combinations?|combos?|key[\s_-]*codes?|c[oó]digos?|secrets?)(?![a-z0-9])/i
// FAIL-SAFE: a value in a device field is a code unless, once the numbers that are plainly something
// else are taken out — a percentage, a date, a time, a phone number, money, a unit number — fewer
// than three digits are left. So "20%", 3, "installed 2025-03-01" and "by unit 1102" keep their
// values, while "5512", "2468 on the left rail", "551#", "12-34-56", "4 8 2 1" and "L-2468" do not.
const HARMLESS_NUMBERS: RegExp[] = [
  /\d+(?:\.\d+)?\s?%/g,                                              // 20%, 100 %
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,                                      // 2025-03-01
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,                             // 9/28, 09/28/2026
  /\b\d{1,2}:\d{2}\b/g,                                              // 10:30
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,           // 305-555-1234
  /\$\s?\d[\d,]*(?:\.\d+)?/g,                                        // $120
  /\b(?:unit|apt|apartment|suite|ste|room|rm|floor|level)\.?\s*#?\s*\d+/gi, // unit 1102
]
function holdsCodeDigits(v: any): boolean {
  if (typeof v !== 'string' && typeof v !== 'number') return false
  let s = String(v)
  for (const re of HARMLESS_NUMBERS) s = s.replace(re, ' ')
  return (s.match(/\d/g) || []).length >= 3
}
type CodeKind = 'code' | 'device' | null
/** 'code' — a name that says it holds a code; 'device' — a lock or keypad named alone; null — neither. */
export function codeFieldNameKind(name: any): CodeKind {
  const n = String(name || '')
  if (!KEY_RE.test(n)) return null
  return SAYS_CODE_RE.test(n) ? 'code' : 'device'
}
// Keys that mention a code by NAME. `access` on its own is too broad (accessRole, access_role,
// "accessible"), and `door` on its own catches doorman / outdoor / indoor, so every word here has to
// be paired with code / pin / secret. `res_code` is the per-stay Guesty field, not a confirmation
// code (confirmationCode does not match).
const BARE_KEY_RE = /(door|keypad|lock|entry|access|gate|garage)[\s_-]?(code|pin)|^door$|^res(ervation)?[\s_-]?code$|access[\s_-]?secret|^pin([\s_-]?code)?$|pass[\s_-]?code|^lock[\s_-]?box([\s_-]?(code|pin|combo))?$|^salto([\s_-]?(code|pin|key))?$|smart[\s_-]?lock[\s_-]?(code|pin)|^combination$|^c[oó]digo$/i
/** The same split for a KEY: `door_code` holds a code; `lockbox`, `salto` and `door` name a device. */
function keyKind(k: string): CodeKind {
  if (!k || !BARE_KEY_RE.test(k)) return null
  return SAYS_CODE_RE.test(k) ? 'code' : 'device'
}
// Inside a code field, these keys say WHICH field it is and how often it is filled — never what it
// holds. Every other scalar in a code field is redacted, whatever it is called ("example", "value",
// "sample", "current"…).
const CODE_FIELD_KEEP = /^(?:_?id|field_?id|fieldid|field|field_?name|fieldname|name|display_?name|displayname|label|title|key|slug|merge_?tag|type|object|target|lives_on|tracked|is_?public|ispublic|required|filled(?:_on(?:_units)?)?|coverage(?:_pct)?|count|pct|units(?:_scanned)?|scope)$/i

// Free text that STATES a code.
//   WINDOW — a strong keyword ("door code", "gate code", "keypad code", "código de la puerta") and
//            every run of 3+ digits in the next ~40 characters of the same sentence. "door code for
//            1102 is 4821" loses both numbers: a unit number in a sentence about a code is a fair
//            price. ("keypad" alone is NOT a window: "Keypad battery — 1102" is a task name.)
//   TIGHT  — a weaker keyword with the digits right after it: "lockbox 2468", "pin 4821",
//            "Salto 739201", "passcode: 1234", "combination 5566", "keypad: 5678#", "code: 4821#",
//            "código 4821". A bare "code" is left alone when the word before it says what kind of
//            code it is not — a confirmation, reservation, booking, promo, zip, area, error or status
//            code. A confirmation code like HMABC123 never matches: the digits must come first.
//   BEFORE — "4821 is the door code".
const WINDOW_RE = /\b(?:(?:door|entry|access|lock|gate|garage|keypad)\s*(?:code|pin|combo)|c[oó]digo\s+de\s+(?:la\s+)?(?:puerta|entrada|acceso|cerradura|port[oó]n))/gi
const TIGHT_RE = /(\b[a-z]+\s+)?\b(lock\s*box|salto|pass\s*code|combination|keypad|pin|c[oó]digo|code)(?:\s+(?:code|pin|number|num|no\.?|#))?\s*(?:is|es|was|:|#|-|=)?\s*(\d[\d#*]{2,})/gi
const BEFORE_RE = /(\d[\d#*]{2,})(\s+(?:is|es|=)\s+(?:the\s+|el\s+|la\s+)?(?:(?:door|entry|access|lock|gate|garage)\s*(?:code|pin|combo)|keypad|c[oó]digo|lock\s*box|passcode))/gi
// ("reservation" is not on this list: the Salto / Botanica per-stay DOOR code is a reservation field.)
const NOT_A_DOOR = /^(?:confirmation|confirm|conf|booking|promo|promotional|discount|coupon|voucher|zip|postal|post|area|country|dial|error|status|response|http|verification|verify|tracking|reference|ref|order|invoice|tax|flight|qr|bar|source)$/i
const DIGITS = /[0-9#*]{3,}/g

function idOf(c: any): string {
  const fid = c && typeof c.fieldId === 'object' ? (c.fieldId?._id || c.fieldId?.id) : c?.fieldId
  return String(fid || c?.field_id || c?.id || '')
}
const pickStr = (x: any): string => (typeof x === 'string' ? x : '')
function nameOf(c: any): string {
  const f = c && typeof c.fieldId === 'object' ? c.fieldId : null
  // `field` / `field_name` are the shapes Eve's own tools emit (guesty_fields rows); the rest are
  // Guesty's. `key` is deliberately NOT read: half the objects in the app have a `key`, and an
  // automation called "door-code-…" must not be mistaken for a code field.
  return pickStr(c?.fieldName) || pickStr(c?.field_name) || pickStr(c?.field) || pickStr(c?.name) || pickStr(c?.label)
    || pickStr(f?.name) || pickStr(f?.label) || pickStr(f?.key) || ''
}

// A custom-field ENTRY carries its content under one of these (or is keyed by fieldId). An object
// that merely has a code-ish label — "Release a door code" on the agent-mode action list — holds no
// value and is not a field, so its other keys are left alone.
const VALUE_KEY_RE = /^(?:value|val|values|text|example|sample|current|default|code|pin|data)$/i

/** Custom-field ids learned from the definitions: names that hold a code, and names of a device. */
type FieldIds = { code: Record<string, true> | null; device: Record<string, true> | null }

/** A Guesty custom-field entry whose id or name marks it as a code field or a device field. */
function codeFieldKind(c: any, ids: FieldIds): CodeKind {
  if (!c || typeof c !== 'object') return null
  const id = idOf(c)
  if (id === DOOR_CODE_FIELD_ID || id === RES_CODE_FIELD) return 'code'
  if (id && ids.code && ids.code[id]) return 'code'
  const fieldish = 'fieldId' in c || 'field_id' in c || Object.keys(c).some(k => VALUE_KEY_RE.test(k))
  const byName = fieldish ? codeFieldNameKind(nameOf(c)) : null
  if (byName) return byName
  if (id && ids.device && ids.device[id]) return 'device'
  return null
}

/** Is this the NAME of a code or device field? (Used to learn the ids; codeFieldNameKind says which.) */
export function isCodeFieldName(name: any): boolean {
  return KEY_RE.test(String(name || ''))
}

const redactDigits = (x: string) => (/\d/.test(x) ? '[redacted]' : x)
// "door code for unit 1102 is 4821": the unit keeps its number, the code does not (N12).
const UNIT_BEFORE_RE = /\b(?:unit|apt|apartment|suite|ste|room|rm)\.?\s*#?\s*$/i

function scrubWindow(s: string): string {
  WINDOW_RE.lastIndex = 0
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = WINDOW_RE.exec(s))) {
    const start = m.index + m[0].length
    if (start < last) continue
    let end = Math.min(s.length, start + 40)
    const stop = s.slice(start, end).search(/[.!?;](?:\s|$)|\n/)
    if (stop >= 0) end = start + stop
    const seg = s.slice(start, end)
    out += s.slice(last, start) + seg.replace(DIGITS, (d: string, at: number) => (UNIT_BEFORE_RE.test(seg.slice(Math.max(0, at - 14), at)) ? d : redactDigits(d)))
    last = end
    if (WINDOW_RE.lastIndex < end) WINDOW_RE.lastIndex = end
  }
  return last ? out + s.slice(last) : s
}

function scrubText(s: string): string {
  if (!s || !/\d{3}/.test(s)) return s   // nothing can state a code without three digits in a row
  let out = scrubWindow(s)
  out = out.replace(TIGHT_RE, (m: string, pre: string | undefined, kw: string, digits: string) => {
    if (pre && /^(?:code|c[oó]digo)$/i.test(kw) && NOT_A_DOOR.test(pre.trim())) return m
    // Nine digits or more is a phone or a Booking.com / Expedia confirmation number, not a keypad.
    if (digits.replace(/[#*]/g, '').length >= 9) return m
    return m.slice(0, m.length - digits.length) + '[redacted]'
  })
  out = out.replace(BEFORE_RE, (_m: string, digits: string, rest: string) => redactDigits(digits) + rest)
  return out
}

/** Does this text state a door / access code? saveMemory refuses such text (2026-09-28, B-7). */
export function looksLikeDoorCode(text: any): boolean {
  const s = String(text || '')
  return !!s && scrubText(s) !== s
}

// A CODE IS NEVER A MEMORY, HOWEVER IT IS PHRASED (2026-09-29 review, N5). The redactor's patterns
// need a code phrased the usual ways; "The code for 402 is 4821", "the gate at Salato opens with
// 4821", "use 4821# at the front door" or "Keypad at 17 West is 1234#" slipped past them and were
// filed. A memory is refused when a lock word sits within ~24 characters of a 4-8 digit run (an
// optional # or * after it). What is NOT a code run: a unit number ("unit 1102"), a year after
// in / since ("since 2024"), a date, a phone number, money, a decimal, a percentage, or a run glued
// to letters (a confirmation code). A zip / area / confirmation "code" is not a lock word.
const MEM_CODE_WORD_RE = /\b(?:doors?|gates?|locks?|lockbox(?:es)?|keypads?|codes?|pins?|entry|entries|combos?|salto|access|passcodes?|keycodes?|c[oó]digos?)\b/gi
const MEM_RUN_RE = /(?<![A-Za-z\u00C0-\u024F0-9$.,\/-])\d{4,8}(?![0-9%]|[.,\/-]\d)[#*]?/g
const MEM_PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g
const MEM_UNIT_BEFORE_RE = /\b(?:unit|units|apt|apartment|suite|ste|room|rm|floor|level)\.?\s*#?\s*$/i
const MEM_YEAR_BEFORE_RE = /\b(?:in|since|during|until|till|before|after)\s+$/i
const MEM_NEAR = 24

/** The [start, end) of every 4-8 digit run that sits within ~24 characters of a lock word. */
function codeRuns(raw: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (!/\d{4}/.test(raw)) return out
  // Phone numbers out first, same length, so every position below still lines up.
  const s = raw.replace(MEM_PHONE_RE, (m: string) => ' '.repeat(m.length))
  const words: Array<[number, number]> = []
  MEM_CODE_WORD_RE.lastIndex = 0
  let w: RegExpExecArray | null
  while ((w = MEM_CODE_WORD_RE.exec(s))) {
    if (/^(?:codes?|c[oó]digos?)$/i.test(w[0])) {
      const prev = /([a-z]+)\s*$/i.exec(s.slice(Math.max(0, w.index - 20), w.index))
      if (prev && NOT_A_DOOR.test(prev[1])) continue
    }
    words.push([w.index, w.index + w[0].length])
  }
  if (!words.length) return out
  MEM_RUN_RE.lastIndex = 0
  let d: RegExpExecArray | null
  while ((d = MEM_RUN_RE.exec(s))) {
    const before = s.slice(Math.max(0, d.index - 16), d.index)
    if (MEM_UNIT_BEFORE_RE.test(before)) continue
    if (/^(?:19|20)\d\d$/.test(d[0]) && MEM_YEAR_BEFORE_RE.test(before)) continue
    const a = d.index, b = d.index + d[0].length
    for (const [x, y] of words) {
      const gap = x >= b ? x - b : a >= y ? a - y : 0
      if (gap <= MEM_NEAR) { out.push([a, b]); break }
    }
  }
  return out
}

/** Is a lock / door / code word within ~24 characters of a 4-8 digit run? saveMemory refuses it. */
export function codeNearDigits(text: any): boolean {
  return codeRuns(String(text == null ? '' : text)).length > 0
}

/** The same runs, masked — for text that is kept or replayed rather than refused (scrubStoredText). */
export function maskCodeNearDigits(text: any): string {
  const s = String(text == null ? '' : text)
  const runs = codeRuns(s)
  if (!runs.length) return s
  let out = ''
  let last = 0
  for (const [a, b] of runs) { out += s.slice(last, a) + '[redacted]'; last = b }
  return out + s.slice(last)
}

/** A scalar under a code or device name: a code field loses it; a device field only when code-shaped. */
const hides = (kind: CodeKind, val: any) => kind === 'code' || (kind === 'device' && holdsCodeDigits(val))

/**
 * Is this custom-field VALUE a code, judged by the field's name? A field that says it holds a code
 * ("Door code", "Gate PIN", "Lockbox combo") — always; a lock or keypad named alone ("Keypad",
 * "Lockbox", "Salto") — only when the value is code-shaped, so "Smart lock battery: 20%" stays. For a
 * screen that lists a unit's fields to people who may not see codes (the FAQ desk, 2026-09-29).
 */
export function isCodeValue(fieldName: any, value: any): boolean {
  return hides(codeFieldNameKind(fieldName), value)
}

function walk(v: any, keyHint: string, ids: FieldIds): any {
  if (typeof v === 'string') return v && hides(keyKind(keyHint), v) ? REDACTED : scrubText(v)
  if (typeof v === 'number') return hides(keyKind(keyHint), v) ? REDACTED : v
  if (Array.isArray(v)) return v.map(x => walk(x, keyHint, ids))
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v
    const kind = codeFieldKind(v, ids)
    if (kind) {
      // Keep the entry (so the model knows a code EXISTS and how often it is filled) but nothing it
      // says: every scalar except the field's name, id and counts is redacted — in a device field,
      // every code-shaped scalar.
      const out: Record<string, any> = {}
      for (const k of Object.keys(v)) {
        const val = v[k]
        if (CODE_FIELD_KEEP.test(k)) out[k] = walk(val, k, ids)
        else if (((typeof val === 'string' && val !== '') || typeof val === 'number') && hides(kind, val)) out[k] = REDACTED
        else out[k] = walk(val, k, ids)
      }
      return out
    }
    const out: Record<string, any> = {}
    for (const k of Object.keys(v)) {
      const val = v[k]
      if ((typeof val === 'string' || typeof val === 'number') && val !== '' && val != null && hides(keyKind(k), val)) { out[k] = REDACTED; continue }
      out[k] = walk(val, k, ids)
    }
    return out
  }
  return v
}

const idSet = (list?: string[]) => (list && list.length ? list.reduce((m, id) => { m[String(id)] = true; return m }, {} as Record<string, true>) : null)

/**
 * Strip door / access codes from any tool result. Never throws; on anything unexpected the
 * original value comes back untouched (the failure mode of a redactor must not be a crash that
 * hides the whole answer). `codeFieldIds` are further Guesty custom-field ids known to hold a code
 * (read from the field definitions by the registry), so a raw `{fieldId, value}` entry with no name
 * beside it is still caught; `deviceFieldIds` are the ids of fields named for a lock or keypad, whose
 * values are hidden only when code-shaped.
 */
export function redactSensitive<T>(value: T, opts: { codeFieldIds?: string[]; deviceFieldIds?: string[] } = {}): T {
  const ids: FieldIds = { code: idSet(opts.codeFieldIds), device: idSet(opts.deviceFieldIds) }
  try { return walk(value, '', ids) as T } catch { return value }
}

// ── Released codes in stored text (2026-09-28, B-6) ─────────────────────────────────────────────

export const RELEASED_CODE_MARK = '[door code released — see Eve actions]'

/**
 * A code handed to a Direct person belongs in the reply they read and nowhere else: not in the chat
 * log (eve_chats.answer) and not in the Telegram transcript that is replayed into later prompts.
 * Every occurrence of each released code is replaced with a pointer to the audit trail.
 */
export function scrubReleasedCodes(text: string, codes: string[]): string {
  let out = String(text || '')
  const list = codes.map(c => String(c || '').trim()).filter(c => c.length >= 3).sort((a, b) => b.length - a.length)
  for (const c of list) {
    // THE DIGITS, HOWEVER THEY ARE WRITTEN (2026-09-29 review, N6). "4821#" released and the reply
    // saying "4 8 2 1 #", "*4821" or "48-21" kept the code: only the exact string was replaced.
    const digits = c.replace(/[^0-9]/g, '')
    if (digits.length >= 3) {
      const re = new RegExp('(?<![0-9])[#*]*' + digits.split('').join('[\\s#*.-]*') + '[#*]*(?![0-9])', 'g')
      out = out.replace(re, RELEASED_CODE_MARK)
    }
    // A code with letters in it (or too few digits to match on) is also replaced exactly as written.
    if (digits.length < 3 || /[^0-9#*\s]/.test(c)) out = out.split(c).join(RELEASED_CODE_MARK)
  }
  return out
}

/** The free-text door-code redactor on its own, for text that is kept or replayed. Never throws. */
export function redactCodeText(s: any): string {
  const t = String(s == null ? '' : s)
  try { return scrubText(t) } catch { return t }
}

/**
 * TEXT THAT IS KEPT OR REPLAYED — the chat log, a transcript, an earlier answer handed back in, a
 * payload that will be filed (2026-09-29 review, N6): every released code in any spelling, then the
 * text redactor, then any lock word next to a 4-8 digit number. Stricter than a tool result on
 * purpose; a unit number in a sentence about a door is a fair price in a log. Never throws.
 */
export function scrubStoredText(text: any, released: string[] = []): string {
  const t = String(text == null ? '' : text)
  try { return maskCodeNearDigits(redactCodeText(released.length ? scrubReleasedCodes(t, released) : t)) } catch { return t }
}

/** Every string inside a tool's arguments with the released codes taken out. Never throws. */
export function scrubReleasedInValue<T>(value: T, released: string[]): T {
  if (!released.length) return value
  const go = (v: any): any => {
    if (typeof v === 'string') return scrubReleasedCodes(v, released)
    if (Array.isArray(v)) return v.map(go)
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, any> = {}
      for (const k of Object.keys(v)) out[k] = go(v[k])
      return out
    }
    return v
  }
  try { return go(value) as T } catch { return value }
}

// ── Money in free text (2026-09-28, F9) ─────────────────────────────────────────────────────────

const MONEY_TEXT_RE = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b|\bUSD\s?\d[\d,]*(?:\.\d+)?/gi
export const MONEY_MASK = '$[hidden]'

/** "$1,200", "1200 dollars", "USD 950" → "$[hidden]". For people not cleared for dollar figures. */
export function maskMoneyText(s: string): string {
  return String(s == null ? '' : s).replace(MONEY_TEXT_RE, () => MONEY_MASK)
}

/** maskMoneyText over every string in a tool result. Never throws. */
export function maskMoneyStrings<T>(value: T): T {
  const go = (v: any): any => {
    if (typeof v === 'string') return maskMoneyText(v)
    if (Array.isArray(v)) return v.map(go)
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, any> = {}
      for (const k of Object.keys(v)) out[k] = go(v[k])
      return out
    }
    return v
  }
  try { return go(value) as T } catch { return value }
}

// ── Guest details in a vendor room (2026-09-28, F2 / B-10) ──────────────────────────────────────

export const GUEST_HIDDEN = '(hidden in this room)'
// Keys that carry a guest's name, contact details or own words.
const GUEST_KEY_RE = /^(?:guest|guest_?name|guestname|guests_?name|guest_?names|same_?day_?guest|arriving_?guest|guest_?excerpt|guest_?words|guest_?email|guest_?phone|email|e_?mail|phone|phone_?number|mobile|quote|quotes|excerpt|permission_?quotes)$/i
// Keys that are the guest's NAME — collected so the same name can be taken out of free text too.
const GUEST_NAME_KEY_RE = /^(?:guest|guest_?name|guestname|guests_?name|same_?day_?guest|arriving_?guest)$/i
// nextGuest on the day sheet is a time or a date ("4:00 PM today", "Oct 2"), not a name. It is
// hidden only when it does not look like one.
const NEXT_GUEST_KEY_RE = /^next_?guest$/i
const REVIEW_TEXT_KEY_RE = /^(?:content|text|comment|review|body|public_?review|publicreview)$/i
const RATING_KEY_RE = /^(?:rating|stars|score|overall_?rating)$/i

/**
 * A room with an outside company in it gets the operational answer without the guest: names,
 * emails, phones, the guest's own words and review text are replaced, and any guest name found in
 * the result is taken out of the free text around it (a unit_status note, an exception's detail).
 * Never throws.
 */
export function redactGuestPII<T>(value: T): T {
  try {
    const names: Record<string, true> = {}
    let hidden = 0
    const collect = (v: any, depth: number) => {
      if (!v || typeof v !== 'object' || depth > 8) return
      if (Array.isArray(v)) { for (const x of v) collect(x, depth + 1); return }
      for (const k of Object.keys(v)) {
        const x = v[k]
        if (GUEST_NAME_KEY_RE.test(k) && typeof x === 'string') { const n = x.trim(); if (n.length >= 3 && !/^guest$/i.test(n)) names[n] = true }
        else if (x && typeof x === 'object') collect(x, depth + 1)
      }
    }
    collect(value, 0)
    const nameList = Object.keys(names).sort((a, b) => b.length - a.length)
    // WHOLE WORDS ONLY (2026-09-29 review, N10): a guest called "Ana" turned "Management" into
    // "Mthe guestgement". A word boundary that knows accented letters, so "José" still matches.
    const nameRes = nameList.map(n => new RegExp('(?<![\\p{L}\\p{N}_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu'))
    const scrubNames = (s: string) => {
      let out = s
      for (const re of nameRes) out = out.replace(re, () => { hidden++; return 'the guest' })
      return out
    }
    const go = (v: any): any => {
      if (typeof v === 'string') return nameRes.length ? scrubNames(v) : v
      if (Array.isArray(v)) return v.map(go)
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const isReview = Object.keys(v).some(k => RATING_KEY_RE.test(k))
        const out: Record<string, any> = {}
        for (const k of Object.keys(v)) {
          const x = v[k]
          if (x != null && x !== '' && (GUEST_KEY_RE.test(k) || (isReview && REVIEW_TEXT_KEY_RE.test(k) && typeof x === 'string'))) { out[k] = GUEST_HIDDEN; hidden++; continue }
          if (NEXT_GUEST_KEY_RE.test(k) && typeof x === 'string' && x && !/\d/.test(x)) { out[k] = GUEST_HIDDEN; hidden++; continue }
          out[k] = go(x)
        }
        return out
      }
      return v
    }
    const out = go(value)
    if (hidden && out && typeof out === 'object' && !Array.isArray(out)) out._guest_redacted = 'Guest names, contact details and guests\' own words are hidden in this room. Answer the operational question without them.'
    return out as T
  } catch { return value }
}

// A vendor room's PROMPT, not only its tool results (2026-09-29 review, N3/N4). Whoever asks in a room
// with an outside company in it, no memory about a person or a guest goes in: people mappings and
// person-scoped rows, the OTA channel playbook (guest refunds and money), anything that talks about a
// guest, and anything carrying an email address or a phone number. Deliberately blunt — a rule
// about guests in general is lost in that room too, and a vendor's jobs do not need it.
const MEM_GUEST_RE = /\bguests?\b|\bhu[eé]sped/i
const MEM_CONTACT_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/
export function isGuestOrPersonMemory(m: { kind?: any; scope?: any; text?: any; why?: any }): boolean {
  const kind = String(m?.kind || '').toLowerCase()
  const scope = String(m?.scope || '').toLowerCase()
  if (kind === 'person' || scope.startsWith('person:') || scope.startsWith('channel:')) return true
  const text = String(m?.text || '')
  // `why` is provenance and often names the colleague who taught it ("said in chat by x@…"), so only
  // the memory's own text is checked for contact details.
  return MEM_GUEST_RE.test(text + ' ' + String(m?.why || '')) || MEM_CONTACT_RE.test(text)
}
