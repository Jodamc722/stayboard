// FIELD BOARD API — one configured board, resolved from its share-link code.
//
// ACCESS, BOTH WAYS (Jon, 2026-08-25): a signed-in Lighthouse user walks straight in; everybody
// else types the board's own passcode, which is checked here and never sent to the browser. A
// board with no passcode of its own still opens for the standing share password, so links that
// work today keep working. Locked responses carry the board's LABEL and nothing else — an
// unlocked board must not leak whose units it covers.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'
import { createClient } from '@/lib/supabase-server'
import { getBoardLink, buildFieldBoard } from '@/lib/field-board'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const link = await getBoardLink(code)
  if (!link) return NextResponse.json({ ok: false, error: 'Unknown or revoked board.' }, { status: 404 })

  let signedIn = false
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    signedIn = !!user
  } catch { signedIn = false }

  const pass = String(req.nextUrl.searchParams.get('pass') || '')
  const shareOk = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value).catch(() => false)
  const passOk = link.passcode ? pass === link.passcode : shareOk
  if (!signedIn && !passOk) {
    return NextResponse.json({
      ok: false, locked: true, label: link.label,
      needsPasscode: !!link.passcode,
      error: pass ? 'That passcode did not match.' : undefined,
    }, { status: pass ? 403 : 200 })
  }

  try {
    return NextResponse.json(await buildFieldBoard(link))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
