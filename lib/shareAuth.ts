// Shared-password gate for the public vendor / front-desk share links.
// One password for all share links (not user accounts). Stored in share_settings (RLS on,
// service-role only). The browser only ever holds a signed, expiring cookie, never the password.
//
// 2026-09-18: the compare, the lockout, the hashing and the cookie all moved to
// lib/passcode-gate.ts (one implementation for every family). The names below are kept so the
// forty-odd routes that call shareCookieValid() and friends did not have to change.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { familyCookieValid, familyStored, passcodeMatches, FAMILY } from '@/lib/passcode-gate'

export const SHARE_COOKIE = FAMILY.share.cookie

/** The STORED value (a scrypt hash once upgraded, legacy plaintext until then). '' = unset. */
export async function currentSharePassword(): Promise<string> { return familyStored('share') }

// Fail CLOSED: if no password is configured we deny rather than expose the board.
export async function shareCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  return familyCookieValid('share', cookieVal)
}

// BOTANICA REPORT (2026-09-18, P0-4) — the owner money report for the hotel's Area GM used to open
// on the VENDOR share password, i.e. the credential every cleaning crew holds. Its own row (id=7),
// its own cookie. FAIL CLOSED while unset.
export const BOT_COOKIE = FAMILY.botanica.cookie
export async function currentBotanicaPassword(): Promise<string> { return familyStored('botanica') }
export async function botanicaCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  return familyCookieValid('botanica', cookieVal)
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
export const MKT_COOKIE = FAMILY.marketing.cookie

export async function currentMarketingPassword(): Promise<string> { return familyStored('marketing') }

export async function marketingCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  return familyCookieValid('marketing', cookieVal)
}

// OWNER AUDIT password — its own credential for the owner-statement audit share link, separate
// from both the vendor and marketing passwords on purpose: whoever works the audit (a VA, an
// accountant) sees owner-level money, NOT the ops boards and NOT the marketing report.
// Stored as share_settings row id=4, cookie `oa_ok`.
// FAIL CLOSED: while no audit password is set, the share link stays shut.
export const OA_COOKIE = FAMILY.audit.cookie

export async function currentAuditPassword(): Promise<string> { return familyStored('audit') }

export async function auditCookieValid(cookieVal: string | undefined | null): Promise<boolean> {
  return familyCookieValid('audit', cookieVal)
}

export async function adminPasswordOk(pw: string | undefined | null): Promise<{ ok: boolean; reason: string }> {
  const cur = await currentAdminPassword()
  if (!cur) return { ok: false, reason: 'Delete is locked. Set the admin password in Users \u2192 Share links & security first.' }
  if (!pw || !passcodeMatches(String(pw), cur)) return { ok: false, reason: 'Wrong admin password.' }
  return { ok: true, reason: '' }
}

// SALATO RULES password \u2014 a dedicated credential to EDIT the Salato house/building rules from the
// front-desk share link by people who are NOT signed into the app. Signed-in app users never need
// it. Stored as share_settings row id=5. FAIL CLOSED: while unset, only signed-in app users can
// edit the rules (a share-only viewer cannot).
export async function currentRulesPassword(): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', 5).maybeSingle()
    if (error) { console.error('rules_settings read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error('rules_settings read', e); return '' }
}

export async function rulesPasswordOk(pw: string | undefined | null): Promise<{ ok: boolean; reason: string }> {
  const cur = await currentRulesPassword()
  if (!cur) return { ok: false, reason: 'Editing rules from the share link is locked. Set a rules password in Users \u2192 Share links & security first, or sign in.' }
  if (!pw || !passcodeMatches(String(pw), cur)) return { ok: false, reason: 'Wrong rules password.' }
  return { ok: true, reason: '' }
}

// VAULT CODE — the second lock on the vault (Jon, 2026-08-25: "the vault should be password
// protected in admin settings, and when the code is entered it should record who entered it").
// Being signed in gets you the SHELF (titles, usernames, hints); the code is asked on EVERY reveal,
// copy, file open, export and import, and each entry — right or wrong — is written to
// vault_access_log against the person's login. Stored as share_settings row id=6.
// FAIL CLOSED: while no code is set, nothing in the vault can be revealed.
export async function currentVaultCode(): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', 6).maybeSingle()
    if (error) { console.error('vault_code read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error('vault_code read', e); return '' }
}
