// THE HOTEL'S PAGE TABLE — pure (no icons, no React), so the edge middleware can import it.
// lib/business adds the icons for the sidebar.
/**
 * THE HOTEL'S PAGES (Jon, 2026-09-29: "a completely separate business unit… completely different
 * user settings… different ways they view the data"). Each page is its own permission key, levelled
 * off/view/edit/full by the person's GARDEN role (garden_roles, migration 118) — never by their VR
 * role. The sidebar is drawn from this list and hides what the role has 'off'.
 */
export type GardenPageKey = 'today' | 'rooms' | 'schedule' | 'staff' | 'calls' | 'messages' | 'reviews' | 'calendar' | 'payments' | 'reports' | 'owner-reports' | 'handbook' | 'adam' | 'settings' | 'setup' | 'users'
export type GardenPageDef = { key: GardenPageKey; to: string; label: string; section: string; what: string }
// Laid out like the VR sidebar (Jon, 2026-09-29: "same web app, same design"): the agent's tab up
// top, the work in the middle, and Settings ending in Users & admin — where the hotel's people,
// roles and settings live, in the same console as the VR side's. Pages in section 'Admin' are
// permission keys for panels inside that console, not sidebar rows (their old URLs redirect there).
export const GARDEN_PAGE_DEFS: GardenPageDef[] = [
  { key: 'today',         to: '/garden',               label: 'Today',                 section: 'Overview',   what: 'Arrivals, departures, in-house, what is due.' },
  { key: 'adam',          to: '/garden/adam',          label: 'Adam',                  section: 'Overview',   what: 'The hotel\'s agent: what he knows, files, questions, chats.' },
  { key: 'rooms',         to: '/garden/rooms',         label: 'Rooms & cleans',        section: 'Operations', what: 'Room condition, cleans, inspections, maintenance.' },
  { key: 'schedule',      to: '/garden/schedule',      label: 'Scheduler',             section: 'Operations', what: 'Shifts by day against the day\'s load.' },
  { key: 'handbook',      to: '/garden/handbook',      label: 'Handbook',              section: 'Operations', what: 'The hotel\'s own SOPs. Adam reads it.' },
  { key: 'calls',         to: '/garden/calls',         label: 'Calls & verifications', section: 'Guests',     what: 'Welcome calls, ID and card checks, the phone log.' },
  { key: 'messages',      to: '/garden/messages',      label: 'Messages',              section: 'Guests',     what: 'Cloudbeds guest messaging, one inbox.' },
  { key: 'reviews',       to: '/garden/reviews',       label: 'Reviews',               section: 'Guests',     what: 'Reviews, replies, themes.' },
  { key: 'calendar',      to: '/garden/calendar',      label: 'Calendar & rates',      section: 'Money',      what: 'Cloudbeds multi-calendar: availability, rates, restrictions, channel sync.' },
  { key: 'payments',      to: '/garden/payments',      label: 'Payments',              section: 'Money',      what: 'Cloudbeds Payments: charges, deposits, refunds.' },
  { key: 'reports',       to: '/garden/reports',       label: 'Reports',               section: 'Money',      what: 'Occupancy, ADR, RevPAR, sources.' },
  { key: 'owner-reports', to: '/garden/owner-reports', label: 'Owner reports',         section: 'Money',      what: 'The owner deck, from templates.' },
  { key: 'users',         to: '/garden/users',         label: 'Users & admin',         section: 'Settings',   what: 'People, roles and the hotel\'s settings — the same console as the VR side.' },
  { key: 'staff',         to: '/garden/team',          label: 'Staff roster',          section: 'Admin',      what: 'Users & admin → Settings → Staff roster.' },
  { key: 'settings',      to: '/garden/settings',      label: 'Hotel settings',        section: 'Admin',      what: 'Users & admin → Settings: hotel profile, voice, phone, triggers, Adam.' },
  { key: 'setup',         to: '/garden/setup',         label: 'Cloudbeds & feeds',     section: 'Admin',      what: 'Users & admin → Settings → Cloudbeds & feeds.' },
]
export const GARDEN_PAGE_KEYS: GardenPageKey[] = GARDEN_PAGE_DEFS.map(p => p.key)
export const GARDEN_PAGE_LABEL: Record<string, string> = { ...Object.fromEntries(GARDEN_PAGE_DEFS.map(p => [p.key, p.label])), users: 'Users & admin', staff: 'Staff roster' }

/** Which hotel page a path is (longest prefix wins; /garden alone is Today). */
export function gardenPageForPath(path: string): GardenPageDef | null {
  const p = String(path || '')
  if (p === '/garden') return GARDEN_PAGE_DEFS[0]
  let best: GardenPageDef | null = null
  for (const g of GARDEN_PAGE_DEFS) if (g.to !== '/garden' && (p === g.to || p.startsWith(g.to + '/')) && (!best || g.to.length > best.to.length)) best = g
  return best
}

export type GLevel = 'off' | 'view' | 'edit' | 'full'
const RANK: Record<string, number> = { off: 0, view: 1, edit: 2, full: 3 }
export const gAtLeast = (have: string | null | undefined, need: GLevel) => (RANK[String(have || 'off')] ?? 0) >= RANK[need]
/** A role's perms → a complete level map (unknown/missing = off). */
export function gardenLevels(perms: Record<string, any> | null | undefined): Record<GardenPageKey, GLevel> {
  const out = {} as Record<GardenPageKey, GLevel>
  for (const k of GARDEN_PAGE_KEYS) { const v = String(perms?.[k] || 'off'); out[k] = (v in RANK ? v : 'off') as GLevel }
  return out
}
export const GARDEN_ALL_FULL = (): Record<GardenPageKey, GLevel> => gardenLevels(Object.fromEntries(GARDEN_PAGE_KEYS.map(k => [k, 'full'])))
export function gardenLanding(levels: Record<string, string>, preferred?: string | null): string {
  const hit = preferred ? gardenPageForPath(preferred) : null
  if (hit && gAtLeast(levels[hit.key], 'view')) return hit.to
  const first = GARDEN_PAGE_DEFS.find(p => gAtLeast(levels[p.key], 'view'))
  return first ? first.to : '/no-access'
}
/** The highest level anywhere in the hotel — the coarse 'garden' key older routes still check. */
export const gardenMax = (levels: Record<string, string>): GLevel => (['full', 'edit', 'view'] as GLevel[]).find(l => Object.values(levels).some(v => v === l)) || 'off'

