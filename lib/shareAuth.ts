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

// MARKETING password — its own credential for the partner-facing direct-booking report, kept
// separate from the vendor share password on purpose: a marketing agency gets booking numbers,
// NOT the ops boards. Stored as share_settings row id=3, cookie `mkt_ok`.
// FAIL CLOSED: while no marketing password is set, the partner link stays shut.
export const MKT_COOKIE = 'mkt_ok'

export function mktTokenFor(pw: string) { return createHash('sha256').update('stayboard-marketing:' + pw).digest('hex') }

export async function currentMarketingPassword(): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', 3).maybeSingle()
    if (error) { console.error('marketing_settings read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error('marketing_settings read', e); return '' }
}

export async function marketingCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  if (!cookieVal) return false
  const cur = await currentMarketingPassword()
  if (!cur) return false
  return cookieVal === mktTokenFor(cur)
}

// OWNER AUDIT password — its own credential for the owner-statement audit share link, separate
// from both the vendor and marketing passwords on purpose: whoever works the audit (a VA, an
// accountant) sees owner-level money, NOT the ops boards and NOT the marketing report.
// Stored as share_settings row id=4, cookie `oa_ok`.
// FAIL CLOSED: while no audit password is set, the share link stays shut.
export const OA_COOKIE = 'oa_ok'

export function oaTokenFor(pw: string) { return createHash('sha256').update('stayboard-owner-audit:' + pw).digest('hex') }

export async function currentAuditPassword(): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', 4).maybeSingle()
    if (error) { console.error('audit_settings read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error('audit_settings read', e); return '' }
}

export async function auditCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  if (!cookieVal) return false
  const cur = await currentAuditPassword()
  if (!cur) return false
  return cookieVal === oaTokenFor(cur)
}

export async function adminPasswordOk(pw: string | undefined | null): Promise<{ ok: boolean; reason: string }> {
  const cur = await currentAdminPassword()
  if (!cur) return { ok: false, reason: 'Delete is locked. Set the admin password in Users \u2192 Share links & security first.' }
  if (!pw || String(pw) !== cur) return { ok: false, reason: 'Wrong admin password.' }
  return { ok: true, reason: '' }
}
