// THE STARTER KIT NEED LIST AS EXCEL (Jon, 2026-11-10). Same capability as the link itself.
import { NextRequest, NextResponse } from 'next/server'
import { openKit } from '@/lib/starter-kit-server'
import { buildKitXlsx, kitXlsxName } from '@/lib/starter-kit-xlsx'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const kit = await openKit(String(params.code || ''), false)
  if (!kit) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const name = kitXlsxName(kit)
  return new NextResponse(new Uint8Array(buildKitXlsx(kit)), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  } })
}
