// Central access control for StayBoard. Roles: 'admin' (full app + user management) and 'member'.
// Each user also has a WORKSPACE (ops / cs / gm / data / admin — see lib/features.ts) that presets
// which pages they see, plus per-user feature overrides, a profile (name/title/phone) and prefs
// (notification preferences). Membership lives in the `app_users` table.
// FAIL-OPEN by design so a missing/empty table, missing columns (pre-migration 013) or a transient
// error never locks anyone out, and the hardcoded SUPERADMIN can never be locked out.
import 'server-only'
import { createClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'
import { normWorkspace, type Workspace } from './features'

export type Role = 'admin' | 'member'
export type Access = {
  user: any; email: string | null; role: Role | null; allowed: boolean; bootstrap: boolean
  features: Record<string, boolean>
  workspace: Workspace
  profile: Record<string, any>
  prefs: Record<string, any>
}

const SUPERADMIN = 'jon@stay-hospitality.com'

const base = (over: Partial<Access>): Access => ({
  user: null, email: null, role: null, allowed: false, bootstrap: false,
  features: {}, workspace: 'gm', profile: {}, prefs: {}, ...over,
})

export async function getAccess(): Promise<Access> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return base({})
  const email = String(user.email || '').toLowerCase()
  if (email === SUPERADMIN) return base({ user, email, role: 'admin', allowed: true, workspace: 'admin' })
  try {
    const sb = supabaseAdmin()
    // select('*') so optional columns (workspace/profile/prefs, migration 013) are read when present
    // and simply absent when the migration hasn't run yet.
    const { data, error } = await sb.from('app_users').select('*').eq('email', email).maybeSingle()
    if (error) return base({ user, email, role: 'member', allowed: true, bootstrap: true })
    if (!data) {
      const { count } = await sb.from('app_users').select('email', { count: 'exact', head: true }).eq('status', 'active')
      if (!count || count === 0) return base({ user, email, role: 'member', allowed: true, bootstrap: true })
      return base({ user, email })
    }
    if (data.status !== 'active') return base({ user, email })
    const features = (data.features && typeof data.features === 'object') ? data.features as Record<string, boolean> : {}
    const role: Role = data.role === 'admin' ? 'admin' : 'member'
    return base({
      user, email, role, allowed: true, features,
      workspace: role === 'admin' ? 'admin' : normWorkspace((data as any).workspace),
      profile: ((data as any).profile && typeof (data as any).profile === 'object') ? (data as any).profile : {},
      prefs: ((data as any).prefs && typeof (data as any).prefs === 'object') ? (data as any).prefs : {},
    })
  } catch {
    return base({ user, email, role: 'member', allowed: true, bootstrap: true })
  }
}

export function isSuperadmin(email: string | null | undefined): boolean {
  return String(email || '').toLowerCase() === SUPERADMIN
}
