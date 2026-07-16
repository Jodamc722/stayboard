// Share-link password check. Public by design: vendors post the shared password and get a
// cookie holding only a hash. Changing the password in Settings invalidates every old cookie.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, tokenFor, currentSharePassword, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const pw = String(body.password || '')
  const cur = await currentSharePassword()
  if (!cur) return NextResponse.json({ ok: false, error: 'No share password is set yet.' }, { status: 503 })
  if (!pw || pw !== cur) return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SHARE_COOKIE, tokenFor(cur), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 })
  return res
}
