// The need list calculator as a branded Excel (lib/need-list-xlsx.ts), from the same address as the
// calculator: one home, or several units in `u`; the grade in `t`; optional extras in `opt`; an optional
// property name in `p` for the file name ("<Property> - Starter kit - YYYY-MM-DD.xlsx").
// Nothing stored, nothing private — the website version (/kit/plan) asks for an email first, on the page.
import { NextRequest, NextResponse } from 'next/server'
import { sizeFromParams, unitsFromParam } from '@/lib/starter-kit-params'
import { buildNeedListXlsx, needListXlsxName } from '@/lib/need-list-xlsx'
import type { Grade } from '@/lib/need-buy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const get = (k: string) => sp.get(k) ?? undefined
  const units = unitsFromParam(get('u')) || [{ name: 'This home', size: sizeFromParams({ bd: get('bd'), ba: get('ba'), g: get('g'), k: get('k'), no: get('no') }) }]
  const grade: Grade = sp.get('t') === 'std' || sp.get('t') === 'lux' ? (sp.get('t') as Grade) : 'mid'
  const label = (sp.get('p') || '').slice(0, 80) || null
  const buf = buildNeedListXlsx(units, sp.get('opt') === '1', grade, label)
  const name = needListXlsxName(units, label)
  return new NextResponse(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  } })
}
