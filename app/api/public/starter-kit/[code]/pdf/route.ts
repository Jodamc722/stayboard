// THE STARTER KIT PDF (Jon, 2026-11-10). The client's download of their report, built from what
// they saved. Same capability as the link itself: an unknown or turned-off code is a 404.
import { NextRequest, NextResponse } from 'next/server'
import { openKit } from '@/lib/starter-kit-server'
import { buildKitPdf, kitPdfName } from '@/lib/starter-kit-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const kit = await openKit(String(params.code || ''), false)
  if (!kit) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  try {
    const pdf = await buildKitPdf(kit)
    const name = kitPdfName(kit)
    return new NextResponse(Buffer.from(pdf), { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Could not build the PDF. Try again in a moment.' }, { status: 500 })
  }
}
