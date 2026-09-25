// PERSONAL READ-ONLY API KEYS (Jon, 2026-09-25).
//
// A key is a person. It reads what that person can see and nothing else, and it can only read:
// the /api/v1 handlers are the only place a key is honoured, and every one of them is a GET.
// Nothing under /api/* that writes will ever accept a key, because nothing there looks for one.
//
//   Authorization: Bearer lh_…      (or)      X-API-Key: lh_…
//
// The plaintext is shown once at creation. We keep its SHA-256; a leaked database cannot be
// turned back into keys. Revoking is a timestamp, never a delete, so the audit trail stays.
import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { accessForEmail, type Access } from './access'

export type ApiKeyRow = { id: string; email: string; label: string; prefix: string; created_at: string; created_by: string | null; last_used_at: string | null; use_count: number; revoked_at: string | null }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
function token(len = 40): string {
  const b = randomBytes(len); let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length]
  return s
}
const hash = (k: string) => createHash('sha256').update(k).digest('hex')

/** Make a key for this person. Returns the plaintext ONCE. */
export async function createApiKey(email: string, label: string, by: string | null): Promise<{ ok: true; key: string; row: ApiKeyRow } | { ok: false; error: string }> {
  const e = String(email || '').toLowerCase().trim()
  if (!e) return { ok: false, error: 'no email' }
  const key = 'lh_' + token(40)
  const row = { email: e, label: String(label || '').slice(0, 80), prefix: key.slice(0, 12), key_hash: hash(key), created_by: by }
  const { data, error } = await supabaseAdmin().from('api_keys').insert(row).select('id,email,label,prefix,created_at,created_by,last_used_at,use_count,revoked_at').single()
  if (error) return { ok: false, error: /relation|does not exist/i.test(error.message) ? 'Run migration 111 first.' : error.message }
  return { ok: true, key, row: data as ApiKeyRow }
}

export async function listApiKeys(email: string): Promise<ApiKeyRow[]> {
  try {
    const { data } = await supabaseAdmin().from('api_keys').select('id,email,label,prefix,created_at,created_by,last_used_at,use_count,revoked_at')
      .eq('email', String(email || '').toLowerCase()).order('created_at', { ascending: false }).limit(50)
    return (data as ApiKeyRow[]) || []
  } catch { return [] }
}

export async function revokeApiKey(id: string, email: string): Promise<boolean> {
  const { error } = await supabaseAdmin().from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('email', String(email || '').toLowerCase()).is('revoked_at', null)
  return !error
}

/** The key on a request, if any: Bearer or X-API-Key. */
export function keyFromRequest(req: Request): string | null {
  const auth = String(req.headers.get('authorization') || '')
  const m = /^Bearer\s+(lh_[A-Za-z0-9]+)\s*$/i.exec(auth)
  if (m) return m[1]
  const x = String(req.headers.get('x-api-key') || '').trim()
  return /^lh_[A-Za-z0-9]+$/.test(x) ? x : null
}

/**
 * Resolve a key to the person's access. Fail-closed on every miss: unknown key, revoked key, or a
 * person who is no longer active all come back null. Touches last_used_at (best effort).
 */
export async function accessForApiKey(key: string): Promise<{ access: Access; keyId: string } | null> {
  try {
    const sb = supabaseAdmin()
    const { data } = await sb.from('api_keys').select('id,email,revoked_at,use_count').eq('key_hash', hash(key)).maybeSingle()
    if (!data || data.revoked_at) return null
    const access = await accessForEmail(String(data.email))
    if (!access || !access.allowed) return null
    sb.from('api_keys').update({ last_used_at: new Date().toISOString(), use_count: (Number(data.use_count) || 0) + 1 }).eq('id', data.id).then(() => {}, () => {})
    return { access, keyId: String(data.id) }
  } catch { return null }
}
