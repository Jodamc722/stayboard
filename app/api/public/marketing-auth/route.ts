// Password check for the partner-facing marketing link. Public by design: a partner posts the
// marketing password and gets a cookie holding only a hash. This is a DIFFERENT credential from
// the vendor share password — a marketing partner can never open the ops boards with it.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { MKT_COOKIE, mktTokenFor, currentMarketingPassword, marketingCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await marketingCookieValid(cookies().get(MKT_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const pw = String(body.password || '')
  const cur = await currentMarketingPassword()
  if (!cur) return NextResponse.json({ ok: false, error: 'No marketing password is set yet. Set one in Users → share links.' }, { status: 503 })
  if (!pw || pw !== cur) return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(MKT_COOKIE, mktTokenFor(cur), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 })
  return res
}
