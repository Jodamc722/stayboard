// THE BYTES BEHIND A PERMIT TOKEN.
//
// The bucket is private and its signed reads live five minutes, so nothing durable can point at
// one. This route is the durable thing: /permit/<token>/file resolves the token every time it is
// opened and redirects to a read minted right then.
//
// NO CACHE, ANYWHERE. A 302 to a five-minute URL that a CDN held for an hour would answer a guest
// on their arrival day with a link that expired before breakfast — and, worse, would keep serving
// the OLD code after a replacement, which is the one failure this whole design exists to prevent.
import { NextRequest, NextResponse } from 'next/server'
import { permitByToken, signedForPath, logParking } from '@/lib/parking'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await permitByToken(String(params.token || ''))
  // Unknown, malformed, voided, spare and finished-stay all answer with a 404 — a token that does
  // not resolve says nothing about what it used to open. Only the wording differs, and only so a
  // guest whose stay has ended is not told something went wrong.
  if (!r.ok) {
    return new NextResponse(
      r.reason === 'expired'
        ? 'This parking pass expired when the stay ended.'
        : 'This parking pass is no longer available.',
      { status: 404 },
    )
  }
  const p = r

  // THE ONE SURFACE HERE WITH NO PASSCODE, so it is the one that most needs a trail. Migration 093
  // calls parking_access_log "the audit trail for a credential a third party can mint and read";
  // a pass that was opened, and when, belongs in it as much as an upload does.
  if (p.sourceCode) {
    await logParking({
      code: p.sourceCode, action: 'pass', detail: (p.view.unit || 'unit') + ' \u00b7 guest opened their pass',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    })
  }

  const url = await signedForPath(p.storage_path)
  if (!url) return new NextResponse('That pass could not be opened right now. Try again shortly.', { status: 503 })

  const res = NextResponse.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate')
  return res
}
