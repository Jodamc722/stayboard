// Password check for the partner-facing marketing link. Public by design: a partner posts the
// marketing password and gets a cookie holding only a hash. This is a DIFFERENT credential from
// the vendor share password — a marketing partner can never open the ops boards with it.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { MKT_COOKIE, marketingCookieValid } from '@/lib/shareAuth'
import { familyLogin } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await marketingCookieValid(cookies().get(MKT_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  // Lockout, constant-time compare, hash upgrade and the signed 30-day cookie all live in
  // lib/passcode-gate.ts — one implementation for every share-link family.
  return familyLogin(req, 'marketing', String(body.password || ''), 'No marketing password is set yet. Set one in Users → share links.')
}
