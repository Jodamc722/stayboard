// Shared "team edit password" access for owner-report share links.
// A signed, expiring cookie (sb_edit) grants edit rights without a full account.
// The cookie is HMAC-signed with the server-only service-role key, so it can't be forged client-side.
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { serverSecret } from './signing'

export const EDIT_COOKIE = 'sb_edit'
export const EDIT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// The service-role key stays the key (every edit cookie out there is signed with it). The old
// fallbacks were the project URL — public, it is in every page bundle — and 'dev-only-secret', so a
// deployment missing the key minted cookies anyone could forge (2026-09-28 audit, B-14). Without it
// this now uses the shared server secret, and throws if there is none: the gate stays shut.
function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || serverSecret()
}

// token = "<expiryMs>.<hmac>"
export function signEditToken(expMs: number): string {
  const payload = String(expMs)
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  return payload + '.' + sig
}

export function verifyEditToken(token: string | undefined | null): boolean {
  if (!token) return false
  const i = token.lastIndexOf('.')
  if (i <= 0) return false
  const payload = token.slice(0, i)
  const sig = token.slice(i + 1)
  const exp = Number(payload)
  if (!exp || exp < Date.now()) return false
  const good = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  try { return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) } catch { return false }
}

// Server-side check: is the current request carrying a valid edit cookie?
export function hasEditCookie(): boolean {
  try { return verifyEditToken(cookies().get(EDIT_COOKIE)?.value) } catch { return false }
}

// Password hashing (scrypt). Stored as "s1$<salt>$<hash>".
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const dk = crypto.scryptSync(pw, salt, 32).toString('hex')
  return 's1$' + salt + '$' + dk
}

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 's1') return false
  try {
    const dk = crypto.scryptSync(pw, parts[1], 32).toString('hex')
    return dk.length === parts[2].length && crypto.timingSafeEqual(Buffer.from(dk), Buffer.from(parts[2]))
  } catch { return false }
}
