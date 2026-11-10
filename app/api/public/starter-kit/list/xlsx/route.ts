// The need list calculator as Excel, from the same address as /kit/list (one home, or several units
// in `u`; the shopping grade in `t`). Nothing stored, nothing private.
//   Full order — what to buy: sets, packs and singles, a column per unit, the total, and the link for
//                the chosen grade (Standard / Mid / Luxury).
//   One sheet per unit — the pieces it needs, with Have and a To buy formula.
import { NextRequest, NextResponse } from 'next/server'
import { makeXlsx, colRef, type XCell, type XSheet } from '@/lib/xlsx-lite'
import { sizeFromParams, unitsFromParam } from '@/lib/starter-kit-params'
import { describeSize } from '@/lib/starter-kit'
import { NEED_ROOMS, needList } from '@/lib/need-list'
import { GRADES, buyList, type BuyLine, type Grade } from '@/lib/need-buy'

export const dynamic = 'force-dynamic'
const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const T = (v: string | number, s = 0): XCell => ({ v, s })
const N = (v: number): XCell => ({ v, num: true })

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const get = (k: string) => sp.get(k) ?? undefined
  const units = unitsFromParam(get('u')) || [{ name: 'This home', size: sizeFromParams({ bd: get('bd'), ba: get('ba'), g: get('g'), k: get('k'), no: get('no') }) }]
  const showOpt = sp.get('opt') === '1'
  const grade: Grade = sp.get('t') === 'std' || sp.get('t') === 'lux' ? (sp.get('t') as Grade) : 'mid'
  const gradeLabel = GRADES.find(g => g.k === grade)!.label
  const per = units.map(u => { const lines = needList(u.size).filter(l => l.tier !== 'optional' || showOpt); return { u, lines, buy: buyList(lines) } })

  // Full order
  const rows: XCell[][] = [[T(`Full order — ${units.length} unit${units.length === 1 ? '' : 's'}`, 2)], [T(`Links: ${gradeLabel}. "Stay's pick" is a product from Stay's list; the others are Amazon searches.`, 8)], []]
  rows.push([T('Set', 3), T('Buy', 3), T('Kind', 3), ...units.map(u => T(u.name, 3)), T('Total', 3), T('Link', 3)])
  const links: { ref: string; url: string }[] = []
  const map = new Map<string, { line: BuyLine; qty: number[] }>()
  per.forEach((p, i) => p.buy.forEach(b => { const r = map.get(b.key) || { line: b, qty: units.map(() => 0) }; r.qty[i] += b.qty; map.set(b.key, r) }))
  const order = Array.from(map.values()).sort((a, b) => NEED_ROOMS.indexOf(a.line.group as any) - NEED_ROOMS.indexOf(b.line.group as any))
  for (const r of order) {
    const row = rows.length + 1
    const first = colRef(3), last = colRef(3 + units.length - 1)
    rows.push([T(r.line.group), T(r.line.name + (r.line.kind === 'set' && r.line.contents ? ` — each: ${r.line.contents.map(c => `${c.per} ${c.name.toLowerCase()}`).join(', ')}` : '')),
      T(r.line.kind === 'set' ? 'Set' : r.line.kind === 'pack' ? 'Pack' : 'Each'), ...r.qty.map(q => N(q)), { v: '', f: `SUM(${first}${row}:${last}${row})` },
      T(r.line.shop[grade].pinned ? "Stay's pick" : 'Search', 9)])
    links.push({ ref: colRef(3 + units.length + 1) + row, url: r.line.shop[grade].url })
  }
  rows.push([], [T('Coffee maker: Nespresso or Keurig; Stay supplies the pods. Linen is quoted separately.', 8)])
  const sheets: XSheet[] = [{ name: 'Full order', widths: [20, 60, 8, ...units.map(() => 11), 9, 12], rows, links }]

  // One sheet per unit
  const used = new Set<string>(['Full order'])
  for (const p of per) {
    let name = (p.u.name || 'Unit').replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Unit'
    while (used.has(name)) name = name.slice(0, 26) + ' ' + used.size
    used.add(name)
    const r2: XCell[][] = [[T(p.u.name, 2)], [T(describeSize(p.u.size), 8)], [], ['Set', 'Item', 'Type', 'Needed', 'Have', 'To buy', 'Why this many'].map(h => T(h, 3))]
    for (const l of p.lines) {
      const row = r2.length + 1
      r2.push([T(l.item.room), T(l.item.name), T(TYPE[l.tier]), N(l.count), { v: '' }, { v: '', f: `MAX(0,D${row}-E${row})` }, T(l.rule, 8)])
    }
    sheets.push({ name, widths: [20, 34, 13, 9, 8, 9, 40], rows: r2 })
  }
  const buf = makeXlsx(sheets)
  return new NextResponse(new Uint8Array(buf), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="Stay need list${units.length > 1 ? ' - full order' : ''}.xlsx"`,
    'Cache-Control': 'no-store',
  } })
}
