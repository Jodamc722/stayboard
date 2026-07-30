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
  { key: 'buildings',     label: 'Properties',        path: '/buildings' },
  { key: 'health',        label: 'Health Score',      path: '/health' },
  { key: 'revenue',       label: 'Revenue',           path: '/revenue' },
  { key: 'channels',      label: 'Channels',          path: '/channels' },
  { key: 'reports',       label: 'Owner Reports',     path: '/reports' },
  { key: 'cleaners',      label: 'Cleaners',          path: '/cleaners' },
  { key: 'labor',         label: 'Labor',             path: '/labor' },
  { key: 'listings',      label: 'Listings',          path: '/listings' },
  { key: 'optimize',      label: 'Listing Optimizer', path: '/optimize' },
  { key: 'custom-fields', label: 'Custom Fields',     path: '/settings/custom-fields' },
]

// ---- Workspaces (role presets). pages: 'all' or an explicit list of feature keys. ----
export type Workspace = 'admin' | 'gm' | 'ops' | 'cs' | 'data'

export const WORKSPACES: { key: Workspace; label: string; landing: string; blurb: string; pages: 'all' | string[] }[] = [
  { key: 'admin', label: 'Admin',            landing: '/command', blurb: 'Everything + user management', pages: 'all' },
  { key: 'gm',    label: 'GM',               landing: '/command', blurb: 'Everything except admin tools', pages: 'all' },
  { key: 'ops',   label: 'Ops',              landing: '/plan',    blurb: 'Field operations: cleans, glitches, audits, orders',
    pages: ['home', 'plan', 'schedule', 'forecast', 'glitches', 'audits', 'orders', 'requests', 'cleaners', 'labor', 'buildings', 'faq'] },
  { key: 'cs',    label: 'Customer Service', landing: '/reservations', blurb: 'Guests: reservations, messages, reviews, calls',
    pages: ['home', 'reservations', 'reservation-emails', 'messages', 'reviews', 'welcome-calls', 'guidebooks', 'faq', 'glitches', 'requests'] },
  { key: 'data',  label: 'Data',             landing: '/revenue', blurb: 'Money & performance: revenue, channels, reports',
    pages: ['home', 'revenue', 'channels', 'reports', 'health', 'buildings', 'listings'] },
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
