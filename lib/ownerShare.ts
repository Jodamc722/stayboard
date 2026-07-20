// Signed owner order-form links - no table needed: the link token is a keyed hash of the
// scope + a server secret, so it cannot be guessed and each scope gets a stable URL.
// scope format: 'b:<building name>' (whole property) or 'u:<listingId>' (single unit).
import { createHash } from 'crypto'

function secret(): string {
  return process.env.OWNER_SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || 'stayboard'
}

export function ownerOrderSig(scope: string): string {
  return createHash('sha256').update('stayboard-owner-orders:' + secret() + ':' + scope).digest('hex').slice(0, 20)
}

export function ownerOrderSigValid(scope: string, k: string): boolean {
  if (!scope || !k) return false
  return ownerOrderSig(scope) === String(k)
}
