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
export type Feature = { key: string; label: string; path: string }

export const FEATURES: Feature[] = [
  { key: 'command',       label: 'Command Center',    path: '/command' },
  { key: 'home',          label: 'Home',              path: '/' },
  { key: 'reservations',  label: 'Reservations',      path: '/reservations' },
  { key: 'reservation-emails', label: 'Reservation Emails', path: '/reservation-emails' },
  { key: 'messages',      label: 'Messages',          path: '/messages' },
  { key: 'reviews',       label: 'Reviews',           path: '/reviews' },
  { key: 'welcome-calls', label: 'Welcome Calls',     path: '/welcome-calls' },
  { key: 'guidebooks',    label: 'Guidebooks',        path: '/guidebooks' },
  { key: 'faq',           label: 'FAQ & How-To',      path: '/faq' },
  { key: 'plan',          label: 'Today in Ops',      path: '/plan' },
  { key: 'schedule',      label: 'Turnover Schedule', path: '/schedule' },
  { key: 'forecast',      label: 'Weekly Schedule',   path: '/schedule/forecast' },
  { key: 'glitches',      label: 'Glitches',          path: '/glitches' },
  { key: 'audits',        label: 'Audits',            path: '/audits' },
  { key: 'orders',        label: 'Orders',            path: '/orders' },
  { key: 'requests',      label: 'Requests',          path: '/requests' },
  { key: 'vault',         label: 'Vault',             path: '/vault' },
  { key: 'buildings',     label: 'Properties',        path: '/buildings' },
  { key: 'health',        label: 'Health Score',      path: '/health' },
  { key: 'revenue',       label: 'Revenue',           path: '/revenue' },
  { key: 'channels',      label: 'Channels',          path: '/channels' },
  { key: 'marketing',     label: 'Direct Bookings',   path: '/marketing' },
  { key: 'reports',       label: 'Owner Reports',     path: '/reports' },
  { key: 'claims',        label: 'Claims',            path: '/claims' },
  { key: 'cleaners',      label: 'Cleaners',          path: '/cleaners' },
  { key: 'labor',         label: 'Labor',             path: '/labor' },
  { key: 'listings',      label: 'Listings',          path: '/listings' },
  { key: 'optimize',      label: 'Listing Optimizer', path: '/optimize' },
  { key: 'custom-fields', label: 'Custom Fields',     path: '/settings/custom-fields' },
  // Connected apps (Slack, email). Deliberately LEFT OUT of the ops / cs / data bundles below, so
  // out of the box only Admin and GM can reach it — "a few people for now". To give it to someone
  // else, switch them to GM or flip it on for them individually on /users → Edit access.
  { key: 'integrations', label: 'Integrations',       path: '/integrations' },
]

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

// Resolve the full level map for a user: role perms, then legacy per-person features[key]===false
// forces 'off' (kept so pre-roles individual page-offs keep working).
export function levelsForRole(role: RoleDef | null | undefined, features?: Record<string, any> | null): Record<string, Level> {
  const out: Record<string, Level> = {}
  for (const f of FEATURES) {
    out[f.key] = features && features[f.key] === false ? 'off' : roleLevel(role, f.key)
  }
  return out
}

// Legacy fallback when app_roles is missing or the user has no access_role yet: the old
// workspace bundle. Allowed pages map to 'full' — that is what page access meant before levels
// existed (no write gating), so nobody loses ability mid-migration. Fail-open by design.
export function legacyLevels(ws: any, features?: Record<string, any> | null): Record<string, Level> {
  const out: Record<string, Level> = {}
  for (const f of FEATURES) {
    out[f.key] = pageAllowed(ws, features, f.key) ? 'full' : 'off'
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
    pages: ['home', 'plan', 'schedule', 'forecast', 'glitches', 'audits', 'orders', 'requests', 'cleaners', 'labor', 'buildings', 'faq'] },
  { key: 'cs',    label: 'Customer Service', landing: '/reservations', blurb: 'Guests: reservations, messages, reviews, calls',
    pages: ['home', 'reservations', 'reservation-emails', 'messages', 'reviews', 'welcome-calls', 'guidebooks', 'faq', 'glitches', 'requests', 'claims'] },
  { key: 'data',  label: 'Data',             landing: '/revenue', blurb: 'Money & performance: revenue, channels, reports',
    pages: ['home', 'revenue', 'channels', 'marketing', 'reports', 'health', 'buildings', 'listings', 'claims'] },
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
