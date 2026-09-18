// Share-link password check. Public by design: vendors post the shared password and get a
// cookie holding only a hash. Changing the password in Settings invalidates every old cookie.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { familyLogin } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  // Lockout, constant-time compare, hash upgrade and the signed 30-day cookie all live in
  // lib/passcode-gate.ts — one implementation for every share-link family.
  return familyLogin(req, 'share', String(body.password || ''), 'No share password is set yet.')
}
