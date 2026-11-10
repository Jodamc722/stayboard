// The linen calculator as Excel (Jon, 2026-11-10), from what is on the person's screen: the units in
// `u` (JSON, see lib/linens-public.ts) and the tier in `t`. Counts from Jon's standard, no prices,
// vendors or SKUs. Nothing stored. Sheets: Full order (a column per unit and the total) and one per unit.
import { NextRequest, NextResponse } from 'next/server'
import { makeXlsx, colRef, type XCell, type XSheet } from '@/lib/xlsx-lite'
import { getSetting } from '@/lib/app-settings'
import { LINEN_STANDARD_KEY, isLinenTier, linenNeeds, linenTotals, normLinenStandard, parSentence, tierOf } from '@/lib/linens'
import { linenUnitsFromParam, publicLinenStandard } from '@/lib/linens-public'

export const dynamic = 'force-dynamic'
const T = (v: string | number, s = 0): XCell => ({ v, s })
const N = (v: number): XCell => ({ v, num: true })

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const std = publicLinenStandard(normLinenStandard(await getSetting<any>(LINEN_STANDARD_KEY, null)))
  const tier = isLinenTier(sp.get('t')) ? (sp.get('t') as any) : 'mid'
  const units = linenUnitsFromParam(sp.get('u'))
  if (!units.length) return NextResponse.json({ ok: false, error: 'No units' }, { status: 400 })
  const items = new Map(std.items.map(i => [i.id, i] as const))
  const product = (id: string) => { const it = items.get(id); return it ? tierOf(it, tier).product || '' : '' }
  const all = linenTotals(std, units, tier)
  const per = units.map(u => linenTotals(std, [u], tier))

  const rows: XCell[][] = [[T(`Linen — ${units.length} unit${units.length === 1 ? '' : 's'} (${std.tierLabels[tier as 'mid']})`, 2)], [T(parSentence(std), 8)], []]
  rows.push([T('Group', 3), T('Item', 3), T('Size', 3), T('Product', 3), ...units.map(u => T(u.name, 3)), T('Total', 3)])
  for (const r of all.rows.filter(x => x.need > 0)) {
    const row = rows.length + 1
    rows.push([T(r.group), T(r.name), T(r.size || ''), T(product(r.itemId), 8), ...per.map(p => N(p.rows.find(x => x.key === r.key)?.need || 0)),
      { v: '', f: `SUM(${colRef(4)}${row}:${colRef(3 + units.length)}${row})` }])
  }
  const sheets: XSheet[] = [{ name: 'Full order', widths: [10, 22, 12, 36, ...units.map(() => 11), 9], rows }]
  const used = new Set(['Full order'])
  units.forEach((u, i) => {
    let name = u.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Unit'
    while (used.has(name)) name = name.slice(0, 26) + ' ' + used.size
    used.add(name)
    const r2: XCell[][] = [[T(u.name, 2)], [T(`${u.bedrooms} bedrooms · ${u.bathrooms} baths · ${u.guests} guests · beds: ${Object.entries(u.beds).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}`, 8)], [],
      ['Group', 'Item', 'Size', 'On the bed', 'In rotation', 'Needed', 'Have', 'To buy'].map(h => T(h, 3))]
    for (const n of linenNeeds(std, units[i])) {
      const row = r2.length + 1
      r2.push([T(n.group), T(n.name), T(n.size || ''), N(n.perUnitQty), N(n.par), N(n.total), { v: '' }, { v: '', f: `MAX(0,F${row}-G${row})` }])
    }
    sheets.push({ name, widths: [10, 22, 12, 11, 11, 9, 8, 9], rows: r2 })
  })
  return new NextResponse(new Uint8Array(makeXlsx(sheets)), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="Stay linen list.xlsx"', 'Cache-Control': 'no-store',
  } })
}
