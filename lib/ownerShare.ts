// Signed owner order-form links - no table needed: the link token is a keyed hash of the
// scope + a server secret, so it cannot be guessed and each scope gets a stable URL.
// scope format: 'b:<building name>' (whole property) or 'u:<listingId>' (single unit).
import { createHash } from 'crypto'
import { serverSecret } from './signing'

// Same chain as before, so every owner link already sent keeps working; only the last resort
// changed. It was the literal 'stayboard' — printed in this public repo — which made every link
// forgeable on a deployment missing all four variables (2026-09-28 audit, B-14). Now: the shared
// server secret, or a thrown error.
function secret(): string {
  return process.env.OWNER_SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || serverSecret()
}

export function ownerOrderSig(scope: string): string {
  return createHash('sha256').update('stayboard-owner-orders:' + secret() + ':' + scope).digest('hex').slice(0, 20)
}

export function ownerOrderSigValid(scope: string, k: string): boolean {
  if (!scope || !k) return false
  return ownerOrderSig(scope) === String(k)
}
