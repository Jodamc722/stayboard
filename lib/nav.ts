// Sidebar model, part 2: WHAT SITS ON TOP.
//
// lib/features.ts answers "may this person open this tab". This file answers "which tabs does this
// person want in front of them every morning" — the pinned DAILY band above the folded groups.
//
// Two layers, in this order:
//   1. The person's own pins, saved to app_users.prefs.nav_pins (JSONB column from migration 013 —
//      NO new migration). Read/written by /api/access/prefs, which reads app_users directly rather
//      than through getAccess(), because getAccess() short-circuits for the SUPERADMIN before it
//      ever touches app_users and would therefore always hand Jon an empty prefs object.
//   2. If they have never pinned anything, the DEFAULT for their DB role (app_roles.key). A new
//      teammate should land on a useful band, not an empty one.
//
// Pins are paths, not feature keys, so the sidebar can render one straight from the list. Anything
// the person's role cannot see is filtered out at render time by Shell's canSee(), so a pin can
// never widen access — the worst case is a pin that silently does not render.

export const MAX_PINS = 12

// THE TOP SIX, verbatim (Jon, 2026-08-19): "at the top lets have Command Center, Scheduler,
// Reviews, Today in Ops, Claims, Glitches." One standing daily band for EVERY role, in exactly
// that order — nobody has to star anything to get a useful top (his earlier point: "be able to
// arrange without having to favorite it"). Drag still reorders; the star still adds extras for
// whoever wants more; canSee() hides whatever a role can't open.
const DAILY_SIX = [
  '/command',   // Command Center
  '/schedule',  // Scheduler
  '/reviews',   // Reviews
  '/plan',      // Today in Ops
  '/claims',    // Claims
  '/glitches',  // Glitches
]

// Every role starts from the same six; role visibility trims what a role can't see at render.
export const DEFAULT_PINS: Record<string, string[]> = {
  admin: DAILY_SIX, manager: DAILY_SIX, cs_manager: DAILY_SIX, cs: DAILY_SIX,
  ops: DAILY_SIX, maintenance: DAILY_SIX, data: DAILY_SIX,
}

export const FALLBACK_PINS = DAILY_SIX.slice()

export function defaultPinsFor(roleKey: string | null | undefined): string[] {
  const key = String(roleKey || '').toLowerCase()
  const hit = DEFAULT_PINS[key]
  return hit ? hit.slice() : FALLBACK_PINS.slice()
}

// De-dupe, drop junk, cap. Used on both sides of the wire so the client and the save route agree.
export function cleanPins(input: any, valid?: string[]): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (let i = 0; i < input.length; i++) {
    const s = typeof input[i] === 'string' ? input[i].trim() : ''
    if (!s) continue
    if (valid && valid.indexOf(s) < 0) continue
    if (out.indexOf(s) >= 0) continue
    out.push(s)
    if (out.length >= MAX_PINS) break
  }
  return out
}

// Device-local mirror so the band paints instantly on load instead of flashing empty while
// /api/access/prefs answers. The server copy is the one that follows you to another device.
export const PINS_LS_KEY = 'lh_nav_pins'
export const GROUPS_LS_KEY = 'lh_nav_groups'
