// ADMIN / RULES / VAULT passwords — the in-app credentials that are NOT share links.
//
// 2026-09-18: the vendor / marketing / audit / Botanica FAMILY passwords that used to live here
// are gone. Every shared page is now a share_links row with its own passcode; the gate is
// linkGate() / linkLogin() in lib/passcode-gate.ts and the model is lib/share-links.ts.
//
// HASHED, LOCKED OUT, NEVER READ BACK (2026-09-28 audit, B-9). All three were stored in plaintext,
// checked with no attempt limit, and the settings screen handed the cleartext back. Now:
//   - SAVED as scrypt (passcode-gate storablePasscode). A plaintext row written before this still
//     works, and its first correct entry rewrites it as a hash — nothing has to be reset.
//   - COMPARED in constant time (passcodeMatches), hash or legacy plaintext.
//   - LOCKED OUT after 5 wrong per address in 15 minutes, per credential (gates pw:admin, pw:rules,
//     pw:vault on the parking_access_log ledger every share-link passcode already uses — so it
//     survives a redeploy — plus that ledger's per-gate ceiling across all addresses, which never
//     binds a signed-in team member). An EMPTY attempt is refused without being counted: that is a
//     form asking, not a guess. The public pages that take the admin password count on their own
//     gate, pw:admin:public, so a stranger's guesses there cannot lock the team's own gate.
//   - READ BACK as "set, and when it last changed" only (credentialStates). The stored value — a
//     hash once used — never leaves the server.
import { headers } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { passcodeMatches, storablePasscode, isStoredHash, isLockedOut, noteWrong, LOCKOUT_MINUTES } from '@/lib/passcode-gate'

// share_settings rows. 1/3/4/7 were the retired family passwords (see lib/share-links-server).
const ADMIN_ID = 2
const RULES_ID = 5
const VAULT_ID = 6
export type CredentialKind = 'admin' | 'rules' | 'vault'
const ROW: Record<CredentialKind, number> = { admin: ADMIN_ID, rules: RULES_ID, vault: VAULT_ID }

async function readStored(id: number, label: string): Promise<string> {
  try {
    const db = supabaseAdmin()
    const { data, error } = await db.from('share_settings').select('password').eq('id', id).maybeSingle()
    if (error) { console.error(label + ' read', error.message); return '' }
    return data && data.password ? String(data.password) : ''
  } catch (e) { console.error(label + ' read', e); return '' }
}

// The caller's address for the lockout counter. Read from the request in scope (every caller is a
// route handler), so the routes that call adminPasswordOk() did not have to change.
function callerIp(): string | null {
  try {
    const h = headers()
    const first = String(h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim()
    return first || null
  } catch { return null }
}

// A legacy plaintext row becomes a hash on its first correct entry. Compare-and-set on the old value
// so a change made meanwhile is never overwritten, and updated_at is left alone: the credential did
// not change, only how it is stored.
async function upgradeIfPlain(id: number, stored: string, pw: string): Promise<void> {
  if (isStoredHash(stored)) return
  try { await supabaseAdmin().from('share_settings').update({ password: storablePasscode(pw) }).eq('id', id).eq('password', stored) } catch { /* the next correct entry tries again */ }
}

type Check = { ok: boolean; reason: string; locked?: boolean }
async function checkCredential(id: number, gate: string, pw: string | undefined | null, msg: { unset: string; wrong: string; noun: string }): Promise<Check> {
  const cur = await readStored(id, gate)
  if (!cur) return { ok: false, reason: msg.unset }
  const ip = callerIp()
  if (await isLockedOut(gate, ip)) return { ok: false, locked: true, reason: 'Too many wrong ' + msg.noun + 's. Try again in ' + LOCKOUT_MINUTES + ' minutes.' }
  const attempt = String(pw || '')
  if (!attempt || !passcodeMatches(attempt, cur)) {
    if (attempt) await noteWrong(gate, ip, 'wrong ' + msg.noun)
    return { ok: false, reason: msg.wrong }
  }
  await upgradeIfPlain(id, cur, attempt)
  return { ok: true, reason: '' }
}

// ADMIN password — gates destructive actions (e.g. deleting a clean from Breezeway).
// Stored as share_settings row id=2. FAIL CLOSED: while no admin password is set,
// destructive actions are simply locked.
/** The STORED value (a hash once used, or a legacy plaintext) — for "is it set", never to compare by hand. */
export async function currentAdminPassword(): Promise<string> {
  return readStored(ADMIN_ID, 'admin_settings')
}

// `surface: 'public'` — the pages anyone with the URL can reach (the guest guide editor and its
// "Sync now", the Salato verification reopen). Same password, its own ledger key (2026-09-29
// review, N8): forty wrong guesses at a public page used to lock the in-app destructive actions too.
export async function adminPasswordOk(pw: string | undefined | null, opts: { surface?: 'app' | 'public' } = {}): Promise<{ ok: boolean; reason: string; locked?: boolean }> {
  return checkCredential(ADMIN_ID, opts.surface === 'public' ? 'pw:admin:public' : 'pw:admin', pw, {
    unset: 'Delete is locked. Set the admin password in Users → Share links & security first.',
    wrong: 'Wrong admin password.',
    noun: 'admin password',
  })
}

// SALATO RULES password — a dedicated credential to EDIT the Salato house/building rules from the
// front-desk share link by people who are NOT signed into the app. Signed-in app users never need
// it. Stored as share_settings row id=5. FAIL CLOSED: while unset, only signed-in app users can
// edit the rules (a share-only viewer cannot).
export async function rulesPasswordOk(pw: string | undefined | null): Promise<{ ok: boolean; reason: string; locked?: boolean }> {
  return checkCredential(RULES_ID, 'pw:rules', pw, {
    unset: 'Editing rules from the share link is locked. Set a rules password in Users → Share links & security first, or sign in.',
    wrong: 'Wrong rules password.',
    noun: 'rules password',
  })
}

// VAULT CODE — the second lock on the vault (Jon, 2026-08-25: "the vault should be password
// protected in admin settings, and when the code is entered it should record who entered it").
// Being signed in gets you the SHELF (titles, usernames, hints); the code is asked on EVERY reveal,
// copy, file open, export and import, and each entry — right or wrong — is written to
// vault_access_log against the person's login. Stored as share_settings row id=6.
// FAIL CLOSED: while no code is set, nothing in the vault can be revealed.
/** The STORED value — see currentAdminPassword. lib/vault.ts checks entries with vaultCodeVerdict. */
export async function currentVaultCode(): Promise<string> {
  return readStored(VAULT_ID, 'vault_code')
}

/**
 * One vault-code entry against the stored value lib/vault.ts already read: the per-address lockout,
 * a constant-time compare, counting a miss, and the hash upgrade. The vault's own per-person limit
 * and its audit rows stay in lib/vault.ts.
 */
export async function vaultCodeVerdict(code: string, stored: string, ip: string | null): Promise<'ok' | 'wrong' | 'locked'> {
  if (await isLockedOut('pw:vault', ip)) return 'locked'
  const attempt = String(code || '')
  if (!attempt || !passcodeMatches(attempt, stored)) {
    if (attempt) await noteWrong('pw:vault', ip, 'wrong vault code')
    return 'wrong'
  }
  await upgradeIfPlain(VAULT_ID, stored, attempt)
  return 'ok'
}

// ── For the settings screen ──────────────────────────────────────────────────────────────────────
export type CredentialState = { set: boolean; changedAt: string | null }

/** Set or not, and when it last changed — for all three at once. Never the value. */
export async function credentialStates(): Promise<Record<CredentialKind, CredentialState>> {
  const out: Record<CredentialKind, CredentialState> = { admin: { set: false, changedAt: null }, rules: { set: false, changedAt: null }, vault: { set: false, changedAt: null } }
  try {
    const { data, error } = await supabaseAdmin().from('share_settings').select('id, password, updated_at').in('id', [ADMIN_ID, RULES_ID, VAULT_ID])
    if (error) { console.error('credential states read', error.message); return out }
    for (const r of (data || []) as any[]) {
      const kind = (Object.keys(ROW) as CredentialKind[]).find(k => ROW[k] === Number(r.id))
      if (kind) out[kind] = { set: !!r.password, changedAt: r.updated_at ? String(r.updated_at) : null }
    }
  } catch (e) { console.error('credential states read', e) }
  return out
}

/** Store a NEW value, hashed. The caller has already checked who may set it and the length. */
export async function saveCredential(kind: CredentialKind, value: string): Promise<{ ok: boolean; error?: string; state?: CredentialState }> {
  const changedAt = new Date().toISOString()
  const { error } = await supabaseAdmin().from('share_settings').upsert({ id: ROW[kind], password: storablePasscode(value), updated_at: changedAt })
  if (error) return { ok: false, error: error.message }
  return { ok: true, state: { set: true, changedAt } }
}
