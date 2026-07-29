// PUBLIC day sheet — same data as the app, gated by the share password (one standing link).
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { buildDaySheet } from '@/lib/daysheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    return NextResponse.json(await buildDaySheet(sp.get('date') || '', sp.get('market') || ''))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
