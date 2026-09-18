// Password check for the Botanica performance report (2026-09-18, P0-4). Public by design: the
// hotel's Area GM posts the report's OWN password and gets a signed cookie. This is a DIFFERENT
// credential from the vendor share password — a cleaning crew's password never opens owner money.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { BOT_COOKIE, botanicaCookieValid } from '@/lib/shareAuth'
import { familyLogin } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'

export async function GET() {
  const ok = await botanicaCookieValid(cookies().get(BOT_COOKIE)?.value)
  return NextResponse.json({ ok: true, authed: ok })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  return familyLogin(req, 'botanica', String(body.password || ''), 'No Botanica report password is set yet. Set one in Users → share links.')
}
