// Single source of truth for the toggleable pages ("features"). The nav (Shell), the per-user access
// toggles (Users page), and the access gate (middleware) ALL read from this list — so adding a new page
// later is a one-line addition here and it automatically gains a per-user on/off toggle.
// A feature is ON by default; it is OFF only when a user's features map has features[key] === false.
// The owner (jon@stay-hospitality.com) always has every feature regardless of their map.
export type Feature = { key: string; label: string; path: string }

export const FEATURES: Feature[] = [
  { key: 'command',       label: 'Command Center',    path: '/command' },
  { key: 'home',          label: 'Home',              path: '/' },
  { key: 'reservations',  label: 'Reservations',      path: '/reservations' },
  { key: 'messages',      label: 'Messages',          path: '/messages' },
  { key: 'reviews',       label: 'Reviews',           path: '/reviews' },
  { key: 'welcome-calls', label: 'Welcome Calls',     path: '/welcome-calls' },
  { key: 'buildings',     label: 'Portfolio',         path: '/buildings' },
  { key: 'health',        label: 'Health Score',      path: '/health' },
  { key: 'channels',      label: 'Channels',          path: '/channels' },
  { key: 'revenue',       label: 'Revenue',           path: '/revenue' },
  { key: 'plan',          label: 'Ops Plans',         path: '/plan' },
  { key: 'requests',      label: 'Requests',          path: '/requests' },
  { key: 'optimize',      label: 'Listing Optimizer', path: '/optimize' },
  { key: 'custom-fields', label: 'Custom Fields',     path: '/settings/custom-fields' },
]

export function featureEnabled(features: Record<string, any> | null | undefined, key: string): boolean {
  if (!features) return true
  return features[key] !== false
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

// First page this user is allowed to see (in nav order) — used to redirect away from a blocked page.
export function firstEnabled(features: Record<string, any> | null | undefined): string {
  for (const f of FEATURES) if (featureEnabled(features, f.key)) return f.path
  return '/no-access'
}
