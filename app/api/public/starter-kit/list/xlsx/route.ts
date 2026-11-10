// The need list calculator as Excel: the same home details as /kit/list, in the same query string,
// counted in pieces from lib/need-list.ts (plates, bowls, forks…). Nothing stored, nothing private.
import { NextRequest, NextResponse } from 'next/server'
import { makeXlsx, type XCell } from '@/lib/xlsx-lite'
import { sizeFromParams } from '@/lib/starter-kit-params'
import { describeSize } from '@/lib/starter-kit'
import { needList } from '@/lib/need-list'

export const dynamic = 'force-dynamic'
const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const T = (v: string | number, s = 0): XCell => ({ v, s })

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const get = (k: string) => sp.get(k) ?? undefined
  const size = sizeFromParams({ bd: get('bd'), ba: get('ba'), g: get('g'), k: get('k'), no: get('no') })
  const showOpt = sp.get('opt') === '1'
  const lines = needList(size).filter(l => l.tier !== 'optional' || showOpt)
  const rows: XCell[][] = [
    [T('What the home needs', 2)], [T(describeSize(size), 8)], [],
    ['Room', 'Item', 'Type', 'Needed', 'Have', 'To buy', 'Why this many'].map(h => T(h, 3)),
  ]
  for (const l of lines) {
    const r = rows.length + 1
    rows.push([T(l.item.room), T(l.item.name), T(TYPE[l.tier]), { v: l.count, num: true }, { v: '', s: 0 }, { v: '', f: `MAX(0,D${r}-E${r})` }, T(l.rule, 8)])
  }
  rows.push([])
  rows.push([T('Enter what the home already has in the Have column; To buy works itself out. Coffee maker: Nespresso or Keurig; Stay supplies the pods. Linen is quoted separately.', 8)])
  const buf = makeXlsx([{ name: 'Need list', widths: [20, 34, 13, 9, 8, 9, 40], rows }])
  return new NextResponse(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="Stay need list.xlsx"',
    'Cache-Control': 'no-store',
  } })
}
