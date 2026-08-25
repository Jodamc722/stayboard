// THE UNLOCK — type the code once, get sixty seconds.
//
// Jon 2026-08-25: "when you type a code in at top give us 1 min, still have to click reveal, that
// how we can track." The window removes the typing, not the tracking: revealing is still a
// per-item click and every one still writes its own row naming the person and the item.
//
// What this endpoint hands back is an HttpOnly cookie signed over the caller's OWN email, so it
// cannot be forged and cannot be handed to the person at the next desk. JavaScript on the page
// never sees it; it just watches a countdown and asks again when that hits zero.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import {
  logAccess, checkVaultCode, codeFrom, mintUnlock, unlockValid,
  UNLOCK_COOKIE, UNLOCK_SECONDS, vaultKeyReady,
} from '@/lib/vault'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

/** GET — how much of the window is left, so a reload does not pretend to be locked. */
export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const open = unlockValid(req.cookies.get(UNLOCK_COOKIE)?.value, String(access.email || ''))
  return NextResponse.json({ ok: true, open, seconds: UNLOCK_SECONDS })
}

/** POST { code } — verify and open the window. Wrong codes are logged and rate-limited upstream. */
export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')
  const b = await req.json().catch(() => ({} as any))

  if (!vaultKeyReady()) {
    return NextResponse.json({ ok: false, error: 'VAULT_KEY is not set on the server, so the vault cannot be unlocked.' }, { status: 503 })
  }

  const gate = await checkVaultCode({ code: codeFrom(req, b), email: me, ip: ipOf(req), purpose: 'unlock' })
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error, codeUnset: !!gate.codeUnset, wrongCode: !!gate.wrongCode }, { status: gate.status })
  }

  const { token, expires } = mintUnlock(me)
  // The row that answers "who opened the vault, and when" — separate from the per-item reveals,
  // which answer "and what did they actually look at".
  await logAccess({ itemId: null, email: me, action: 'unlock', detail: 'code entered · ' + UNLOCK_SECONDS + 's window', ip: ipOf(req) })

  const res = NextResponse.json({ ok: true, expires, seconds: UNLOCK_SECONDS })
  res.cookies.set(UNLOCK_COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: UNLOCK_SECONDS,
  })
  return res
}

/** DELETE — "Lock now". Walking away should not cost you sixty seconds of exposure. */
export async function DELETE(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await logAccess({ itemId: null, email: String(access.email || ''), action: 'lock', detail: 'locked early', ip: ipOf(req) })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(UNLOCK_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
