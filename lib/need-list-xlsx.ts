// THE NEED LIST AS A BRANDED WORKBOOK (Jon, 2026-11-10: "make the Excel format beautiful… a free thing
// to share online… have our email and phone"). One builder for both calculator links (/kit/list and
// /kit/plan), so every downloaded copy carries the Stay letterhead and the way to reach us.
//   Need list (one home) or Full order (several units): what to buy — sets, packs, singles — with the
//     quantity per unit, the total and the shop link for the chosen grade.
//   One sheet per home: every piece, its type, Needed, a yellow Have column to fill in, and To buy.
// Styles are lib/xlsx-lite's branded set (11-25).
import 'server-only'
import { makeXlsx, colRef, type XCell, type XSheet } from './xlsx-lite'
import { describeSize } from './starter-kit'
import { NEED_ROOMS, needList } from './need-list'
import { GRADES, buyList, type BuyLine, type Grade } from './need-buy'
import { STAY_CONTACT } from './need-list-contact'
import type { NeedUnit } from './starter-kit-params'

const TYPE = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const TYPE_STYLE = { must: 18, recommended: 19, optional: 20 } as const
const C = (v: string | number, s: number): XCell => ({ v, s })
const N = (v: number, s = 17): XCell => ({ v, num: true, s })
const pad = (row: XCell[], n: number, s: number) => { while (row.length < n) row.push({ v: '', s }); return row }

/** The letterhead every sheet opens with: name band, what this sheet is, and how to reach Stay. */
function letterhead(cols: number, title: string, sub: string): { rows: XCell[][]; merges: string[]; heights: Record<number, number> } {
  const last = colRef(cols - 1)
  return {
    rows: [
      pad([C(`${STAY_CONTACT.company.toUpperCase()}   ·   ${title}`, 11)], cols, 11),
      pad([C(sub, 12)], cols, 12),
      pad([C(`Want help managing your rental in South Florida?  Give ${STAY_CONTACT.person?.name.split(' ')[0] || 'us'} a call and see how we can help.`, 22)], cols, 22),
      pad([C([STAY_CONTACT.person?.phone || STAY_CONTACT.phone, STAY_CONTACT.person?.email || STAY_CONTACT.email, STAY_CONTACT.web].join('   ·   '), 22)], cols, 22),
      [],
    ],
    merges: [`A1:${last}1`, `A2:${last}2`, `A3:${last}3`, `A4:${last}4`],
    heights: { 1: 38, 2: 22, 3: 24, 4: 22 },
  }
}

export function buildNeedListXlsx(units: NeedUnit[], showOpt: boolean, grade: Grade): Buffer {
  const gradeLabel = GRADES.find(g => g.k === grade)!.label
  const per = units.map(u => { const lines = needList(u.size).filter(l => l.tier !== 'optional' || showOpt); return { u, lines, buy: buyList(lines) } })
  const multi = units.length > 1

  // ── what to buy ──
  const cols = 5 + units.length + (multi ? 1 : 0)
  const head = letterhead(cols, multi ? `Full order for ${units.length} units` : 'What your home needs',
    multi ? `${units.map(x => `${x.name}: ${describeSize(x.size)}`).join('   |   ')}   ·   ${gradeLabel} picks` : `${describeSize(units[0].size)}   ·   ${gradeLabel} picks`)
  const rows = head.rows
  const links: { ref: string; url: string }[] = []
  rows.push([C('What to buy', 13), C('Buy as', 13), ...units.map(x => C(multi ? x.name : 'Qty', 13)), ...(multi ? [C('Total', 13)] : []), C('Shop', 13), C("Stay's pick", 13), C("What's in it", 13)])
  const headerRow = rows.length
  const map = new Map<string, { line: BuyLine; qty: number[] }>()
  per.forEach((p, i) => p.buy.forEach(b => { const r = map.get(b.key) || { line: b, qty: units.map(() => 0) }; r.qty[i] += b.qty; map.set(b.key, r) }))
  const order = Array.from(map.values())
  for (const room of NEED_ROOMS) {
    const group = order.filter(r => r.line.group === room)
    if (!group.length) continue
    rows.push(pad([C(room, 14)], cols, 14))
    for (const r of group) {
      const row = rows.length + 1
      const kind = r.line.kind === 'set' ? 'Set' : r.line.kind === 'pack' ? 'Pack' : 'Each'
      const shopCol = 2 + units.length + (multi ? 1 : 0)
      rows.push([C(r.line.name, 15), C(kind, 16), ...r.qty.map(q => N(q)),
        ...(multi ? [{ v: '', f: `SUM(${colRef(2)}${row}:${colRef(1 + units.length)}${row})`, s: 17 } as XCell] : []),
        C('Shop', 21),
        C(r.line.shop[grade].pick ? "★ Stay's pick" : '', 19),
        C(r.line.contents ? r.line.contents.map(c => `${c.per} ${c.name.toLowerCase()}`).join(', ') : '', 16)])
      links.push({ ref: colRef(shopCol) + row, url: r.line.shop[grade].url })
      if (r.line.shop[grade].pick) links.push({ ref: colRef(shopCol + 1) + row, url: r.line.shop[grade].pick! })
    }
  }
  rows.push([], [C(`Sets are listed where items are sold as sets; anything a set leaves short is bought separately. Shop opens Amazon to that grade of the item; Stay's pick, where shown, opens the exact product on Stay's own list. The coffee maker is a Nespresso or Keurig pod machine. Linen is quoted separately.`, 25)])
  head.merges.push(`A${rows.length}:${colRef(cols - 1)}${rows.length}`)
  head.heights[rows.length] = 48
  const buySheet: XSheet = { name: multi ? 'Full order' : 'What to buy', widths: [46, 9, ...units.map(() => multi ? 12 : 8), ...(multi ? [9] : []), 10, 14, 54], rows, links,
    merges: head.merges, heights: head.heights, freezeRows: headerRow, hideGrid: true }

  // ── one sheet per home: every piece, with Have to fill in ──
  const used = new Set([buySheet.name])
  const homeSheets: XSheet[] = per.map(p => {
    let name = (multi ? p.u.name : 'Every piece').replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Unit'
    while (used.has(name)) name = name.slice(0, 26) + ' ' + used.size
    used.add(name)
    const h = letterhead(6, multi ? p.u.name : 'Every piece, counted', `${describeSize(p.u.size)}   ·   fill in the yellow Have column and To buy works itself out`)
    const r2 = h.rows
    r2.push(['Item', 'Type', 'Needed', 'Have', 'To buy', 'Why this many'].map(x => C(x, 13)))
    const hr = r2.length
    for (const room of NEED_ROOMS) {
      const ls = p.lines.filter(l => l.item.room === room)
      if (!ls.length) continue
      r2.push(pad([C(`${room}  ·  ${ls.reduce((a, l) => a + l.count, 0)} pieces`, 14)], 6, 14))
      for (const l of ls) {
        const row = r2.length + 1
        r2.push([C(l.item.name, 15), C(TYPE[l.tier], TYPE_STYLE[l.tier]), N(l.count), { v: '', s: 23 }, { v: '', f: `MAX(0,C${row}-D${row})`, s: 24 }, C(l.rule, 16)])
      }
    }
    return { name, widths: [36, 14, 10, 10, 10, 46], rows: r2, merges: h.merges, heights: h.heights, freezeRows: hr, hideGrid: true }
  })
  return makeXlsx([buySheet, ...homeSheets])
}
