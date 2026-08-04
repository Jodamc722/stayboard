// Password check for the owner-audit share link. Public by design: a reviewer posts the audit
// password and gets a cookie holding only a hash. This is a DIFFERENT credential from the vendor
// and marketing passwords — the audit reviewer sees owner statements, nothing else.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OA_COOKIE, oaTokenFor, currentAuditPassword, auditCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await auditCookieValid(cookies().get(OA_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const pw = String(body.password || '')
  const cur = await currentAuditPassword()
  if (!cur) return NextResponse.json({ ok: false, error: 'No audit password is set yet. Set one in Users → share links.' }, { status: 503 })
  if (!pw || pw !== cur) return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(OA_COOKIE, oaTokenFor(cur), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 90 })
  return res
}
