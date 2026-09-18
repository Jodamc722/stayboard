// KEPT FOR OLD PAGES IN OLD BROWSER TABS (2026-09-18). The family password this route used to
// check is retired; it now logs into the per-link row named in the body via lib/passcode-gate. New
// code calls /api/public/link-auth with { code, password } directly.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { linkLogin, linkCookieName, linkCookieOk, signedInUser } from '@/lib/passcode-gate'
import { getLink } from '@/lib/share-links-server'

export const dynamic = 'force-dynamic'
const CODE = ''

export async function GET(req: NextRequest) {
  const code = CODE || String(req.nextUrl.searchParams.get('code') || '')
  const link = await getLink(code)
  if (!link) return NextResponse.json({ ok: true, authed: false })
  const me = await signedInUser()
  return NextResponse.json({ ok: true, authed: me.signedIn || linkCookieOk(link, cookies().get(linkCookieName(link.code))?.value) })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  return linkLogin(req, CODE || String(body.code || ''), String(body.password || ''))
}
