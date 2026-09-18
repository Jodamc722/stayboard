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
import { DOOR_CODE_FIELD } from './code-integrity'

/** Per-reservation access code (changes per stay) — the second Guesty custom field that is a secret. */
export const RES_CODE_FIELD = '693adec2ab73940025856e56'

export const REDACTED = '[redacted — ask for the code through the door-code flow]'

const KEY_RE = /door|entry|access\s*code|keypad|lock\s*code/i
// Keys that mention a code by NAME. `access` on its own is too broad (accessRole, access_role,
// "accessible"), so the bare-key test is narrower than the free-text test above.
const BARE_KEY_RE = /door|keypad|lock\s*_?code|entry\s*_?code|access\s*_?code|res(ervation)?_?code|access_?secret/i
// Free text that STATES a code: "door code 1234", "keypad: 5678#", "lock code is 4321".
const TEXT_RE = /\b(door|entry|access|keypad|lock|gate)\s*code\b[^0-9#*]{0,20}[0-9#*]{3,}/gi

function idOf(c: any): string {
  const fid = c && typeof c.fieldId === 'object' ? c.fieldId?._id : c?.fieldId
  return String(fid || c?.field_id || c?.id || '')
}
function nameOf(c: any): string {
  const f = c && typeof c.fieldId === 'object' ? c.fieldId : null
  return String(c?.fieldName || c?.name || c?.label || f?.name || f?.label || '')
}

/** A Guesty custom-field entry whose id or name marks it as a code. */
function isCodeField(c: any): boolean {
  if (!c || typeof c !== 'object') return false
  const id = idOf(c)
  if (id === DOOR_CODE_FIELD || id === RES_CODE_FIELD) return true
  return KEY_RE.test(nameOf(c))
}

function scrubText(s: string): string {
  return s.replace(TEXT_RE, (m) => m.replace(/[0-9#*]{3,}/g, '[redacted]'))
}

function walk(v: any, keyHint: string): any {
  if (typeof v === 'string') return v && keyHint && BARE_KEY_RE.test(keyHint) ? REDACTED : scrubText(v)
  if (typeof v === 'number') return keyHint && BARE_KEY_RE.test(keyHint) ? REDACTED : v
  if (Array.isArray(v)) return v.map(x => walk(x, ''))
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v
    if (isCodeField(v)) {
      // Keep the entry (so the model knows a code EXISTS) but not what it says.
      const out: Record<string, any> = {}
      for (const k of Object.keys(v)) out[k] = k === 'value' || k === 'val' || k === 'text' ? REDACTED : walk(v[k], k)
      return out
    }
    const out: Record<string, any> = {}
    for (const k of Object.keys(v)) {
      const val = v[k]
      if (BARE_KEY_RE.test(k) && (typeof val === 'string' || typeof val === 'number') && val !== '' && val != null) { out[k] = REDACTED; continue }
      out[k] = walk(val, k)
    }
    return out
  }
  return v
}

/**
 * Strip door / access codes from any tool result. Never throws; on anything unexpected the
 * original value comes back untouched (the failure mode of a redactor must not be a crash that
 * hides the whole answer).
 */
export function redactSensitive<T>(value: T): T {
  try { return walk(value, '') as T } catch { return value }
}
