// REPAIRING JSON A MODEL DIDN'T FINISH (Jon, 2026-10-19: "Model returned an unparseable
// response" on a 31-photo unit's listing copy).
//
// Lives in lib/ rather than beside the one route that needed it, because the same thing happens
// everywhere we ask for JSON and the fix should not have to be rediscovered each time.
// Tests: node lib/__tests__/json-repair.test.mjs
// The old parser tried the string, tried it without code fences, then tried the outermost braces —
// and gave up. That is fine for a model that misbehaves and useless for the thing that actually
// happens, which is TRUNCATION: six sections of listing copy ran past max_tokens, the reply stops
// mid-sentence, and the outermost-brace slice is invalid JSON with a dangling string. Six good
// sections were thrown away because the seventh was cut.
//
// So this repairs in order of how likely each break is, and the caller salvages per key if even
// that fails. Nothing here invents content — every repair only closes what the model left open.
export function parseJson(raw: string): any | null {
  if (!raw) return null
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }

  const fenceless = raw.replace(/```(?:json)?/gi, '').trim()
  for (const cand of [raw, fenceless]) {
    const obj = tryParse(cand)
    if (obj && typeof obj === 'object') return obj
  }

  const a = fenceless.indexOf('{')
  if (a === -1) return null
  const body = fenceless.slice(a)
  const b = body.lastIndexOf('}')
  const candidates: string[] = []
  if (b > 0) candidates.push(body.slice(0, b + 1))
  candidates.push(closeOpen(body))                     // truncated: close what is still open
  if (b > 0) candidates.push(stripTrailingCommas(body.slice(0, b + 1)))
  candidates.push(stripTrailingCommas(closeOpen(body)))

  for (const c of candidates) {
    const obj = tryParse(c)
    if (obj && typeof obj === 'object') return obj
  }
  return null
}

/**
 * Close a JSON object the model stopped writing half way through: shut an open string, drop a
 * dangling key or comma, and add the braces and brackets it never got to. The last value is
 * whatever text arrived before the cut — short, but true to what was written.
 */
function closeOpen(src: string): string {
  let inStr = false, esc = false, depth = 0
  // The last point at which every key/value pair before it is COMPLETE: just before a comma that
  // sits directly inside the root object. Cutting here can never leave a key without its value.
  let safeCut = -1
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (esc) { esc = false; continue }
    if (inStr) {
      if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 1) safeCut = i
  }

  // Cut inside a value: close the string and the open brackets. The value keeps whatever arrived,
  // which is short but true to what the model wrote.
  if (inStr) return src + '"' + closers(src)

  // Cut between a key and its value ("space":) or straight after a comma: there is nothing to
  // close, so fall back to the last complete pair rather than inventing an empty value.
  if (/[,:]\s*$/.test(src)) {
    if (safeCut < 0) return src
    const head = src.slice(0, safeCut)
    return head + closers(head)
  }
  return src + closers(src)
}

/** The brackets still open at the end of `s`, innermost first. */
function closers(s: string): string {
  let inStr = false, esc = false
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (esc) { esc = false; continue }
    if (inStr) { if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let out = ''
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']'
  return out
}

const stripTrailingCommas = (s: string) => s.replace(/,(\s*[}\]])/g, '$1')

/**
 * LAST RESORT: pull the keys out one at a time. When the object cannot be made valid at all, five
 * finished sections still beat an error message — the page shows them for approval and the missing
 * one is regenerated on its own, which is a button that already exists.
 */
export function salvageKeys(raw: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) {
    // The value is a JSON string literal: take it with its escapes and let JSON.parse decode it.
    const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")', 's'))
    if (!m) continue
    try { const v = JSON.parse(m[1]); if (typeof v === 'string' && v.trim()) out[k] = v.trim() } catch { /* skip it */ }
  }
  return out
}
