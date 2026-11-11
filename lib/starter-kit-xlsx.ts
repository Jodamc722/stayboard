// THE STARTER KIT AS EXCEL, ONE HOME (Jon, 2026-11-10: "have an option to see it in Excel format and a
// list of items needed"; 2026-11-11: "there should be a must have, recommended and optional in the excel
// download… add a checkmark list for them too, so when they order they can check it off and a checklist
// for added to unit. Make it super nice"). Built from what the client saved, like the PDF.
//
//   Checklist    — every item the home needs, in three colour bands: Must have, Recommended, Optional.
//                  Room, item, model, Need / Have (yellow, fill in) / To buy, price, line total, who
//                  supplies it, ☐ Ordered and ☐ Added to unit (pick ☑ from the cell's list; it turns
//                  green), the link and why that many. A subtotal per tier (pieces, cost, ticks), a
//                  grand total, and a progress line at the top ("Ordered 12 of 40 (30%)"). Ticks
//                  already made on the kit page come through ticked.
//   Shopping list — only what Stay buys, by tier, one line each, with links and totals.
//   Not chosen   — the recommended and optional items they left out, so nothing is lost in a call.
// Writer: lib/xlsx-kit (frozen header, header repeated on every printed page, landscape fit to width).
import 'server-only'
import {
  CHECK_OFF, CHECK_ON, F, N, T, TIERS, TIER_BLURB, TIER_NAME, colRef, countFormula, makeKitWorkbook, nyDate, pad, progressFormula, runs, safeName,
  type KCell, type KSheet, type Tier,
} from './xlsx-kit'
import { KIT_CATEGORIES, describeSize, kitTotals, needsOrder, ruleText, type KitLine, type KitPublic } from './starter-kit'

const SOURCE = { stay: 'Stay buys (our pick)', link: 'Stay buys (their link)', self: 'Owner provides' } as const
const catOrder = (l: KitLine) => KIT_CATEGORIES.indexOf(l.item.category as (typeof KIT_CATEGORIES)[number])
const byTier = (lines: KitLine[], t: Tier) => lines.filter(l => l.item.tier === t).sort((a, b) => catOrder(a) - catOrder(b))
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "<Property> - Starter kit - YYYY-MM-DD.xlsx" (the date in Miami). */
export function kitXlsxName(kit: KitPublic): string {
  return `${safeName(kit.property) || safeName(kit.client) || 'Stay'} - Starter kit - ${nyDate()}.xlsx`
}

/** The letterhead band every sheet opens with. Returns the rows and their merges / heights. */
function head(kit: KitPublic, cols: number, title: string, line3: string) {
  const last = colRef(cols - 1)
  const status = kit.submitted
    ? `Sent to Stay by ${kit.submitted.name} on ${new Date(kit.submitted.at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
    : `Prepared ${new Date(kit.createdAt || Date.now()).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}${kit.preparedBy ? ' by ' + kit.preparedBy : ''}`
  return {
    rows: [
      pad([T(`STAY HOSPITALITY   ·   ${title}`, 'title')], cols, 'title'),
      pad([T(`${kit.client}${kit.property ? '   ·   ' + kit.property : ''}   ·   ${describeSize(kit.size)}`, 'sub')], cols, 'sub'),
      pad([T(`${status}   ·   ${line3}`, 'cta')], cols, 'cta'),
    ] as KCell[][],
    merges: [`A1:${last}1`, `A2:${last}2`, `A3:${last}3`],
    heights: { 1: 36, 2: 22, 3: 22 } as Record<number, number>,
  }
}

export function buildKitXlsx(kit: KitPublic): Buffer {
  const t = kitTotals(kit.size, kit.selection)
  const needed = t.lines.filter(l => l.included)
  const ordered = kit.selection.ordered || {}
  const added = kit.selection.added || {}
  const tick = (on: boolean): KCell => T(on ? CHECK_ON : CHECK_OFF, 'check')

  // ── 1 · the checklist ─────────────────────────────────────────────────────────────────────────────
  //   A Tier · B Room · C Item · D Model · E Need · F Have · G To buy · H Unit price · I Line total ·
  //   J Supplied by · K Ordered · L Added to unit · M Link · N Why this many
  const NC = 14
  const h = head(kit, NC, 'STARTER KIT CHECKLIST', `Click a ${CHECK_OFF} under Ordered or Added to unit and pick ${CHECK_ON}. Fill in Have (yellow) and To buy updates.`)
  const rows = h.rows
  const merges = h.merges
  const links: { ref: string; url: string }[] = []
  const progressRow = rows.length            // index of the progress row about to be pushed (0-based)
  rows.push(pad([], NC, 'prog'))             // filled in once the ranges are known
  h.heights[progressRow + 1] = 24
  rows.push([])
  rows.push(['Tier', 'Room', 'Item', 'Model or product', 'Need', 'Have', 'To buy', 'Unit price', 'Line total', 'Supplied by', `Ordered ${CHECK_OFF}`, `Added to unit ${CHECK_OFF}`, 'Link', 'Why this many']
    .map((x, i) => T(x, i >= 4 && i <= 8 || i === 10 || i === 11 ? 'headC' : 'head')))
  const headerRow = rows.length
  h.heights[headerRow] = 30

  const okRows: number[] = []                // every item row (1-based), for the overall progress
  const orderRows: number[] = []             // the rows with an Ordered tick (something left to buy)
  const subRows: number[] = []
  const tierCount: Record<Tier, number> = { must: 0, recommended: 0, optional: 0 }
  for (const tier of TIERS) {
    const lines = byTier(needed, tier)
    tierCount[tier] = lines.length
    if (!lines.length) continue
    rows.push(pad([T(`${TIER_NAME[tier].toUpperCase()}   ·   ${plural(lines.length, 'item')}   ·   ${TIER_BLURB[tier]}`, 'band_' + tier)], NC, 'band_' + tier))
    merges.push(`A${rows.length}:${colRef(NC - 1)}${rows.length}`)
    h.heights[rows.length] = 24
    const first = rows.length + 1
    const tierOrder: number[] = []
    for (const l of lines) {
      const r = rows.length + 1
      const priced = l.source === 'stay' && l.price != null
      rows.push([
        T(TIER_NAME[tier], 'chip_' + tier), T(l.item.category, 'muted'), T(l.item.name, 'bodyB'),
        T(l.source === 'link' ? 'Owner link: ' + (l.own || '') : l.detail + (l.option?.approx ? ' (price approx.)' : '')),
        N(l.qty), N(l.have, 'input'),
        l.source === 'self' ? N(0, 'qtyB') : F(`MAX(0,E${r}-F${r})`, 'qtyB'),
        priced ? N(l.price!, 'money') : T(l.source === 'self' ? 'Not charged' : 'On review', 'muted'),
        priced ? F(`G${r}*H${r}`, 'money') : T('', 'muted'),
        T(SOURCE[l.source], 'muted'),
        needsOrder(l) ? tick(!!ordered[l.item.key]) : T(l.source === 'self' ? 'Owner' : 'Covered', 'dash'), tick(!!added[l.item.key]),
        T(l.url && l.source !== 'self' ? 'Open' : '', 'link'), T(ruleText(l.item, kit.size), 'muted'),
      ])
      if (l.url && l.source !== 'self') links.push({ ref: `M${r}`, url: l.url })
      okRows.push(r)
      if (needsOrder(l)) { orderRows.push(r); tierOrder.push(r) }
    }
    const last = rows.length
    const rng = (c: string) => `${c}${first}:${c}${last}`
    rows.push([
      T(`${TIER_NAME[tier]} subtotal`, 'sub_' + tier), T('', 'sub_' + tier), T(plural(lines.length, 'item'), 'sub_' + tier), T('', 'sub_' + tier),
      F(`SUM(${rng('E')})`, 'subQ_' + tier), F(`SUM(${rng('F')})`, 'subQ_' + tier), F(`SUM(${rng('G')})`, 'subQ_' + tier),
      T('', 'sub_' + tier), F(`SUM(${rng('I')})`, 'subM_' + tier), T('', 'sub_' + tier),
      F(countFormula(runs(10, tierOrder), tierOrder.length), 'subQ_' + tier), F(countFormula([rng('L')], lines.length), 'subQ_' + tier),
      T('', 'sub_' + tier), T('', 'sub_' + tier),
    ])
    subRows.push(rows.length)
    rows.push([])
  }
  if (!okRows.length) rows.push([T('Nothing is selected yet.', 'note')])

  // grand totals
  const sumOf = (c: string) => subRows.length ? subRows.map(r => `${c}${r}`).join('+') : '0'
  const ordRanges = runs(10, orderRows), addRanges = runs(11, okRows)
  rows.push([T('All tiers', 'tot'), T('', 'tot'), T(plural(okRows.length, 'item'), 'tot'), T('', 'tot'),
    F(sumOf('E'), 'totQ'), F(sumOf('F'), 'totQ'), F(sumOf('G'), 'totQ'), T('', 'tot'), F(sumOf('I'), 'totM'), T('', 'tot'),
    F(countFormula(ordRanges, orderRows.length), 'totQ'), F(countFormula(addRanges, okRows.length), 'totQ'), T('', 'tot'), T('', 'tot')])
  const allRow = rows.length
  let grand = `I${allRow}`
  if (kit.setupFee) {
    rows.push([T('Setup, delivery and installation', 'bodyB'), ...Array.from({ length: 7 }, () => T('', 'body')), N(kit.setupFee, 'money')])
    grand += `+I${rows.length}`
  }
  rows.push([T('Total to buy', 'tot'), ...Array.from({ length: 7 }, () => T('', 'tot')), F(grand, 'totM')])
  rows.push([])
  rows.push([T(`${t.items} items needed · ${t.toBuy} to buy · ${t.covered} already covered · ${t.ownLinks} owner link(s), priced on review · ${t.selfSupplied} provided by the owner. Coffee pods are supplied by Stay. Prices are retail prices from when the kit was prepared; Stay confirms every price before anything is bought.`, 'note')])
  merges.push(`A${rows.length}:${colRef(NC - 1)}${rows.length}`)
  h.heights[rows.length] = 34

  // the progress line, now that the ranges are known
  rows[progressRow] = [
    F(progressFormula('Ordered', ordRanges, orderRows.length), 'prog'), T('', 'prog'), T('', 'prog'),
    F(progressFormula('Added to unit', addRanges, okRows.length), 'prog'), T('', 'prog'), T('', 'prog'), T('', 'prog'), T('', 'prog'),
    T(`Must have ${tierCount.must}   ·   Recommended ${tierCount.recommended}   ·   Optional ${tierCount.optional}`, 'prog'),
    ...Array.from({ length: NC - 9 }, () => T('', 'prog')),
  ]
  const pr = progressRow + 1
  merges.push(`A${pr}:C${pr}`, `D${pr}:H${pr}`, `I${pr}:${colRef(NC - 1)}${pr}`)

  const checklist: KSheet = {
    name: 'Checklist', widths: [13, 19, 24, 40, 7, 7, 8, 11, 12, 19, 11, 13, 7, 34], rows, merges, heights: h.heights, links,
    freezeRows: headerRow, freezeCols: 3, printTitleRows: [headerRow, headerRow], checks: [...ordRanges, ...addRanges],
    footer: `Stay Hospitality · Starter kit · ${kit.property || kit.client}`, tabColor: 'FF1F5F5B',
  }

  // ── 2 · shopping list: what Stay buys ────────────────────────────────────────────────────────────
  const SC = 7
  const sh = head(kit, SC, 'SHOPPING LIST', 'What Stay buys, by tier. Tick progress lives on the Checklist sheet.')
  const srows = sh.rows
  const slinks: { ref: string; url: string }[] = []
  srows.push([])
  srows.push(['Tier', 'Item', 'Qty', 'Model or product', 'Unit price', 'Line total', 'Link'].map((x, i) => T(x, i === 2 || i === 4 || i === 5 ? 'headC' : 'head')))
  const sHeader = srows.length
  const sSubs: number[] = []
  for (const tier of TIERS) {
    const buy = byTier(needed, tier).filter(l => l.source !== 'self' && l.toBuy > 0)
    if (!buy.length) continue
    srows.push(pad([T(`${TIER_NAME[tier].toUpperCase()}   ·   ${plural(buy.length, 'line')}`, 'band_' + tier)], SC, 'band_' + tier))
    sh.merges.push(`A${srows.length}:${colRef(SC - 1)}${srows.length}`)
    const first = srows.length + 1
    for (const l of buy) {
      const r = srows.length + 1
      const priced = l.source === 'stay' && l.price != null
      srows.push([T(TIER_NAME[tier], 'chip_' + tier), T(l.item.name, 'bodyB'), N(l.toBuy, 'qtyB'), T(l.source === 'link' ? 'Owner link' : l.detail),
        priced ? N(l.price!, 'money') : T('On review', 'muted'), priced ? F(`C${r}*E${r}`, 'money') : T('', 'muted'), T(l.url ? 'Open' : '', 'link')])
      if (l.url) slinks.push({ ref: `G${r}`, url: l.url })
    }
    srows.push([T(`${TIER_NAME[tier]} subtotal`, 'sub_' + tier), T('', 'sub_' + tier), F(`SUM(C${first}:C${srows.length})`, 'subQ_' + tier), T('', 'sub_' + tier), T('', 'sub_' + tier),
      F(`SUM(F${first}:F${srows.length})`, 'subM_' + tier), T('', 'sub_' + tier)])
    sSubs.push(srows.length)
    srows.push([])
  }
  if (!sSubs.length) srows.push([T('Nothing left for Stay to buy.', 'note')])
  srows.push([T('Total', 'tot'), T('', 'tot'), F(sSubs.map(r => `C${r}`).join('+') || '0', 'totQ'), T('', 'tot'), T('', 'tot'), F(sSubs.map(r => `F${r}`).join('+') || '0', 'totM'), T('', 'tot')])
  const shop: KSheet = { name: 'Shopping list', widths: [13, 26, 7, 46, 12, 12, 8], rows: srows, merges: sh.merges, heights: sh.heights, links: slinks,
    freezeRows: sHeader, printTitleRows: [sHeader, sHeader], footer: `Stay Hospitality · Shopping list · ${kit.property || kit.client}` }

  // ── 3 · not chosen ───────────────────────────────────────────────────────────────────────────────
  const OC = 6
  const oh = head(kit, OC, 'NOT CHOSEN', 'Recommended and optional items left out of the kit.')
  const orows = oh.rows
  orows.push([])
  orows.push(['Tier', 'Room', 'Item', 'Suggested qty', 'Our pick', 'Unit price'].map((x, i) => T(x, i === 3 || i === 5 ? 'headC' : 'head')))
  const oHeader = orows.length
  const out = t.lines.filter(l => !l.included)
  for (const tier of TIERS) for (const l of byTier(out, tier)) {
    orows.push([T(TIER_NAME[tier], 'chip_' + tier), T(l.item.category, 'muted'), T(l.item.name, 'bodyB'), N(l.suggested), T(l.detail), l.price != null ? N(l.price, 'money') : T('', 'muted')])
  }
  if (!out.length) orows.push([T('Everything was chosen.', 'note')])
  const left: KSheet = { name: 'Not chosen', widths: [13, 22, 26, 13, 44, 12], rows: orows, merges: oh.merges, heights: oh.heights,
    freezeRows: oHeader, printTitleRows: [oHeader, oHeader], footer: `Stay Hospitality · Not chosen · ${kit.property || kit.client}` }

  return makeKitWorkbook([checklist, shop, left])
}
