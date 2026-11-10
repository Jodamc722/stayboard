// The need list calculator as a branded Excel (lib/need-list-xlsx.ts), from the same address as the
// calculator: one home, or several units in `u`; the grade in `t`; optional extras in `opt`.
// Nothing stored, nothing private — the website version (/kit/plan) asks for an email first, on the page.
import { NextRequest, NextResponse } from 'next/server'
import { sizeFromParams, unitsFromParam } from '@/lib/starter-kit-params'
import { buildNeedListXlsx } from '@/lib/need-list-xlsx'
import type { Grade } from '@/lib/need-buy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const get = (k: string) => sp.get(k) ?? undefined
  const units = unitsFromParam(get('u')) || [{ name: 'This home', size: sizeFromParams({ bd: get('bd'), ba: get('ba'), g: get('g'), k: get('k'), no: get('no') }) }]
  const grade: Grade = sp.get('t') === 'std' || sp.get('t') === 'lux' ? (sp.get('t') as Grade) : 'mid'
  const buf = buildNeedListXlsx(units, sp.get('opt') === '1', grade)
  return new NextResponse(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="Stay Hospitality - ${units.length > 1 ? 'full order' : 'what your home needs'}.xlsx"`,
    'Cache-Control': 'no-store',
  } })
}
