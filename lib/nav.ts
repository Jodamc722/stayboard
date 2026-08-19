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

// Jon's own daily list (2026-08-19): "Reviews, Today in ops, Scheduler, Command Center, Claims,
// Glitches (guest issues), Unit Knowledge -> should be Property FAQ, Properties, Blocked units,
// Billable Hours." Ordered the way the morning actually runs rather than the order he said them:
// what needs me -> today's work -> the board -> what broke -> money owed.
const OWNER_DAILY = [
  '/command',   // what needs a decision
  '/plan',      // today in ops
  '/schedule',  // the turnover board
  '/glitches',  // guest issues
  '/claims',
  '/reviews',
  '/buildings', // properties
  '/blocked',   // blocked units
  '/faq',       // property FAQ
  '/billing',   // billable hours
]

// Keys match app_roles.key (migration 023). Anything unknown falls back to FALLBACK_PINS.
export const DEFAULT_PINS: Record<string, string[]> = {
  admin: OWNER_DAILY,
  manager: ['/plan', '/schedule', '/glitches', '/reviews', '/claims', '/buildings'],
  cs_manager: ['/messages', '/reviews', '/claims', '/reservations', '/glitches'],
  cs: ['/messages', '/reviews', '/reservations', '/welcome-calls', '/claims'],
  ops: ['/plan', '/schedule', '/glitches', '/requests', '/cleaners'],
  maintenance: ['/requests', '/glitches', '/plan', '/projects'],
  data: ['/revenue', '/reports', '/labor', '/buildings'],
}

export const FALLBACK_PINS = ['/plan', '/schedule', '/glitches', '/reviews']

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
