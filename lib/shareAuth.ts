// ADMIN / RULES / VAULT passwords — the in-app credentials that are NOT share links.
//
// 2026-09-18: the vendor / marketing / audit / Botanica FAMILY passwords that used to live here
// are gone. Every shared page is now a share_links row with its own passcode; the gate is
// linkGate() / linkLogin() in lib/passcode-gate.ts and the model is lib/share-links.ts.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { passcodeMatches } from '@/lib/passcode-gate'

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
