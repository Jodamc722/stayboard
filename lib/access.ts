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

/**
 * The same resolution as getAccess(), but for a caller that has NO browser session — today that is
 * Telegram (lib/eve/telegram.ts), tomorrow anything else that authenticates a person some other way.
 *
 * TWO DELIBERATE DIFFERENCES FROM getAccess(), both in the same direction:
 *
 *  1. FAIL-CLOSED. Everywhere above, a missing row or a dead table resolves to MORE access, because
 *     locking a signed-in employee out of a board is worse than showing them one. That trade does
 *     not survive the trip off-platform: here the caller proved nothing to Supabase, so anything
 *     other than an active app_users row returns null and the bridge refuses to answer. A database
 *     blip must never turn an unknown Telegram handle into a manager.
 *
 *  2. NO BOOTSTRAP. The "allowlist is empty, let the first person in" path exists so a fresh
 *     install is usable. An empty allowlist reached from a chat app is just an open door.
 *
 * The caller is responsible for having verified WHICH email this is. This function only decides
 * what that email is allowed to see.
 */
export async function accessForEmail(email: string | null | undefined): Promise<Access | null> {
  const e = String(email || '').toLowerCase().trim()
  if (!e) return null
  const user = { id: `offline:${e}`, email: e }
  if (e === SUPERADMIN) {
    return base({ user, email: e, role: 'admin', allowed: true, workspace: 'admin', accessRole: 'admin', levels: ALL_FULL(), landing: '/command' })
  }
  try {
    const sb = supabaseAdmin()
    const { data, error } = await sb.from('app_users').select('*').eq('email', e).maybeSingle()
    if (error || !data) return null
    if ((data as any).status !== 'active') return null
    const features = ((data as any).features && typeof (data as any).features === 'object') ? (data as any).features as Record<string, boolean> : {}
    const role: Role = (data as any).role === 'admin' ? 'admin' : 'member'
    const roles = await getRoles()
    const { levels, landing, accessRole } = resolveLevels(data as any, roles)
    return base({
      user, email: e, role, allowed: true, features,
      workspace: role === 'admin' ? 'admin' : normWorkspace((data as any).workspace),
      profile: ((data as any).profile && typeof (data as any).profile === 'object') ? (data as any).profile : {},
      prefs: ((data as any).prefs && typeof (data as any).prefs === 'object') ? (data as any).prefs : {},
      accessRole, levels, landing,
    })
  } catch { return null }
}

// ---- Who may see dollar amounts. ---------------------------------------------------------------
// Jon 2026-08-10: "only view of that data should be me ... meaning i should be able to toggle on
// and off per user". So: the owner always, plus whoever the owner has explicitly switched on at
// /users → Edit access → Dollar amounts. Everyone else gets the same boards in percentages.
//
// NO ROLE GRANTS THIS. Not admin, not manager, not GM. Deciding it by role would mean promoting
// someone to admin quietly hands them the payroll, which is exactly the coupling Jon asked to
// break — access to a tab and permission to see amounts on it are now separate questions.
//
// Deliberately NOT fail-open. Everywhere else in this file a missing table or a bad row resolves to
// MORE access, because locking the team out of a board is worse than showing them one. Money runs
// the other way: anything other than an explicit `true` is a no. In particular nothing here reads
// `workspace`, because normWorkspace() turns a missing column into 'gm' — trusting it would hand
// dollars to every un-migrated user, the exact leak this function exists to close.
//
// The owner is checked by email, not by the flag, so no edit to any row can lock him out — and
// getAccess() short-circuits for SUPERADMIN before it ever reads app_users, so his `features` is
// always {} anyway.
export function canSeeMoney(access: Pick<Access, 'email' | 'features'>): boolean {
  if (isSuperadmin(access.email)) return true
  return (access.features as any)?.money === true
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
  // ACTIVITY (Jon, 2026-08-22): every gated API call is one metadata row — who, which feature,
  // how much power, allowed or refused. This is THE choke point every protected endpoint passes
  // through, so the whole app is covered without touching a single route. Fire-and-forget.
  try {
    const { logActivity } = await import('./activity')
    logActivity({ email: access.email || '', kind: 'api', feature: featureKey, need, allowed: atLeast(have, need) })
  } catch { /* logging never blocks access */ }
  if (!atLeast(have, need)) {
    const label = FEATURES.find(f => f.key === featureKey)?.label || featureKey
    const msg = need === 'full'
      ? `Your role has ${have || 'no'} access on ${label} — this action needs full access. Ask Jon to adjust your role.`
      : `Your role has ${have || 'no'} access on ${label} — this action needs edit access. Ask Jon to adjust your role.`
    return { ok: false, res: NextResponse.json({ error: 'forbidden', message: msg }, { status: 403 }), access }
  }
  return { ok: true, access }
}
