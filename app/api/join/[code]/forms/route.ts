// The owner's own copies of their W-9 and ACH authorization (?doc=w9|ach), from their portal. Only for the
// owner signed in with their password or emailed link: a link that has no sign-in set up never serves these.
import { NextRequest, NextResponse } from 'next/server'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { signedIn, isProtected } from '@/lib/owner-onboard-auth'
import { w9Pdf, achPdf } from '@/lib/owner-onboard-forms'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const r = await readRecord(params.code)
  if (!r || r.archived || !r.payout) return NextResponse.json({ ok: false, error: 'Nothing on file.' }, { status: 404 })
  if (!isProtected(r) || !signedIn(req, r)) return NextResponse.json({ ok: false, error: 'Sign in to your onboarding page first.' }, { status: 401 })
  const doc = req.nextUrl.searchParams.get('doc') === 'ach' ? 'ach' : 'w9'
  try {
    const bytes = doc === 'ach' ? await achPdf(r) : await w9Pdf(r)
    // every download is on the record (who, which form, when)
    r.payoutLog = [{ at: new Date().toISOString(), by: 'owner', doc: doc as 'w9' | 'ach' }, ...(r.payoutLog || [])].slice(0, 200)
    await saveRecord(r, 'owner').catch(() => null)
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc === 'ach' ? 'ACH-authorization' : 'W-9'}.pdf"`, 'Cache-Control': 'no-store, private' } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
