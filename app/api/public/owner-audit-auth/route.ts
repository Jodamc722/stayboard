// Password check for the owner-audit share link. Public by design: a reviewer posts the audit
// password and gets a cookie holding only a hash. This is a DIFFERENT credential from the vendor
// and marketing passwords — the audit reviewer sees owner statements, nothing else.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OA_COOKIE, auditCookieValid } from '@/lib/shareAuth'
import { familyLogin } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await auditCookieValid(cookies().get(OA_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  // Lockout, constant-time compare, hash upgrade and the signed 30-day cookie all live in
  // lib/passcode-gate.ts — one implementation for every share-link family.
  return familyLogin(req, 'audit', String(body.password || ''), 'No audit password is set yet. Set one in Users → share links.')
}
