// The need list calculator as Excel: the same home details as /kit/list, in the same query string.
// Nothing stored; nothing private — it is the standard list sized to a home.
import { NextRequest, NextResponse } from 'next/server'
import { buildKitXlsx } from '@/lib/starter-kit-xlsx'
import { sizeFromParams } from '@/lib/starter-kit-params'
import { EMPTY_SELECTION } from '@/lib/starter-kit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const get = (k: string) => sp.get(k) ?? undefined
  const size = sizeFromParams({ bd: get('bd'), ba: get('ba'), g: get('g'), k: get('k'), no: get('no') })
  const inc: Record<string, boolean> = {}
  const buf = buildKitXlsx({ code: '', client: 'Need list', property: '', message: '', size, sizeLocked: false, setupFee: null, preparedBy: '',
    createdAt: new Date().toISOString(), selection: { ...EMPTY_SELECTION, inc }, savedAt: null, submitted: null })
  return new NextResponse(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="Stay need list.xlsx"',
    'Cache-Control': 'no-store',
  } })
}
