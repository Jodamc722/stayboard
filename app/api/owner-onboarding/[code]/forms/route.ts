// The owner's filled W-9 or ACH authorization, as a PDF download (?doc=w9|ach). Signed-in team with FULL access
// to Owner onboarding only: this is where the tax ID and bank numbers are decrypted. Nothing is stored filled.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { readRecord, saveRecord } from '@/lib/owner-onboard-server'
import { w9Pdf, achPdf } from '@/lib/owner-onboard-forms'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const g = await requireLevel('owner-onboarding', 'full'); if (!g.ok) return g.res
  const r = await readRecord(params.code)
  if (!r?.payout) return NextResponse.json({ ok: false, error: 'The owner has not sent the W-9 and bank details yet.' }, { status: 404 })
  const doc = req.nextUrl.searchParams.get('doc') === 'ach' ? 'ach' : 'w9'
  try {
    const bytes = doc === 'ach' ? await achPdf(r) : await w9Pdf(r)
    // every download is on the record (who, which form, when)
    r.payoutLog = [{ at: new Date().toISOString(), by: String(g.access.email || 'team'), doc: doc as 'w9' | 'ach' }, ...(r.payoutLog || [])].slice(0, 200)
    await saveRecord(r, String(g.access.email || 'team')).catch(() => null)
    const who = (r.custom.ownerName || 'owner').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc === 'ach' ? 'ACH-authorization' : 'W-9'}-${who}.pdf"`, 'Cache-Control': 'no-store, private' } })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
