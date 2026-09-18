// ONE SERVER SECRET, ONE HMAC, ONE CONSTANT-TIME COMPARE.
//
// Five files each derived their own signing secret from the service-role key with their own
// fallback chain (lib/edit-access, lib/upload-token, lib/ownerShare, lib/ffe-links, and now the
// passcode cookies). This is the shared helper they can converge on. The secret is the
// service-role key, so it is never in the browser and rotating the key invalidates every signed
// token at once — which is the behaviour you want from a rotation.
//
// NO 'dev-only-secret' FALLBACK. A deployment with no service key would otherwise mint tokens a
// stranger could forge by reading this file. Without a secret, signing throws and the gate that
// needed it stays shut.
import 'server-only'
import crypto from 'crypto'

export function serverSecret(): string {
  const k = process.env.OWNER_SHARE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY1
    || process.env.SUPABASE_SERVICE_ROLE
    || process.env.SUPABASE_SERVICE_KEY
    || ''
  if (!k) throw new Error('No server signing secret is configured (SUPABASE_SERVICE_ROLE_KEY).')
  return k
}

/** hex HMAC-SHA256 of `payload` under a per-purpose namespace so tokens never cross-validate. */
export function hmacHex(namespace: string, payload: string): string {
  return crypto.createHmac('sha256', serverSecret()).update(namespace + ':' + payload).digest('hex')
}

/** Constant-time string equality. Length mismatch is a plain false (it leaks nothing useful). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''))
  if (x.length !== y.length || x.length === 0) return false
  try { return crypto.timingSafeEqual(x, y) } catch { return false }
}

/** sha256 hex of a string — for cache keys and cookie "generations", not for passwords. */
export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}
