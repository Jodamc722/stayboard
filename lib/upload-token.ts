// A KEY THAT OPENS ONE DOOR.
//
// The public field-request form (/new-order) needs to attach photos, and /api/audit/photo
// authenticates with a property audit's `share_code`. So the form asked for the share code — and
// the endpoint that handed it out did so to anyone, for any unit, with no account.
//
// That code is not a photo key. It is the audit's whole authority: /api/audit/task lets a valid
// code batch-dispatch that audit's work items to staff, and /api/audit/approve is the OWNER's
// approval link — the code is the only thing standing between a stranger and approving spend. One
// string was doing the work of two very different permissions, and the weaker use leaked it.
//
// So the form gets its own key instead: signed, expiring, and scoped to a single audit id, and it
// authorises exactly one thing — uploading a photo. It cannot dispatch, approve, read or price
// anything, and it cannot be turned into the share code.
//
// Signed with the service-role key, same as lib/edit-access.ts, so it cannot be forged client-side.
import crypto from 'crypto'

const TTL_MS = 2 * 60 * 60 * 1000   // two hours: long enough to fill in a form, short enough that a
                                    // token copied out of a network tab is stale before it is useful

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_URL || 'dev-only-secret'
}

/** token = "<auditId>.<expiryMs>.<hmac>" */
export function signUploadToken(auditId: string, ttlMs = TTL_MS): string {
  const payload = String(auditId) + '.' + String(Date.now() + ttlMs)
  const sig = crypto.createHmac('sha256', secret()).update('upload:' + payload).digest('hex')
  return payload + '.' + sig
}

/** The audit id this token is good for, or null. Never throws — a malformed token is just a no. */
export function verifyUploadToken(token: string | undefined | null): string | null {
  if (!token) return null
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const [auditId, expStr, sig] = parts
  if (!auditId) return null
  const exp = Number(expStr)
  if (!exp || exp < Date.now()) return null
  const good = crypto.createHmac('sha256', secret()).update('upload:' + auditId + '.' + expStr).digest('hex')
  try {
    // Constant time, and only after a length check — timingSafeEqual throws on a length mismatch.
    if (sig.length !== good.length) return null
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? auditId : null
  } catch { return null }
}
