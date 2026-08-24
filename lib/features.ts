// Single source of truth for pages ("features") AND workspaces (role presets).
// The nav (Shell), the admin console (Users page), and the access gate (middleware) ALL read from
// this file — adding a new page later is a one-line addition to FEATURES (+ add its key to the
// workspace bundles it belongs to) and it automatically gains a per-user on/off toggle.
//
// Access model (fail-open at every layer so nobody is ever locked out by accident):
//   1. WORKSPACE preset — each user has a workspace (ops / cs / gm / data / admin) that defines the
//      set of pages they can see and their landing page. Unknown/missing workspace = 'gm' (all pages).
//   2. Per-user feature OVERRIDES — features[key] === false turns a page off for that user on top of
//      the workspace. The owner (jon@stay-hospitality.com) always has every page.
export type Feature = { key: string; label: string; path: string; group: string }

// Group titles for the /users → Roles grid (mirrors the sidebar). Every feature MUST name one of
// these groups — anything else lands in an auto-generated "New tabs" bucket in the grid, so a tab
// can never silently miss the permission editor again.
export const GROUP_ORDER = ['Overview', 'Guests', 'Operations', 'Portfolio', 'Money', 'Team', 'Admin']

export const FEATURES: Feature[] = [
  { key: 'command',       label: 'Command Center',    path: '/command', group: 'Overview' },
  { key: 'home',          label: 'Home',              path: '/', group: 'Overview' },
  // Eve (2026-08-19, Jon): "Eve should only be for Admin and up users." Registering her as a real
  // feature key replaces the hardcoded jon@-only check that used to live in /api/agent, so she is
  // owner + admin out of the box AND can be switched on for one more role from the Roles grid
  // without a deploy. Migration 045 seeds admin=full and every other role=off.
  { key: 'eve',           label: 'Eve',               path: '/eve', group: 'Overview' },
  { key: 'reservations',  label: 'Reservations',      path: '/reservations', group: 'Guests' },
  { key: 'reservation-emails', label: 'Reservation Emails', path: '/reservation-emails', group: 'Guests' },
  { key: 'messages',      label: 'Messages',          path: '/messages', group: 'Guests' },
  { key: 'reviews',       label: 'Reviews',           path: '/reviews', group: 'Guests' },
  { key: 'welcome-calls', label: 'Welcome Calls',     path: '/welcome-calls', group: 'Guests' },
  { key: 'guidebooks',    label: 'Guidebooks',        path: '/guidebooks', group: 'Guests' },
  { key: 'claims',        label: 'Claims',            path: '/claims', group: 'Guests' },
  { key: 'faq',           label: 'Property FAQ',       path: '/faq', group: 'Guests' },
  // Guests directory + profiles (2026-08-18, Jon): "a tab where we have all guest info, create a
  // guest profile as well." Aggregated from reservations; VIP on a profile feeds auto-inspections.
  { key: 'guests',        label: 'Guests',            path: '/guests', group: 'Guests' },
  // Gated 2026-08-06 (Jon, second pass): guest PII on an auth-only page deserves a role setting.
  // Re-applied after the Patterns upload (73bd724) landed from a pre-salato copy of this file.
  // The public share/verify links (/salato/share, /salato/verify) stay open — OPEN_PREFIXES wins
  // before the role gate in middleware.
  { key: 'salato',        label: 'Salato Front Desk', path: '/salato', group: 'Guests' },
  { key: 'plan',          label: 'Today in Ops',      path: '/plan', group: 'Operations' },
  { key: 'maintenance',   label: 'Maintenance',       path: '/maintenance', group: 'Operations' },
  { key: 'schedule',      label: 'Turnover Schedule', path: '/schedule', group: 'Operations' },
  { key: 'forecast',      label: 'Weekly Schedule',   path: '/schedule/forecast', group: 'Operations' },
  { key: 'glitches',      label: 'Glitches',          path: '/glitches', group: 'Operations' },
  { key: 'audits',        label: 'Audits',            path: '/audits', group: 'Operations' },
  // Gated 2026-08-06 (Jon): was reachable by any logged-in member with no permission setting.
  { key: 'inspections',   label: 'Inspections',       path: '/inspections', group: 'Operations' },
  { key: 'orders',        label: 'Orders',            path: '/orders', group: 'Operations' },
  { key: 'requests',      label: 'Requests',          path: '/requests', group: 'Operations' },
  // Blocked Units (2026-08-10, Jon): every unit off the calendar, read live from Guesty's
  // multi-calendar, with the note whoever created the block typed in. An operations page, not a
  // money one — the point is to chase the work behind the block before the nights are gone.
  { key: 'blocked',       label: 'Blocked Units',     path: '/blocked', group: 'Operations' },
  // Projects (2026-08-10, Jon): the ops work that is NOT a task — renovations, rollouts,
  // building onboarding. /project/<token> is the vendor's view and stays public (OPEN_PREFIXES).
  { key: 'projects',      label: 'Projects',          path: '/projects', group: 'Operations' },
  // FF&E Audit (2026-08-10, Jon): one phone link per unit, room by room, EN/ES. A furniture
  // PURCHASING list — deliberately not wired to Breezeway, maintenance or billing.
  { key: 'ffe',           label: 'FF&E Audit',        path: '/ffe', group: 'Operations' },
  { key: 'vault',         label: 'Vault',             path: '/vault', group: 'Portfolio' },
  // Share Links hub (2026-08-18, Jon): "a place where I can create those links based on
  // properties, units, owners and customize them to show different information." Carries live
  // money data, so like Integrations it is deliberately left out of the ops/cs/data bundles.
  { key: 'share-links',   label: 'Share Links',       path: '/links', group: 'Portfolio' },
  { key: 'buildings',     label: 'Properties',        path: '/buildings', group: 'Portfolio' },
  { key: 'listings',      label: 'Listings',          path: '/listings', group: 'Portfolio' },
  { key: 'optimize',      label: 'Listing Optimizer', path: '/optimize', group: 'Portfolio' },
  { key: 'health',        label: 'Health Score',      path: '/health', group: 'Portfolio' },
  // Building Patterns (2026-08-06, Jon): recurring complaint themes per building — prevention layer.
  { key: 'patterns',      label: 'Building Patterns', path: '/patterns', group: 'Portfolio' },
  { key: 'revenue',       label: 'Revenue',           path: '/revenue', group: 'Money' },
  { key: 'marketing',     label: 'Direct Bookings',   path: '/marketing', group: 'Money' },
  // Billable hours (2026-08-06, Jon): Breezeway task billing by owner + labor vs actual.
  // Money page -> owner/admin-only by default (migration 027 records manager off, like Owner Audit).
  { key: 'billing',       label: 'Billable Hours',    path: '/billing', group: 'Money' },
  { key: 'reports',       label: 'Owner Reports',     path: '/reports', group: 'Money' },
  // Owner-money page: owner/admin-only by Jon's rule (migration 025 sets manager to off, same as
  // Revenue). Reviewers without a login use /report/owner-audit instead.
  { key: 'owner-audit',   label: 'Owner Audit',       path: '/owner-audit', group: 'Money' },
  { key: 'team-schedule', label: 'Weekly Planner',    path: '/team', group: 'Team' },
  { key: 'cleaners',      label: 'Cleaners',          path: '/cleaners', group: 'Team' },
  { key: 'labor',         label: 'Labor',             path: '/labor', group: 'Team' },
  // Labor Dashboard (2026-08-10, Jon): the live click-into view behind the daily labor email —
  // day / week / month, per person, with the exceptions leading.
  { key: 'labor-dashboard', label: 'Labor Dashboard',  path: '/labor/dashboard', group: 'Team' },
  { key: 'custom-fields', label: 'Custom Fields',     path: '/settings/custom-fields', group: 'Admin' },
  // Labor settings (2026-08-07): per-market labor% bands, clock-in grace, OT week, attribution
  // gate. Registered here because the build gate caught it unregistered — these thresholds drive
  // the Labor board, the Schedule strip AND the briefs, so it sits in Admin next to Custom Fields
  // rather than being reachable by anyone who can see /labor.
  { key: 'labor-settings', label: 'Labor Settings',   path: '/settings/labor', group: 'Admin' },
  // Connected apps (Slack, email). Deliberately LEFT OUT of the ops / cs / data bundles below, so
  // out of the box only Admin and GM can reach it — "a few people for now". To give it to someone
  // else, switch them to GM or flip it on for them individually on /users → Edit access.
  { key: 'integrations', label: 'Integrations',       path: '/integrations', group: 'Admin' },
]

// ---- Extra permissions: things that are NOT pages. -------------------------------------------
// A FEATURES entry answers "can this person open this tab". These answer "what may this person see
// once they are on a tab they already have". They live in the same `app_users.features` column as
// the per-page overrides, so one JSONB column still holds everything, but they are booleans only —
// off/view/edit/full is meaningless for "may you see a dollar sign".
//
// DEFAULT OFF, ALWAYS. There is no role that grants these; the owner turns each person on by hand
// on /users. That is the whole point (Jon 2026-08-10: "only view of that data should be me ...
// meaning i should be able to toggle on and off per user").
//
// Deliberately no `path:` field — scripts/check-tabs.mjs scrapes this file for `path: '...'` to
// build the route census, and a pathless entry here must not look like a page to it.
export const EXTRA_PERMS: { key: string; label: string; blurb: string }[] = [
  { key: 'money', label: 'Dollar amounts',
    blurb: 'See revenue, payroll, wages and margins as amounts. Off = the same boards in percentages.' },
]
export function isExtraPerm(key: string): boolean {
  return EXTRA_PERMS.some(p => p.key === key)
}

// ---- Route census (2026-08-06). The build-time check (scripts/check-tabs.mjs, run from
// next.config.mjs) fails the build if a page route is not covered by FEATURES or one of these
// lists — so every new tab is a forced, conscious decision about user settings before it ships.
// Public/share routes (no login). Mirrors middleware.ts isOpenPath — middleware imports from here.
export const OPEN_EXACT = ['/no-access', '/day', '/manifest.json', '/robots.txt']
export const OPEN_PREFIXES = [
  '/login', '/auth', '/signup', '/api', '/g/', '/day/', '/guide/', '/r/', '/audit/', '/walk/',
  '/field/', '/approve/', '/new-order', '/vendor/', '/delivery', '/owner-orders',
  '/salato/share', '/salato/verify', '/report/', '/favicon', '/project/', '/share/',
]
export function isOpenPath(path: string): boolean {
  if (OPEN_EXACT.indexOf(path) >= 0) return true
  for (const p of OPEN_PREFIXES) if (path.startsWith(p)) return true
  return false
}
// Login-required pages that deliberately have NO per-role setting:
// /users gates itself (admin console).
// /stay-window gates itself too (2026-08-17): every mutation on it goes through
// requireLevel('revenue','full'), so a non-revenue user who finds the URL sees the screen and can
// do nothing with it. Kept out of FEATURES so it adds no nav entry without Jon's say-so.
// RESTORED 2026-08-19: it was dropped from this list while app/stay-window/page.tsx still exists,
// which fails scripts/check-tabs.mjs at config load and takes the whole build down.
// /welcome/password is where a magic link lands someone who has no password yet (2026-08-20).
// Login-required by definition — they have just been authenticated — and it is a one-screen
// detour, not a tab, so it deliberately has no role setting.
// /doorcode/<token> is a capability link, not a tab: it is reached from a Slack DM or the Eve
// answer, it enforces its own owner/admin check inside the page, and the token is one-time. It gets
// no role setting because it should never appear in anyone's nav — you arrive at it or you don't.
// NOT in OPEN_PREFIXES on purpose: releasing a door code must require a login, unlike /approve/.
export const UNGATED_PAGES = ['/users', '/stay-window', '/welcome/password', '/doorcode']

// ---- Permission LEVELS (2026-08-04). Each DB role (app_roles) assigns one level per feature. ----
// off  = hidden + middleware-blocked (like the old toggle-off)
// view = page loads read-only; mutation APIs reject via requireLevel('edit')
// edit = day-to-day actions (assign, comment, create, mark done)
// full = destructive/settings actions on that tab (delete, policies, share passwords)
export type Level = 'off' | 'view' | 'edit' | 'full'
export const LEVELS: Level[] = ['off', 'view', 'edit', 'full']
const LEVEL_RANK: Record<string, number> = { off: 0, view: 1, edit: 2, full: 3 }

export function normLevel(v: any): Level {
  const s = String(v || '').toLowerCase()
  return (LEVELS as string[]).includes(s) ? (s as Level) : 'off'
}
export function atLeast(have: any, need: Level): boolean {
  return (LEVEL_RANK[normLevel(have)] ?? 0) >= (LEVEL_RANK[need] ?? 0)
}

// A role as stored in app_roles. perms maps featureKey -> level, with optional '*' default.
export type RoleDef = {
  key: string; label: string; blurb?: string; landing: string
  perms: Record<string, string>; is_system?: boolean; sort?: number
}

export function roleLevel(role: RoleDef | null | undefined, featureKey: string): Level {
  if (!role || !role.perms || typeof role.perms !== 'object') return 'off'
  const explicit = role.perms[featureKey]
  if (explicit != null) return normLevel(explicit)
  const star = role.perms['*']
  return star != null ? normLevel(star) : 'off'
}

// PER-PERSON OVERRIDES (Jon 2026-08-10: "individual settings for user — customise their views vs
// having to assign a role as the only option").
//
// The role is the DEFAULT, not the verdict. `app_users.features` is a JSONB map that may carry a
// level for any feature, and that level wins over whatever the role says. Three accepted shapes,
// because the column already held the first two before levels existed:
//
//   features[key] === false            -> 'off'      (the original per-person hard-off)
//   features[key] === true             -> role level (an explicit "use the role", same as absent)
//   features[key] === 'view'|'edit'|
//                     'full'|'off'     -> that level (the new per-person override)
//
// Anything unrecognised is ignored and the role decides, so a typo can never silently grant access.
// No migration: this reads a column that has existed since the first version of the users table.
export function userOverride(features: Record<string, any> | null | undefined, key: string): Level | null {
  if (!features || typeof features !== 'object') return null
  const v = features[key]
  if (v === false) return 'off'
  if (v === true || v == null) return null
  const s = String(v).toLowerCase()
  return (LEVELS as string[]).includes(s) ? (s as Level) : null
}

/** Which features this person has an explicit override on — so the editor can show role vs custom. */
export function overriddenKeys(features: Record<string, any> | null | undefined): string[] {
  return FEATURES.map(f => f.key).filter(k => userOverride(features, k) != null)
}

// Resolve the full level map for a user: the role's level for each feature, overridden per-person
// where one is set.
export function levelsForRole(role: RoleDef | null | undefined, features?: Record<string, any> | null): Record<string, Level> {
  const out: Record<string, Level> = {}
  for (const f of FEATURES) {
    out[f.key] = userOverride(features, f.key) ?? roleLevel(role, f.key)
  }
  return out
}

// Legacy fallback when app_roles is missing or the user has no access_role yet: the old
// workspace bundle. Allowed pages map to 'full' — that is what page access meant before levels
// existed (no write gating), so nobody loses ability mid-migration. Fail-open by design.
export function legacyLevels(ws: any, features?: Record<string, any> | null): Record<string, Level> {
  const out: Record<string, Level> = {}
  for (const f of FEATURES) {
    // A per-person override still wins here, so someone can be customised before they are ever
    // assigned a role — otherwise the override would silently do nothing for legacy users.
    out[f.key] = userOverride(features, f.key) ?? (workspaceAllows(ws, f.key) ? 'full' : 'off')
  }
  return out
}

// Landing for a level map: preferred landing if visible, else first visible page, else /no-access.
export function landingFor(levels: Record<string, Level>, preferred?: string | null): string {
  if (preferred) {
    const hit = FEATURES.find(f => f.path === preferred)
    if (hit && levels[hit.key] !== 'off') return hit.path
  }
  for (const f of FEATURES) if (levels[f.key] && levels[f.key] !== 'off') return f.path
  return '/no-access'
}

// ---- Workspaces (LEGACY role presets — the fail-open fallback pre-migration-021). ----
export type Workspace = 'admin' | 'gm' | 'ops' | 'cs' | 'data'

export const WORKSPACES: { key: Workspace; label: string; landing: string; blurb: string; pages: 'all' | string[] }[] = [
  { key: 'admin', label: 'Admin',            landing: '/command', blurb: 'Everything + user management', pages: 'all' },
  { key: 'gm',    label: 'GM',               landing: '/command', blurb: 'Everything except admin tools', pages: 'all' },
  { key: 'ops',   label: 'Ops',              landing: '/plan',    blurb: 'Field operations: cleans, glitches, audits, orders',
    pages: ['home', 'plan', 'schedule', 'forecast', 'glitches', 'audits', 'orders', 'requests', 'projects', 'ffe', 'cleaners', 'labor', 'labor-dashboard', 'buildings', 'patterns', 'blocked', 'faq'] },
  { key: 'cs',    label: 'Customer Service', landing: '/reservations', blurb: 'Guests: reservations, messages, reviews, calls',
    pages: ['home', 'reservations', 'reservation-emails', 'messages', 'reviews', 'welcome-calls', 'guidebooks', 'faq', 'glitches', 'requests', 'claims', 'guests'] },
  { key: 'data',  label: 'Data',             landing: '/revenue', blurb: 'Money & performance: revenue, channels, reports',
    pages: ['home', 'revenue', 'marketing', 'reports', 'health', 'patterns', 'blocked', 'buildings', 'listings', 'claims'] },
]

export function normWorkspace(v: any): Workspace {
  const s = String(v || '').toLowerCase()
  return (['admin', 'gm', 'ops', 'cs', 'data'] as Workspace[]).includes(s as Workspace) ? (s as Workspace) : 'gm'
}

export function workspaceDef(ws: any) {
  const key = normWorkspace(ws)
  return WORKSPACES.find(w => w.key === key) || WORKSPACES[1]
}

// Does this workspace include the page? ('all' or listed). Fail-open on unknown workspace (gm=all).
export function workspaceAllows(ws: any, key: string): boolean {
  const def = workspaceDef(ws)
  return def.pages === 'all' || def.pages.includes(key)
}

export function featureEnabled(features: Record<string, any> | null | undefined, key: string): boolean {
  if (!features) return true
  return features[key] !== false
}

// Combined check: the workspace must include the page AND the per-user toggle must not disable it.
export function pageAllowed(ws: any, features: Record<string, any> | null | undefined, key: string): boolean {
  return workspaceAllows(ws, key) && featureEnabled(features, key)
}

// The gated feature that owns a given pathname (longest path match), or null if the path isn't gated.
export function featureForPath(pathname: string): Feature | null {
  let best: Feature | null = null
  for (const f of FEATURES) {
    const match = f.path === '/' ? pathname === '/' : (pathname === f.path || pathname.startsWith(f.path + '/'))
    if (match && (!best || f.path.length > best.path.length)) best = f
  }
  return best
}

// Where to send this user: their workspace landing page if allowed, else the first allowed page.
export function firstEnabled(features: Record<string, any> | null | undefined, ws?: any): string {
  const def = workspaceDef(ws)
  const landing = FEATURES.find(f => f.path === def.landing)
  if (landing && pageAllowed(ws, features, landing.key)) return landing.path
  for (const f of FEATURES) if (pageAllowed(ws, features, f.key)) return f.path
  return '/no-access'
}
