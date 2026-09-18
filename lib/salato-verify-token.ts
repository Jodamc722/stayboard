// THE SALATO VERIFY LINK IS SIGNED (2026-09-18 audit, P0-3).
//
// /salato/verify/<token> used to take the raw Guesty reservation id. Reservation ids are not
// secrets — they are in every Guesty URL, every sync log, every email subject the team sends — so
// anyone holding one could read the guest's name and dates, upload an ID and a selfie in their
// name (overwriting the real ones, upsert: true), and trigger the "verification completed" email
// to the building. The token is now `<rid>.<hmac>`: the id still says WHICH stay, the signature
// says the link was issued by this server. Nothing in the database changes; the front-desk boards
// simply hand out signed links instead of bare ids, and the API refuses anything unsigned.
import 'server-only'
import { hmacHex, safeEqual } from './signing'

const NS = 'salato-verify'
const RID_RE = /^[a-z0-9]{6,40}$/i

export function salatoVerifyToken(rid: string): string {
  const id = String(rid || '').trim()
  if (!RID_RE.test(id)) return ''
  return id + '.' + hmacHex(NS, id).slice(0, 32)
}

/** The reservation id a token is good for, or null. Never throws — a bad token is just a no. */
export function salatoVerifyRid(token: string | undefined | null): string | null {
  const t = String(token || '').trim()
  const i = t.indexOf('.')
  if (i <= 0) return null
  const rid = t.slice(0, i); const sig = t.slice(i + 1)
  if (!RID_RE.test(rid) || !sig) return null
  let good = ''
  try { good = hmacHex(NS, rid).slice(0, 32) } catch { return null }
  return safeEqual(sig, good) ? rid : null
}
