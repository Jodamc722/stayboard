// Central access control for StayBoard. Roles: 'admin' (full app + user management) and 'member'.
// 2026-08-04: permission LEVELS. Each user points at a DB role (app_users.access_role → app_roles)
// that assigns off/view/edit/full per tab (lib/features.ts). Legacy workspace + features columns
// remain the fail-open fallback (pre-migration-021, missing table, or transient errors), and
// features[key] === false is still honored as a per-person hard-off on top of the role.
// FAIL-OPEN by design so a missing/empty table or a transient error never locks anyone out,
// and the hardcoded SUPERADMIN can never be locked out.
import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'
import { normWorkspace, type Workspace, type Level, type RoleDef, levelsForRole, legacyLevels, landingFor, atLeast, workspaceDef, FEATURES } from './features'

export type Role = 'admin' | 'member'
export type Access = {
  user: any; email: string | null; role: Role | null; allowed: boolean; bootstrap: boolean
  features: Record<string, boolean>
  workspace: Workspace
  profile: Record<string, any>
  prefs: Record<string, any>
  accessRole: string | null                 // app_roles.key this user is assigned to (null = legacy)
  levels: Record<string, Level>             // resolved per-feature level for THIS user
  landing: string
}

const SUPERADMIN = 'jon@stay-hospitality.com'

const ALL_FULL = (): Record<string, Level> => {
  const out: Record<string, Level> = {}
  for (const f of FEATURES) out[f.key] = 'full'
  return out
}

const base = (over: Partial<Access>): Access => ({
  user: null, email: null, role: null, allowed: false, bootstrap: false,
  features: {}, workspace: 'gm', profile: {}, prefs: {},
  accessRole: null, levels: {}, landing: '/', ...over,
})

// ---- app_roles cache (60s, per server instance). Fail-open: null = table missing/error. ----
let _rolesAt = 0
let _rolesVal: RoleDef[] | null = null
export async function getRoles(): Promise<RoleDef[] | null> {
  if (Date.now() - _rolesAt < 60_000) return _rolesVal
  try {
    const sb = supabaseAdmin()
    const { data, error } = await sb.from('app_roles').select('*').order('sort', { ascending: true })
    _rolesAt = Date.now()
    _rolesVal = error || !Array.isArray(data) ? null : (data as any as RoleDef[])
  } catch { _rolesAt = Date.now(); _rolesVal = null }
  return _rolesVal
}
export function bustRolesCache() { _rolesAt = 0 }

// Resolve levels + landing for a user row given the (possibly null) roles list.
export function resolveLevels(row: { role?: string | null; access_role?: string | null; workspace?: string | null; features?: any },
  roles: RoleDef[] | null): { levels: Record<string, Level>; landing: string; accessRole: string | null } {
  const features = (row.features && typeof row.features === 'object') ? row.features : null
  if (row.role === 'admin') return { levels: ALL_FULL(), landing: '/command', accessRole: 'admin' }
  const roleDef = roles && row.access_role ? roles.find(r => r.key === row.access_role) || null : null
  if (roleDef) {
    const levels = levelsForRole(roleDef, features)
    return { levels, landing: landingFor(levels, roleDef.landing), accessRole: roleDef.key }
  }
  // Legacy fallback: workspace bundle (allowed pages = full, like before levels existed).
  const ws = normWorkspace(row.workspace)
  const levels = legacyLevels(ws, features)
  return { levels, landing: landingFor(levels, workspaceDef(ws).landing), accessRole: null }
}

export async function getAccess(): Promise<Access> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return base({})
  const email = String(user.email || '').toLowerCase()
  if (email === SUPERADMIN) return base({ user, email, role: 'admin', allowed: true, workspace: 'admin', accessRole: 'admin', levels: ALL_FULL(), landing: '/command' })
  try {
    const sb = supabaseAdmin()
    // select('*') so optional columns (workspace/profile/prefs/access_role) are read when present
    // and simply absent when their migration hasn't run yet.
    const { data, error } = await sb.from('app_users').select('*').eq('email', email).maybeSingle()
    if (error) return base({ user, email, role: 'member', allowed: true, bootstrap: true, levels: ALL_FULL() })
    if (!data) {
      const { count } = await sb.from('app_users').select('email', { count: 'exact', head: true }).eq('status', 'active')
      if (!count || count === 0) return base({ user, email, role: 'member', allowed: true, bootstrap: true, levels: ALL_FULL() })
      return base({ user, email })
    }
    if (data.status !== 'active') return base({ user, email })
    const features = (data.features && typeof data.features === 'object') ? data.features as Record<string, boolean> : {}
    const role: Role = data.role === 'admin' ? 'admin' : 'member'
    const roles = await getRoles()
    const { levels, landing, accessRole } = resolveLevels(data as any, roles)
    return base({
      user, email, role, allowed: true, features,
      workspace: role === 'admin' ? 'admin' : normWorkspace((data as any).workspace),
      profile: ((data as any).profile && typeof (data as any).profile === 'object') ? (data as any).profile : {},
      prefs: ((data as any).prefs && typeof (data as any).prefs === 'object') ? (data as any).prefs : {},
      accessRole, levels, landing,
    })
  } catch {
    return base({ user, email, role: 'member', allowed: true, bootstrap: true, levels: ALL_FULL() })
  }
}

export function isSuperadmin(email: string | null | undefined): boolean {
  return String(email || '').toLowerCase() === SUPERADMIN
}

// ---- Who may see dollar amounts (Jon 2026-08-10: "unless you're the GM or admin"). -------------
// Percentages are for everyone; amounts are for the people who own the P&L. Roles that qualify:
// 'admin' (owner/admin) and 'manager' — migration 023 mapped every GM and every unclassified
// full-access person onto 'manager', so that key IS the GM seat.
//
// Deliberately NOT fail-open. Everywhere else in this file a missing table or a bad row resolves to
// MORE access, because locking the team out of a board is worse than showing them one. Money runs
// the other way, so every unresolved case lands on percentages. In particular the legacy path never
// consults `workspace`: normWorkspace() turns a missing column into 'gm', so trusting it would hand
// dollars to every un-migrated user — the exact leak this function exists to close. If app_roles
// isn't live yet, only a true admin sees amounts, and the fix is to run migration 023 (or set the
// per-person flag below), not to widen the default.
//
// features.money on the user row is the per-person escape hatch: true grants, false denies, and it
// beats the role either way.
export function canSeeMoney(access: Pick<Access, 'role' | 'accessRole' | 'workspace' | 'features'>): boolean {
  const flag = (access.features as any)?.money
  if (flag === true) return true
  if (flag === false) return false
  if (access.role === 'admin') return true
  return access.accessRole === 'admin' || access.accessRole === 'manager'
}

// ---- Central write guard for API routes. ----
// Usage:  const g = await requireLevel('glitches', 'edit'); if (!g.ok) return g.res
// Semantics: signed-out → 401. Signed in but below the needed level on that feature → 403 with a
// human message. Bootstrap/fail-open states resolve to full (never lock out on infra errors).
export async function requireLevel(featureKey: string, need: 'view' | 'edit' | 'full'):
  Promise<{ ok: true; access: Access; res?: undefined } | { ok: false; res: NextResponse; access: Access }> {
  const access = await getAccess()
  if (!access.user) return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (!access.allowed) return { ok: false, res: NextResponse.json({ error: 'no-access' }, { status: 403 }), access }
  const have = access.levels[featureKey]
  if (!atLeast(have, need)) {
    const label = FEATURES.find(f => f.key === featureKey)?.label || featureKey
    const msg = need === 'full'
      ? `Your role has ${have || 'no'} access on ${label} — this action needs full access. Ask Jon to adjust your role.`
      : `Your role has ${have || 'no'} access on ${label} — this action needs edit access. Ask Jon to adjust your role.`
    return { ok: false, res: NextResponse.json({ error: 'forbidden', message: msg }, { status: 403 }), access }
  }
  return { ok: true, access }
}
