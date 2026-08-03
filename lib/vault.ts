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

export const VAULT_BUCKET = 'vault'
export const ITEMS = 'vault_items'
export const GRANTS = 'vault_grants'
export const LOG = 'vault_access_log'

export type VaultKind = 'secret' | 'file' | 'note'
export type VaultLevel = 'view' | 'manage'

export const CATEGORIES = [
  { id: 'building', label: 'Building & vendor' },
  { id: 'guest', label: 'Guest documents' },
  { id: 'company', label: 'Company & legal' },
  { id: 'owner', label: 'Owner & payouts' },
] as const

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
