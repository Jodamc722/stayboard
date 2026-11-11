// THE NEED LIST AS A BRANDED WORKBOOK (Jon, 2026-11-10: "make the Excel format beautiful… a free thing
// to share online… have our email and phone"; 2026-11-11: "there should be a must have, recommended and
// optional in the excel download, also the multi unit should show the actual number of items you need
// like it does in the unit level… add a checkmark list… when they order they can check it off and a
// checklist for added to unit"). One builder for both calculator links (/kit/list and /kit/plan).
//
// Every count comes from lib/need-list's needList(size) for each unit — the same per-unit function the
// one-home sheet uses — so the full order is the sum of the units, piece by piece, never re-derived.
//
//   One home:   Checklist  — every piece by tier (Must have / Recommended / Optional colour bands): Needed,
//                            Have (yellow, fill in), To buy, ☐ Ordered, ☐ Added to unit, why that many.
//               Shopping   — what to buy (sets, packs, singles) with Amazon links for the chosen grade.
//   Several:    All units  — every piece by tier with one column per unit, the total across units, Have,
//                            To buy and ☐ Ordered (one tick for the whole order).
//               By unit    — the same pieces with, for each unit, its quantity and its own ☐ Added to unit,
//                            and a progress line per unit ("Added 12 of 40").
//               Shopping   — what to buy for all units, per unit and total, with links.
// Tier subtotals count pieces and ticks; the need list carries no prices, so there is no cost subtotal.
// Writer: lib/xlsx-kit (frozen panes, header repeated on every printed page, landscape fit to width).
import 'server-only'
import {
  CHECK_OFF, F, N, T, TIERS, TIER_BLURB, TIER_NAME, colRef, countFormula, makeKitWorkbook, nyDate, pad, progressFormula, runs, safeName,
  type KCell, type KSheet, type Tier,
} from './xlsx-kit'
import { DEFAULT_SIZE, describeSize } from './starter-kit'
import { BIG_HOME, NEED_ROOMS, needList, type NeedItem, type NeedLine } from './need-list'
import { GRADES, buyList, type BuyLine, type Grade } from './need-buy'
import { STAY_CONTACT } from './need-list-contact'
import type { NeedUnit } from './starter-kit-params'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const TIER_RANK: Record<Tier, number> = { must: 0, recommended: 1, optional: 2 }
// The display order inside a tier: the need list's own order (by set, then within the set), taken from a
// home that has every appliance so every item has a place.
const ORDER = new Map(needList(DEFAULT_SIZE).map((l, i) => [l.item.key, i]))
const rank = (k: string) => ORDER.get(k) ?? 9999

/** "<Property> - Starter kit - YYYY-MM-DD.xlsx". `label` is an optional property name from the link (?p=). */
export function needListXlsxName(units: NeedUnit[], label?: string | null): string {
  const named = units.length === 1 && units[0].name !== 'This home' ? units[0].name : ''
  const who = safeName(label || '') || safeName(named) || (units.length > 1 ? `${units.length} units` : 'Your home')
  return `${who} - Starter kit - ${nyDate()}.xlsx`
}

/** The letterhead every sheet opens with: name band, what this sheet is, and how to reach Stay. */
function letterhead(cols: number, title: string, sub: string) {
  const last = colRef(cols - 1)
  return {
    rows: [
      pad([T(`${STAY_CONTACT.company.toUpperCase()}   ·   ${title}`, 'title')], cols, 'title'),
      pad([T(sub, 'sub')], cols, 'sub'),
      pad([T(`Want help managing your rental in South Florida?  Give ${STAY_CONTACT.person?.name.split(' ')[0] || 'us'} a call and see how we can help.   ·   ` +
        [STAY_CONTACT.person?.phone || STAY_CONTACT.phone, STAY_CONTACT.person?.email || STAY_CONTACT.email, STAY_CONTACT.web].join('   ·   '), 'cta')], cols, 'cta'),
    ] as KCell[][],
    merges: [`A1:${last}1`, `A2:${last}2`, `A3:${last}3`],
    heights: { 1: 36, 2: 22, 3: 22 } as Record<number, number>,
  }
}

/** The rule in words for a row that spans several homes (each home's own count is in its column). */
function basis(it: NeedItem): string {
  const per = it.per === 'settings' ? 'place settings, 2 per guest'
    : it.per === 'guest' ? (it.n === 1 ? 'one per guest' : it.n < 1 ? `one per ${Math.round(1 / it.n)} guests${it.min ? `, at least ${it.min}` : ''}` : `${it.n} per guest`)
      : it.per === 'bedroom' ? `${it.n === 1 ? 'one' : it.n} per bedroom` : it.per === 'bathroom' ? `${it.n === 1 ? 'one' : it.n} per bathroom` : `${it.n} per home`
  return [per, it.plus ? `+${it.plus}` : '', it.big ? `+${it.big} for ${BIG_HOME}+ guests` : '', it.note || ''].filter(Boolean).join(' · ')
}

type Row = { item: NeedItem; tier: Tier; qty: number[]; total: number; rule: string }

export function buildNeedListXlsx(units: NeedUnit[], showOpt: boolean, grade: Grade, label?: string | null): Buffer {
  const gradeLabel = GRADES.find(g => g.k === grade)!.label
  const multi = units.length > 1
  // THE PER-UNIT COUNT — needList(size), exactly what the one-home sheet uses.
  const per = units.map(u => { const lines: NeedLine[] = needList(u.size).filter(l => l.tier !== 'optional' || showOpt); return { u, lines, buy: buyList(lines) } })

  // Sum per item across the units. A tier can differ by home (a dish rack is a must without a
  // dishwasher); the row takes the strongest one.
  const map = new Map<string, Row>()
  per.forEach((p, i) => p.lines.forEach(l => {
    const r = map.get(l.item.key) || { item: l.item, tier: l.tier, qty: units.map(() => 0), total: 0, rule: l.rule }
    r.qty[i] += l.count; r.total += l.count
    if (TIER_RANK[l.tier] < TIER_RANK[r.tier]) r.tier = l.tier
    map.set(l.item.key, r)
  }))
  const all = Array.from(map.values())
  const tierRows = (t: Tier) => all.filter(r => r.tier === t).sort((a, b) => rank(a.item.key) - rank(b.item.key))
  const scope = multi ? `${units.length} units: ${units.map(x => `${x.name} (${describeSize(x.size)})`).join('  |  ')}` : describeSize(units[0].size)
  const how = `Click a ${CHECK_OFF} and pick ☑ when done.`
  const footer = `${STAY_CONTACT.company} · Starter kit${label ? ' · ' + label : ''}`
  const optNote = showOpt ? '' : 'Optional extras are not in this list. Tick "Show optional" on the calculator to add them. '

  // ── 1 · checklist (one home) / all units ─────────────────────────────────────────────────────────
  // one home: A Tier · B Set · C Item · D Needed · E Have · F To buy · G Ordered · H Added · I Why
  // several:  A Tier · B Set · C Item · D..(units) · Total · Have · To buy · Ordered · Why
  const U = units.length
  const qCols = multi ? U + 1 : 1                    // unit columns + total, or Needed
  const cTotal = 3 + qCols - 1                        // column index of the total needed
  const cHave = cTotal + 1, cBuy = cHave + 1, cOrd = cBuy + 1
  const cAdd = multi ? -1 : cOrd + 1
  const cWhy = multi ? cOrd + 1 : cAdd + 1
  const NC = cWhy + 1
  const h = letterhead(NC, multi ? `STARTER KIT · FULL ORDER FOR ${U} UNITS` : 'STARTER KIT CHECKLIST', `${scope}   ·   ${gradeLabel} picks`)
  const rows = h.rows
  if (multi) h.heights[2] = Math.min(80, 22 + 14 * Math.floor(scope.length / 140))
  const progressRow = rows.length
  rows.push(pad([], NC, 'prog'))
  h.heights[progressRow + 1] = 24
  rows.push([])
  const headLabels = ['Tier', 'Set / area', 'Item', ...(multi ? [...units.map(x => x.name), 'Total needed'] : ['Needed']), 'Have', 'To buy',
    `Ordered ${CHECK_OFF}`, ...(multi ? [] : [`Added to unit ${CHECK_OFF}`]), 'Why this many']
  rows.push(headLabels.map((x, i) => T(x, i >= 3 && i < cWhy ? 'headC' : 'head')))
  const headerRow = rows.length
  h.heights[headerRow] = multi ? 36 : 30
  const itemRows: number[] = []
  const subRows: number[] = []
  const count: Record<Tier, number> = { must: 0, recommended: 0, optional: 0 }
  const L = (c: number) => colRef(c)
  for (const tier of TIERS) {
    const list = tierRows(tier)
    count[tier] = list.length
    if (!list.length) continue
    const pieces = list.reduce((a, r) => a + r.total, 0)
    rows.push(pad([T(`${TIER_NAME[tier].toUpperCase()}   ·   ${plural(list.length, 'item')}, ${plural(pieces, 'piece')}   ·   ${TIER_BLURB[tier]}`, 'band_' + tier)], NC, 'band_' + tier))
    h.merges.push(`A${rows.length}:${L(NC - 1)}${rows.length}`)
    h.heights[rows.length] = 24
    const first = rows.length + 1
    for (const r of list) {
      const n = rows.length + 1
      const q: KCell[] = multi
        ? [...r.qty.map(v => v ? N(v) : T('–', 'dash')), F(`SUM(${L(3)}${n}:${L(2 + U)}${n})`, 'qtyB')]
        : [N(r.total, 'qtyB')]
      rows.push([T(TIER_NAME[tier], 'chip_' + tier), T(r.item.room, 'muted'), T(r.item.name, 'bodyB'), ...q,
        { v: '', s: 'input' }, F(`MAX(0,${L(cTotal)}${n}-${L(cHave)}${n})`, 'qtyB'),
        T(CHECK_OFF, 'check'), ...(multi ? [] : [T(CHECK_OFF, 'check')]), T(multi ? basis(r.item) : r.rule, 'muted')])
      itemRows.push(n)
    }
    const last = rows.length
    const sum = (c: number) => F(`SUM(${L(c)}${first}:${L(c)}${last})`, 'subQ_' + tier)
    const sub: KCell[] = [T(`${TIER_NAME[tier]} subtotal`, 'sub_' + tier), T('', 'sub_' + tier), T(plural(list.length, 'item'), 'sub_' + tier)]
    for (let c = 3; c <= cBuy; c++) sub.push(sum(c))
    sub.push(F(countFormula([`${L(cOrd)}${first}:${L(cOrd)}${last}`], list.length), 'subQ_' + tier))
    if (!multi) sub.push(F(countFormula([`${L(cAdd)}${first}:${L(cAdd)}${last}`], list.length), 'subQ_' + tier))
    sub.push(T('', 'sub_' + tier))
    rows.push(sub)
    subRows.push(rows.length)
    rows.push([])
  }
  const ordR = runs(cOrd, itemRows), addR = multi ? [] : runs(cAdd, itemRows)
  const tot: KCell[] = [T('All tiers', 'tot'), T('', 'tot'), T(plural(itemRows.length, 'item'), 'tot')]
  for (let c = 3; c <= cBuy; c++) tot.push(F(subRows.map(r => `${L(c)}${r}`).join('+') || '0', 'totQ'))
  tot.push(F(countFormula(ordR, itemRows.length), 'totQ'))
  if (!multi) tot.push(F(countFormula(addR, itemRows.length), 'totQ'))
  tot.push(T('', 'tot'))
  rows.push(tot)
  rows.push([])
  rows.push([T(`${optNote}Counts are pieces: ${multi ? 'each unit column is that home on its own (the same count as its one-home list) and Total needed is their sum. ' : ''}Fill in the yellow Have column and To buy works itself out. How to buy them in sets and packs, with links, is on the Shopping sheet.${multi ? ' Tick Added to unit for each home on the By unit sheet.' : ''} Linen is quoted separately.`, 'note')])
  h.merges.push(`A${rows.length}:${L(NC - 1)}${rows.length}`)
  h.heights[rows.length] = 36
  // progress line
  const pr = progressRow + 1
  const prog: KCell[] = pad([F(progressFormula('Ordered', ordR, itemRows.length), 'prog')], 3, 'prog')
  if (!multi) prog.push(...pad([F(progressFormula('Added to unit', addR, itemRows.length), 'prog')], 3, 'prog'))
  prog.push(T(`Must have ${count.must}   ·   Recommended ${count.recommended}   ·   Optional ${showOpt ? count.optional : 'not shown'}   ·   ${how}`, 'prog'))
  rows[progressRow] = pad(prog, NC, 'prog')
  h.merges.push(`A${pr}:C${pr}`)
  if (!multi) h.merges.push(`D${pr}:F${pr}`)
  h.merges.push(`${L(multi ? 3 : 6)}${pr}:${L(NC - 1)}${pr}`)
  const firstSheet: KSheet = {
    name: multi ? 'All units' : 'Checklist', rows, merges: h.merges, heights: h.heights,
    widths: [13, 18, 32, ...(multi ? [...units.map(() => 11), 10] : [9]), 9, 9, 11, ...(multi ? [] : [13]), 44],
    freezeRows: headerRow, freezeCols: 3, printTitleRows: [headerRow, headerRow], checks: [...ordR, ...addR], footer, tabColor: 'FF1F5F5B',
  }

  // ── 2 · by unit (several units): quantity and ☐ Added to unit for each home ──────────────────────
  const sheets: KSheet[] = [firstSheet]
  if (multi) {
    // A Tier · B Item · then per unit [Qty, Added] · Total
    const BC = 2 + U * 2 + 1
    const qc = (i: number) => 2 + i * 2, ac = (i: number) => 3 + i * 2
    const bh = letterhead(BC, `ADDED TO UNIT · ${U} UNITS`, `Each home's own count and its own ${CHECK_OFF} Added to unit. ${how}`)
    const brows = bh.rows
    const bProg = brows.length
    brows.push([])                                    // per-unit progress, filled in below
    bh.heights[bProg + 1] = 30
    brows.push([])
    const top: KCell[] = [T('', 'head'), T('', 'head')]
    const second: KCell[] = [T('Tier', 'head'), T('Item', 'head')]
    units.forEach((x, i) => {
      top.push(T(x.name, 'headC'), T('', 'headC'))
      second.push(T('Qty', 'headC'), T(`Added ${CHECK_OFF}`, 'headC'))
      bh.merges.push(`${L(qc(i))}${brows.length + 1}:${L(ac(i))}${brows.length + 1}`)
    })
    top.push(T('', 'headC')); second.push(T('Total', 'headC'))
    brows.push(top, second)
    const bHead = brows.length
    bh.heights[bHead - 1] = 22; bh.heights[bHead] = 22
    const perUnitRows: number[][] = units.map(() => [])
    const bSubs: number[] = []
    for (const tier of TIERS) {
      const list = tierRows(tier)
      if (!list.length) continue
      brows.push(pad([T(`${TIER_NAME[tier].toUpperCase()}   ·   ${plural(list.length, 'item')}`, 'band_' + tier)], BC, 'band_' + tier))
      bh.merges.push(`A${brows.length}:${L(BC - 1)}${brows.length}`)
      bh.heights[brows.length] = 22
      const first = brows.length + 1
      const tierUnitRows: number[][] = units.map(() => [])
      for (const r of list) {
        const n = brows.length + 1
        const row: KCell[] = [T(TIER_NAME[tier], 'chip_' + tier), T(r.item.name, 'bodyB')]
        r.qty.forEach((v, i) => {
          if (v) { row.push(N(v), T(CHECK_OFF, 'check')); perUnitRows[i].push(n); tierUnitRows[i].push(n) }
          else row.push(T('–', 'dash'), T('', 'dash'))
        })
        row.push(F(units.map((_, i) => `${L(qc(i))}${n}`).map(c => `N(${c})`).join('+'), 'qtyB'))
        brows.push(row)
      }
      const last = brows.length
      const sub: KCell[] = [T(`${TIER_NAME[tier]} subtotal`, 'sub_' + tier), T(plural(list.length, 'item'), 'sub_' + tier)]
      units.forEach((_, i) => sub.push(
        F(`SUM(${L(qc(i))}${first}:${L(qc(i))}${last})`, 'subQ_' + tier),
        F(countFormula(runs(ac(i), tierUnitRows[i]), tierUnitRows[i].length), 'subQ_' + tier)))
      sub.push(F(`SUM(${L(BC - 1)}${first}:${L(BC - 1)}${last})`, 'subQ_' + tier))
      brows.push(sub)
      bSubs.push(brows.length)
      brows.push([])
    }
    const btot: KCell[] = [T('All tiers', 'tot'), T(plural(all.length, 'item'), 'tot')]
    units.forEach((_, i) => btot.push(F(bSubs.map(r => `${L(qc(i))}${r}`).join('+') || '0', 'totQ'), F(countFormula(runs(ac(i), perUnitRows[i]), perUnitRows[i].length), 'totQ')))
    btot.push(F(bSubs.map(r => `${L(BC - 1)}${r}`).join('+') || '0', 'totQ'))
    brows.push(btot)
    // per-unit progress: "302 · Added 12 of 40 (30%)" over each unit's pair of columns
    const bp: KCell[] = [T('Added to unit, per home', 'prog'), T('', 'prog')]
    units.forEach((x, i) => {
      bp.push(F(progressFormula(x.name.replace(/"/g, "'") + ' ·', runs(ac(i), perUnitRows[i]), perUnitRows[i].length), 'progC'), T('', 'progC'))
      bh.merges.push(`${L(qc(i))}${bProg + 1}:${L(ac(i))}${bProg + 1}`)
    })
    bp.push(T('', 'prog'))
    brows[bProg] = bp
    sheets.push({
      name: 'By unit', rows: brows, merges: bh.merges, heights: bh.heights,
      widths: [13, 32, ...units.flatMap(() => [8, 10]), 9],
      freezeRows: bHead, freezeCols: 2, printTitleRows: [bHead - 1, bHead], checks: units.flatMap((_, i) => runs(ac(i), perUnitRows[i])), footer,
    })
  }

  // ── 3 · shopping: what to buy (sets, packs, singles) ─────────────────────────────────────────────
  const cols = 5 + U + (multi ? 1 : 0)
  const sh = letterhead(cols, multi ? `SHOPPING · FULL ORDER FOR ${U} UNITS` : 'SHOPPING · WHAT TO BUY', `${scope}   ·   ${gradeLabel} picks`)
  const srows = sh.rows
  const links: { ref: string; url: string }[] = []
  srows.push([])
  srows.push([T('What to buy', 'head'), T('Buy as', 'head'), ...units.map(x => T(multi ? x.name : 'Qty', 'headC')), ...(multi ? [T('Total', 'headC')] : []),
    T('Shop', 'head'), T("Stay's pick", 'head'), T("What's in it", 'head')])
  const sHead = srows.length
  const bmap = new Map<string, { line: BuyLine; qty: number[] }>()
  per.forEach((p, i) => p.buy.forEach(b => { const r = bmap.get(b.key) || { line: b, qty: units.map(() => 0) }; r.qty[i] += b.qty; bmap.set(b.key, r) }))
  const buys = Array.from(bmap.values())
  const shopCol = 2 + U + (multi ? 1 : 0)
  for (const room of NEED_ROOMS) {
    const group = buys.filter(r => r.line.group === room)
    if (!group.length) continue
    srows.push(pad([T(room, 'prog')], cols, 'prog'))
    for (const r of group) {
      const n = srows.length + 1
      const kind = r.line.kind === 'set' ? 'Set' : r.line.kind === 'pack' ? 'Pack' : 'Each'
      srows.push([T(r.line.name, 'bodyB'), T(kind, 'muted'), ...r.qty.map(q => q ? N(q) : T('–', 'dash')),
        ...(multi ? [F(`SUM(${L(2)}${n}:${L(1 + U)}${n})`, 'qtyB')] : []),
        T('Shop', 'link'), T(r.line.shop[grade].pick ? "Stay's pick" : '', 'link'),
        T(r.line.contents ? r.line.contents.map(c => `${c.per} ${c.name.toLowerCase()}`).join(', ') : '', 'muted')])
      links.push({ ref: L(shopCol) + n, url: r.line.shop[grade].url })
      if (r.line.shop[grade].pick) links.push({ ref: L(shopCol + 1) + n, url: r.line.shop[grade].pick! })
    }
  }
  srows.push([])
  srows.push([T(`Sets are listed where items are sold as sets; anything a set leaves short is bought separately. Shop opens Amazon to that grade of the item; Stay's pick, where shown, opens the exact product on Stay's own list. The coffee maker is a Nespresso or Keurig pod machine. Tick progress lives on the ${multi ? 'All units and By unit sheets' : 'Checklist sheet'}.`, 'note')])
  sh.merges.push(`A${srows.length}:${L(cols - 1)}${srows.length}`)
  sh.heights[srows.length] = 48
  sheets.push({
    name: 'Shopping', rows: srows, links, merges: sh.merges, heights: sh.heights,
    widths: [46, 9, ...units.map(() => multi ? 11 : 8), ...(multi ? [9] : []), 9, 12, 54],
    freezeRows: sHead, freezeCols: 1, printTitleRows: [sHead, sHead], footer,
  })
  return makeKitWorkbook(sheets)
}
