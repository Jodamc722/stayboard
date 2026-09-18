// A KEY THAT REPAIRS ONE BOOK'S PHOTOS (2026-09-18 audit, P1).
//
// /api/public/place-photo writes `guidebooks.sections[...].photo` and spends Places API calls, and
// it accepted any POST that named a guidebook id. The guest book is public by UUID and has no
// share gate of its own, so the page that renders it now carries a short-lived signed token
// (minted server-side, on the page render) and the route accepts only that — or a signed-in user.
// Same shape as lib/upload-token.ts: "<id>.<expMs>.<hmac>".
import 'server-only'
import { hmacHex, safeEqual } from './signing'

const NS = 'place-photo'
const TTL_MS = 24 * 60 * 60 * 1000   // a guest keeps a book open all day

export function signPlacePhotoToken(guidebookId: string): string {
  const payload = String(guidebookId) + '.' + String(Date.now() + TTL_MS)
  try { return payload + '.' + hmacHex(NS, payload) } catch { return '' }
}

/** True when `token` was minted for THIS guidebook and has not expired. Never throws. */
export function placePhotoTokenValid(token: string | undefined | null, guidebookId: string): boolean {
  if (!token) return false
  const parts = String(token).split('.')
  if (parts.length !== 3) return false
  const [id, expStr, sig] = parts
  if (id !== String(guidebookId)) return false
  const exp = Number(expStr)
  if (!exp || exp < Date.now()) return false
  let good = ''
  try { good = hmacHex(NS, id + '.' + expStr) } catch { return false }
  return safeEqual(sig, good)
}
