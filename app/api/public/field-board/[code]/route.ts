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
import { getAccess } from '@/lib/access'
import { getBoardLink, buildFieldBoard } from '@/lib/field-board'
import { checkLinkPasscode, lockedResponse } from '@/lib/passcode-gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// THE PASSCODE TRAVELS IN A POST BODY, NEVER A URL (2026-09-18). GET opens the board only for a
// signed-in user, a share-cookie holder on a board with no passcode of its own, or nobody — the
// phone POSTs { pass } to unlock. A query string lands in logs, history and referrer headers.
async function open(req: NextRequest, code: string, pass: string) {
  const link = await getBoardLink(code)
  if (!link) return NextResponse.json({ ok: false, error: 'Unknown or revoked board.' }, { status: 404 })

  // A LIGHTHOUSE USER, not merely a Supabase session (same bar as lib/parking-gate.ts).
  let signedIn = false
  try { const a = await getAccess(); signedIn = !!a.user && a.allowed } catch { signedIn = false }

  if (!signedIn) {
    if (link.passcode) {
      const verdict = await checkLinkPasscode(req, 'board:' + code, pass, String(link.passcode))
      if (verdict === 'locked') return lockedResponse({ label: link.label, needsPasscode: true })
      if (verdict !== 'ok') return NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: true, error: pass ? 'That passcode did not match.' : undefined }, { status: pass ? 403 : 200 })
    } else {
      const shareOk = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value).catch(() => false)
      if (!shareOk) return NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: false }, { status: 200 })
    }
  }

  try {
    return NextResponse.json(await buildFieldBoard(link))
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return open(req, String(params.code || ''), '')
}
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({} as any))
  return open(req, String(params.code || ''), String(body?.pass || ''))
}
