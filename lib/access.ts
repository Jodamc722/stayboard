// Central access control for StayBoard. Roles: 'admin' (full app + user management) and 'member'
// (full app, no user management). Membership lives in the `app_users` table (see supabase_app_users.sql).
// FAIL-OPEN by design so a missing/empty table or a transient error never locks anyone out, and the
// hardcoded SUPERADMIN can never be locked out.
import 'server-only'
import { createClient } from './supabase-server'
import { supabaseAdmin } from './supabase-admin'

export type Role = 'admin' | 'member'
export type Access = { user: any; email: string | null; role: Role | null; allowed: boolean; bootstrap: boolean; features: Record<string, boolean> }

const SUPERADMIN = 'jon@stay-hospitality.com'

export async function getAccess(): Promise<Access> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, email: null, role: null, allowed: false, bootstrap: false, features: {} }
  const email = String(user.email || '').toLowerCase()
  if (email === SUPERADMIN) return { user, email, role: 'admin', allowed: true, bootstrap: false, features: {} }
  try {
    const sb = supabaseAdmin()
    const { data, error } = await sb.from('app_users').select('email, role, status, features').eq('email', email).maybeSingle()
    if (error) return { user, email, role: 'member', allowed: true, bootstrap: true, features: {} } // table not set up yet -> fail open
    if (!data) {
      // Not on the allowlist. If the allowlist has no active members yet, we're pre-setup -> allow.
      const { count } = await sb.from('app_users').select('email', { count: 'exact', head: true }).eq('status', 'active')
      if (!count || count === 0) return { user, email, role: 'member', allowed: true, bootstrap: true, features: {} }
      return { user, email, role: null, allowed: false, bootstrap: false, features: {} }
    }
    if (data.status !== 'active') return { user, email, role: null, allowed: false, bootstrap: false, features: {} }
    const features = (data.features && typeof data.features === 'object') ? data.features as Record<string, boolean> : {}
    return { user, email, role: data.role === 'admin' ? 'admin' : 'member', allowed: true, bootstrap: false, features }
  } catch {
    return { user, email, role: 'member', allowed: true, bootstrap: true, features: {} }
  }
}

export function isSuperadmin(email: string | null | undefined): boolean {
  return String(email || '').toLowerCase() === SUPERADMIN
}
