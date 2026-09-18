// SHARE LINK ROWS — the server half of lib/share-links.ts: read one, count a use, mint a passcode,
// and the one-time hashing of any legacy plaintext passcode migration 101 carried across.
import 'server-only'
import { randomBytes, randomInt } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { hashPassword } from './edit-access'
import { hintOf, type ShareLinkRow } from './share-links'

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i

export function normalizeRow(row: any): ShareLinkRow {
  const scope = row.scope && typeof row.scope === 'object' ? row.scope : {}
  return {
    ...row,
    code: str(row.code), kind: str(row.kind) || 'custom-page', title: row.title ?? row.label ?? null,
    audience: str(row.audience) || 'internal', scope,
    passcode_hash: row.passcode_hash ? str(row.passcode_hash) : null, passcode_hint: row.passcode_hint ? str(row.passcode_hint) : null,
    open: row.open === true, expires_at: row.expires_at || null, revoked_at: row.revoked_at || null,
    last_used_at: row.last_used_at || null, uses: Number(row.uses) || 0, notes: row.notes ?? null,
  }
}

/** One row by code, revoked or not (the gate decides what revoked means). Null for a bad code. */
export async function getLink(code: string): Promise<ShareLinkRow | null> {
  const c = str(code).trim().toLowerCase()
  if (!CODE_RE.test(c)) return null
  try {
    const { data } = await supabaseAdmin().from('share_links').select('*').eq('code', c).limit(1)
    const row = (data || [])[0]
    return row ? normalizeRow(row) : null
  } catch { return null }
}

// uses / last_used_at, at most once a minute per link per instance — a board polling every thirty
// seconds must not turn into a write per poll. Fire-and-forget: a failed count never blocks a page.
const touched: Map<string, number> = new Map()
export function touchLink(link: Pick<ShareLinkRow, 'id' | 'code'>): void {
  const last = touched.get(link.code) || 0
  const now = Date.now()
  if (now - last < 60 * 1000) return
  touched.set(link.code, now)
  if (touched.size > 500) { const first = touched.keys().next().value; if (first) touched.delete(first) }
  const run = async () => {
    const db = supabaseAdmin()
    const { data } = await db.from('share_links').select('uses').eq('id', link.id).limit(1)
    const uses = Number(((data || [])[0] as any)?.uses) || 0
    await db.from('share_links').update({ uses: uses + 1, last_used_at: new Date(now).toISOString() }).eq('id', link.id)
  }
  run().catch(() => undefined)
}

/** 8 characters from an alphabet with no 0/O/1/l/I — read aloud over the phone without a mix-up. */
export function generatePasscode(len = 8): string {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += A[randomInt(0, A.length)]
  return out
}

export function newCode(): string { return randomBytes(8).toString('hex') }

const isHash = (stored: string) => /^s1\$[0-9a-f]+\$[0-9a-f]+$/i.test(String(stored || ''))

/**
 * NO PLAINTEXT AT REST. Migration 101 moved every old `passcode` (some scrypt, some legacy
 * plaintext) into passcode_hash; SQL cannot scrypt, so the first hub load does it here — it has
 * the cleartext in hand, hashes it, and records the two-character hint. The passcode itself keeps
 * working; only the way it is stored changes. Idempotent and cheap once nothing is left to do.
 */
export async function hashLegacyPasscodes(): Promise<number> {
  const db = supabaseAdmin()
  const { data } = await db.from('share_links').select('id, passcode_hash').not('passcode_hash', 'is', null).limit(500)
  let n = 0
  for (const r of (data || []) as any[]) {
    const v = str(r.passcode_hash)
    if (!v || isHash(v)) continue
    const { error } = await db.from('share_links').update({ passcode_hash: hashPassword(v), passcode_hint: hintOf(v) }).eq('id', r.id)
    if (!error) n++
  }
  return n
}
