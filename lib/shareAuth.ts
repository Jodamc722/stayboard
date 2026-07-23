// Shared-password gate for the public vendor / front-desk share links.
// One password for all share links (not user accounts). Stored in share_settings (RLS on,
// service-role only). The browser only ever holds a hash, never the password itself.
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const SHARE_COOKIE = 'share_ok'

export function tokenFor(pw: string) { return createHash('sha256').update('stayboard-share:' + pw).digest('hex') }

export async function currentSharePassword(): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', 1).single()
    if (error) { console.error('share_settings read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error('share_settings read', e); return '' }
}

// Fail CLOSED: if no password is configured we deny rather than expose the board.
export async function shareCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  if (!cookieVal) return false
  const cur = await currentSharePassword()
  if (!cur) return false
  return cookieVal === tokenFor(cur)
}

// ADMIN password — gates destructive actions (e.g. deleting a clean from Breezeway).
// Stored as share_settings row id=2. FAIL CLOSED: while no admin password is set,
// destructive actions are simply locked.
export async function currentAdminPassword(): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', 2).maybeSingle()
    if (error) { console.error('admin_settings read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error('admin_settings read', e); return '' }
}

export async function adminPasswordOk(pw: string | undefined | null): Promise<{ ok: boolean; reason: string }> {
  const cur = await currentAdminPassword()
  if (!cur) return { ok: false, reason: 'Delete is locked. Set the admin password in Users \u2192 Share links & security first.' }
  if (!pw || String(pw) !== cur) return { ok: false, reason: 'Wrong admin password.' }
  return { ok: true, reason: '' }
}
