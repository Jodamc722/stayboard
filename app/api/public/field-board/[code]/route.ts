// FIELD BOARD API — one configured board, resolved from its share-link code.
//
// ACCESS, BOTH WAYS (Jon, 2026-08-25): a signed-in Lighthouse user walks straight in; everybody
// else types the board's own passcode, which is checked here and never sent to the browser. A
// board with no passcode of its own still opens for the standing share password, so links that
// work today keep working. Locked responses carry the board's LABEL and nothing else — an
// unlocked board must not leak whose units it covers.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { getBoardLink, buildFieldBoard } from '@/lib/field-board'
import { checkRowPasscode, lockedResponse } from '@/lib/passcode-gate'
import { linkUsable } from '@/lib/share-links'
import { touchLink } from '@/lib/share-links-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// THE PASSCODE TRAVELS IN A POST BODY, NEVER A URL (2026-09-18). GET opens the board only for a
// signed-in user, a share-cookie holder on a board with no passcode of its own, or nobody — the
// phone POSTs { pass } to unlock. A query string lands in logs, history and referrer headers.
async function open(req: NextRequest, code: string, pass: string) {
  const link = await getBoardLink(code)
  if (!link) return NextResponse.json({ ok: false, error: 'Unknown or revoked board.' }, { status: 404 })
  if (!linkUsable(link)) return NextResponse.json({ ok: false, error: 'This board link has expired.' }, { status: 410 })

  // A LIGHTHOUSE USER, not merely a Supabase session (same bar as lib/parking-gate.ts).
  let signedIn = false
  try { const a = await getAccess(); signedIn = !!a.user && a.allowed } catch { signedIn = false }

  // ITS OWN PASSCODE OR NOTHING (2026-09-18). The standing share password is gone; a board made
  // without a passcode is `open` (the code is the capability), otherwise the phone POSTs { pass }.
  if (!signedIn && !link.open) {
    if (!link.passcode_hash) return NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: true, error: 'This board has no passcode yet — ask the office to set one on the Share Links page.' }, { status: 200 })
    const verdict = await checkRowPasscode(req, link, pass)
    if (verdict === 'locked') return lockedResponse({ label: link.label, needsPasscode: true })
    if (verdict !== 'ok') return NextResponse.json({ ok: false, locked: true, label: link.label, needsPasscode: true, error: pass ? 'That passcode did not match.' : undefined }, { status: pass ? 403 : 200 })
  }
  if (!signedIn) touchLink({ id: link.id, code: link.code })

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
