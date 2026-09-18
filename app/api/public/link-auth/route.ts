// PER-LINK PASSCODE CHECK (2026-09-18). Public by design: the holder of a share link POSTs
// { code, password } and gets a signed cookie for THAT link only (`lk_<code>`, 30 days). Rotating
// the link's passcode, revoking it or letting it expire kills the cookie. Lockout, constant-time
// compare and the cookie all live in lib/passcode-gate.ts.
//
// GET ?code=… answers whether this browser is already in: { authed, label, unset }. Never the hint —
// that is the passcode's last two characters and belongs to the hub only.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { linkLogin, linkCookieName, linkCookieOk, signedInUser } from '@/lib/passcode-gate'
import { getLink } from '@/lib/share-links-server'
import { linkUsable } from '@/lib/share-links'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get('code') || '').toLowerCase()
  const link = await getLink(code)
  if (!link || !linkUsable(link)) return NextResponse.json({ ok: false, authed: false, gone: true })
  const me = await signedInUser()
  const authed = me.signedIn || link.open || linkCookieOk(link, cookies().get(linkCookieName(link.code))?.value)
  return NextResponse.json({ ok: true, authed, label: link.title || link.label || '', unset: !link.open && !link.passcode_hash })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  return linkLogin(req, String(body.code || ''), String(body.password || body.pass || ''))
}
