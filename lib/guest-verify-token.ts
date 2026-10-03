// THE GUEST VERIFY LINK IS SIGNED — same shape as the Salato one (lib/salato-verify-token): the
// reservation id says which stay, the HMAC says the link was issued by us. Any building, any channel.
import 'server-only'
import { hmacHex, safeEqual } from './signing'

const NS = 'guest-verify'
const RID_RE = /^[a-z0-9]{6,40}$/i

export function guestVerifyToken(rid: string): string {
  const id = String(rid || '').trim()
  if (!RID_RE.test(id)) return ''
  return id + '.' + hmacHex(NS, id).slice(0, 32)
}
export function guestVerifyRid(token: string | undefined | null): string | null {
  const t = String(token || '').trim()
  const i = t.indexOf('.')
  if (i <= 0) return null
  const rid = t.slice(0, i); const sig = t.slice(i + 1)
  if (!RID_RE.test(rid) || !sig) return null
  let good = ''
  try { good = hmacHex(NS, rid).slice(0, 32) } catch { return null }
  return safeEqual(sig, good) ? rid : null
}
export function guestVerifyUrl(rid: string, base?: string): string {
  const b = (base || process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/$/, '')
  return b + '/verify/' + guestVerifyToken(rid)
}
