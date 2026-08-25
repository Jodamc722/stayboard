// THE VAULT — encryption, access rules and the audit trail.
//
// SERVER ONLY. This module imports node:crypto and reads VAULT_KEY; it must never be pulled into a
// client bundle. Nothing here is re-exported from a 'use client' file.
//
// THE ONE RULE THAT MATTERS: a plaintext secret exists in exactly two places — the browser of the
// person who typed it, and the browser of a person who explicitly asked to reveal it and was
// allowed to. It is never in the list response, never in a log line, never in an error message.
import crypto from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { currentVaultCode } from './shareAuth'

export const VAULT_BUCKET = 'vault'
export const ITEMS = 'vault_items'
export const GRANTS = 'vault_grants'
export const LOG = 'vault_access_log'

export type VaultKind = 'secret' | 'file' | 'note'
export type VaultLevel = 'view' | 'manage'

// The shelves. Order matters: this is the order the vault renders its groups in, and 'archive'
// is last on purpose — old logins are kept for the day an old account resurfaces, not for daily use.
// Keep in sync with CATEGORIES in components/VaultBoard.tsx.
export const CATEGORIES = [
  { id: 'building', label: 'Building & access' },
  { id: 'channel', label: 'Channel logins' },
  { id: 'email', label: 'Email accounts' },
  { id: 'utility', label: 'Utilities & internet' },
  { id: 'apps', label: 'Apps, vendors & tools' },
  { id: 'revenue', label: 'Revenue & finance' },
  { id: 'company', label: 'Company & legal' },
  { id: 'owner', label: 'Owner & payouts' },
  { id: 'guest', label: 'Guest documents' },
  { id: 'archive', label: 'Old / unused' },
] as const
export const CATEGORY_IDS: string[] = CATEGORIES.map(c => c.id)

/**
 * AES-256-GCM, key from VAULT_KEY.
 *
 * The key is deliberately NOT derived from anything guessable and NOT defaulted. If VAULT_KEY is
 * missing we refuse to encrypt rather than falling back to a hardcoded key — a vault that silently
 * protects nothing is worse than one that plainly refuses to open, because only one of those gets
 * noticed before somebody puts a bank account in it.
 */
function key(): Buffer {
  const raw = process.env.VAULT_KEY || ''
  if (!raw) throw new Error('VAULT_KEY is not set — the vault cannot store secrets until it is.')
  // Accept a 64-char hex key or any passphrase; both end up as 32 bytes.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  return crypto.createHash('sha256').update(raw, 'utf8').digest()
}

export function vaultKeyReady(): boolean {
  try { key(); return true } catch { return false }
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64')
}

export function decryptSecret(packed: string): string {
  const buf = Buffer.from(String(packed), 'base64')
  // 12-byte iv + at least a 16-byte tag; anything shorter is not one of ours.
  if (buf.length < 29) throw new Error('That secret is unreadable.')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const body = buf.subarray(12, buf.length - 16)
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  // GCM throws here if the ciphertext or the key is wrong — which is the point. A silently wrong
  // answer would be indistinguishable from a right one.
  return Buffer.concat([d.update(body), d.final()]).toString('utf8')
}

/** A hint that identifies a secret without giving it away: last 4 characters, masked. */
export function maskHint(plain: string): string {
  const s = String(plain || '')
  if (s.length <= 4) return '•'.repeat(s.length)
  return '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-4)
}

const lower = (s: any) => String(s || '').trim().toLowerCase()

/**
 * Can this person touch this item, and how much?
 *
 * Deny by default. Owner of the item and the workspace superadmin get 'manage'; everyone else gets
 * exactly what a grant row says, and nothing if there isn't one.
 */
export async function accessFor(
  item: { id: string; owner_email?: string | null },
  email: string,
  isSuperadmin: boolean,
): Promise<VaultLevel | null> {
  const me = lower(email)
  if (!me) return null
  if (isSuperadmin) return 'manage'
  if (lower(item.owner_email) === me) return 'manage'
  const { data } = await supabaseAdmin().from(GRANTS)
    .select('level').eq('item_id', item.id).ilike('email', me).maybeSingle()
  const lvl = (data as any)?.level
  return lvl === 'manage' ? 'manage' : lvl === 'view' ? 'view' : null
}

/** Item ids this person has been granted, for filtering the list. */
export async function grantedItemIds(email: string): Promise<string[]> {
  const me = lower(email)
  if (!me) return []
  const { data } = await supabaseAdmin().from(GRANTS).select('item_id').ilike('email', me)
  return ((data || []) as any[]).map(r => String(r.item_id)).filter(Boolean)
}

/**
 * Write the audit trail. Best-effort ON PURPOSE: a logging failure must not block someone from
 * opening a document they are entitled to, and must not roll back a write that already landed.
 * The one thing it never does is record the secret itself.
 */
export async function logAccess(entry: {
  itemId?: string | null
  email?: string | null
  action: string
  detail?: string | null
  ip?: string | null
}): Promise<void> {
  try {
    await supabaseAdmin().from(LOG).insert({
      item_id: entry.itemId || null,
      email: lower(entry.email) || null,
      action: String(entry.action).slice(0, 40),
      detail: entry.detail ? String(entry.detail).slice(0, 500) : null,
      ip: entry.ip ? String(entry.ip).slice(0, 60) : null,
    })
  } catch { /* never let the log break the thing being logged */ }
}

/** Strip anything a list response has no business carrying. */
export function publicItem(row: any, level: VaultLevel | null) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title,
    description: row.description,
    property_id: row.property_id,
    unit_no: row.unit_no,
    reservation_id: row.reservation_id,
    secret_hint: row.secret_hint,
    username: row.username,
    url: row.url,
    // NOT secret_cipher. Never secret_cipher.
    hasSecret: !!row.secret_cipher,
    doc_name: row.doc_name,
    doc_bytes: row.doc_bytes,
    doc_mime: row.doc_mime,
    hasFile: !!row.doc_path,
    expires_on: row.expires_on,
    tags: Array.isArray(row.tags) ? row.tags : [],
    owner_email: row.owner_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
    level,
  }
}

/** The table only exists after migration 017 — say so plainly instead of throwing a 500. */
export function isMissingTable(msg: any): boolean {
  return /relation .* does not exist|does not exist|schema cache|find the table/i.test(String(msg || ''))
}

// ── THE VAULT CODE ─────────────────────────────────────────────────────────────────────────────
// Every reveal/copy/file open/export/import must carry the code. The check itself writes the
// audit row for a WRONG code (so "who is guessing" is answerable); the caller writes the row for
// the successful action, which is the record of who entered it and what they opened.
const WRONG = 'wrong vault code'
const WRONG_LIMIT = 8          // wrong codes per person per window before we stop answering
const WRONG_WINDOW_MIN = 15

/** The code can travel in a POST body or, for GETs, in the x-vault-code header (never the URL). */
export function codeFrom(req: { headers: { get(n: string): string | null } }, body?: any): string {
  const fromBody = body && typeof body.code === 'string' ? body.code : ''
  return String(fromBody || req.headers.get('x-vault-code') || '').trim().slice(0, 200)
}

export type CodeCheck = { ok: true } | { ok: false; status: number; error: string; codeUnset?: boolean; wrongCode?: boolean }

export async function checkVaultCode(opts: {
  code: string; email: string; ip?: string | null; itemId?: string | null; purpose: string
}): Promise<CodeCheck> {
  const cur = await currentVaultCode()
  if (!cur) {
    return { ok: false, status: 503, codeUnset: true,
      error: 'The vault code is not set. An admin sets it at Users & admin → Share links & security; until then nothing in the vault can be opened.' }
  }
  const me = lower(opts.email)
  // Too many wrong codes → stop answering for a while. Counted from the audit log itself, so the
  // limit survives a redeploy and is visible in the same place as everything else.
  try {
    const since = new Date(Date.now() - WRONG_WINDOW_MIN * 60000).toISOString()
    const { count } = await supabaseAdmin().from(LOG).select('id', { count: 'exact', head: true })
      .eq('email', me).eq('action', 'denied').like('detail', WRONG + '%').gte('created_at', since)
    if ((count || 0) >= WRONG_LIMIT) {
      await logAccess({ itemId: opts.itemId, email: me, action: 'denied', detail: WRONG + ' · locked out (' + opts.purpose + ')', ip: opts.ip })
      return { ok: false, status: 429, wrongCode: true, error: 'Too many wrong codes. Try again in ' + WRONG_WINDOW_MIN + ' minutes.' }
    }
  } catch { /* counting failures never block a correct code */ }
  if (!opts.code || opts.code !== cur) {
    await logAccess({ itemId: opts.itemId, email: me, action: 'denied', detail: WRONG + ' (' + opts.purpose + ')', ip: opts.ip })
    return { ok: false, status: 403, wrongCode: true, error: opts.code ? 'Wrong vault code.' : 'Enter the vault code.' }
  }
  return { ok: true }
}

/** The detail string every successful code-gated action carries, so the log reads the same everywhere. */
export function codeEntered(extra?: string | null): string {
  return 'code entered' + (extra ? ' · ' + String(extra).slice(0, 160) : '')
}

/** Vault-wide log — every entry of the code, right or wrong, across every item. Admins only (caller checks). */
export async function vaultWideLog(days = 30, limit = 500): Promise<any[]> {
  const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86400000).toISOString()
  const db = supabaseAdmin()
  const { data } = await db.from(LOG).select('id, item_id, email, action, detail, ip, created_at')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
  const rows = (data || []) as any[]
  const ids = Array.from(new Set(rows.map(r => r.item_id).filter(Boolean)))
  const titles: Record<string, string> = {}
  if (ids.length) {
    const { data: items } = await db.from(ITEMS).select('id, title').in('id', ids)
    for (const it of (items || []) as any[]) titles[String(it.id)] = String(it.title || '')
  }
  return rows.map(r => ({ ...r, title: r.item_id ? (titles[String(r.item_id)] || '(deleted item)') : null }))
}
