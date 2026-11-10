// THE STARTER KIT NEED LIST, AS EXCEL (Jon, 2026-11-10: "have an option to see it in Excel format and
// a list of items needed. Generate a need list"). Built from what the client saved, like the PDF.
//
//   Need list  — every item the home needs with their choices: room, item, quantity, who supplies it
//                (Stay's pick / their link / they provide it), the model, unit price, line total,
//                the link, and why that many. Totals at the foot.
//   Shopping   — only what Stay buys, one line each, for the order.
//   Not chosen — the recommended and optional items they left out, so nothing is lost in a call.
import 'server-only'
import { makeXlsx, colRef, type XCell, type XSheet } from './xlsx-lite'
import { KIT_CATEGORIES, describeSize, kitTotals, ruleText, type KitLine, type KitPublic } from './starter-kit'

const TIER = { must: 'Must-have', recommended: 'Recommended', optional: 'Optional' } as const
const SOURCE = { stay: 'Stay buys (our pick)', link: 'Stay buys (their link)', self: 'Owner provides' } as const
const T = (v: string | number, s = 0): XCell => ({ v, s })
const N = (v: number, s = 4): XCell => ({ v, s, num: true })

export function kitXlsxName(kit: KitPublic): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `Stay need list - ${clean(kit.client) || 'Proposal'}.xlsx`
}

export function buildKitXlsx(kit: KitPublic): Buffer {
  const t = kitTotals(kit.size, kit.selection)
  const order = (l: KitLine) => KIT_CATEGORIES.indexOf(l.item.category as any)
  const needed = t.lines.filter(l => l.included).sort((a, b) => order(a) - order(b))
  const head = (title: string): XCell[][] => [
    [T(title, 2)],
    [T(`${kit.client}${kit.property ? ' · ' + kit.property : ''}`, 1)],
    [T(describeSize(kit.size), 8)],
    [T(kit.submitted ? `Sent to Stay by ${kit.submitted.name} on ${new Date(kit.submitted.at).toLocaleDateString('en-US')}` : 'Not sent to Stay yet', 8)],
    [],
  ]

  // 1 — the need list
  const rows: XCell[][] = head('Need list')
  const links: { ref: string; url: string }[] = []
  rows.push(['Room', 'Item', 'Tier', 'Need', 'Have', 'To buy', 'Supplied by', 'Model or product', 'Unit price', 'Line total', 'Link', 'Why this many'].map(h => T(h, 3)))
  for (const l of needed) {
    const r = rows.length + 1
    const priced = l.source === 'stay' && l.price != null
    rows.push([
      T(l.item.category), T(l.item.name), T(TIER[l.item.tier]), N(l.qty, 0), N(l.have, 0), N(l.toBuy, 0), T(SOURCE[l.source]),
      T(l.source === 'link' ? 'Owner link' : l.detail + (l.option?.approx ? ' (price approx.)' : '')),
      priced ? N(l.price!) : T(l.source === 'self' ? 'Not charged' : 'Priced on review', 8),
      priced ? N(l.total || 0) : T(l.toBuy === 0 && l.source !== 'self' ? 'Covered' : '', 8),
      T(l.url && l.source !== 'self' ? 'Open' : '', 9), T(ruleText(l.item, kit.size), 8),
    ])
    if (l.url && l.source !== 'self') links.push({ ref: colRef(10) + r, url: l.url })
  }
  rows.push([])
  rows.push([T('Must-haves to buy', 7), T(''), T(''), T(''), T(''), T(''), T(''), T(''), T(''), N(t.must, 6)])
  rows.push([T('Add-ons to buy', 7), T(''), T(''), T(''), T(''), T(''), T(''), T(''), T(''), N(t.addOns, 6)])
  if (kit.setupFee) rows.push([T('Setup, delivery and installation', 7), T(''), T(''), T(''), T(''), T(''), T(''), T(''), T(''), N(kit.setupFee, 6)])
  rows.push([T('Total to buy', 7), T(''), T(''), T(''), T(''), T(''), T(''), T(''), T(''), N(t.total + (kit.setupFee || 0), 6)])
  rows.push([])
  rows.push([T(`${t.items} items needed · ${t.toBuy} to buy · ${t.covered} already covered · ${t.ownLinks} owner link(s), priced on review · ${t.selfSupplied} provided by the owner · coffee pods supplied by Stay`, 8)])
  const need: XSheet = { name: 'Need list', widths: [22, 26, 13, 7, 7, 8, 22, 44, 12, 12, 8, 34], rows, links }

  // 2 — what Stay buys
  const buy = needed.filter(l => l.source !== 'self' && l.toBuy > 0)
  const brows: XCell[][] = head('Shopping list')
  const blinks: { ref: string; url: string }[] = []
  brows.push(['Item', 'Qty', 'Model or product', 'Unit price', 'Line total', 'Link'].map(h => T(h, 3)))
  for (const l of buy) {
    const r = brows.length + 1
    const priced = l.source === 'stay' && l.price != null
    brows.push([T(l.item.name), N(l.toBuy, 0), T(l.source === 'link' ? 'Owner link' : l.detail), priced ? N(l.price!) : T('Priced on review', 8), priced ? N(l.total || 0) : T(''), T(l.url ? l.url : '', 9)])
    if (l.url) blinks.push({ ref: colRef(5) + r, url: l.url })
  }
  brows.push([])
  brows.push([T('Total', 7), T(''), T(''), T(''), N(t.total, 6)])
  const shop: XSheet = { name: 'Shopping list', widths: [26, 6, 44, 12, 12, 60], rows: brows, links: blinks }

  // 3 — what they left out
  const out = t.lines.filter(l => !l.included).sort((a, b) => order(a) - order(b))
  const orows: XCell[][] = head('Not chosen')
  orows.push(['Room', 'Item', 'Tier', 'Suggested qty', 'Our pick', 'Unit price'].map(h => T(h, 3)))
  for (const l of out) orows.push([T(l.item.category), T(l.item.name), T(TIER[l.item.tier]), N(l.suggested, 0), T(l.detail), l.price != null ? N(l.price) : T('')])
  if (!out.length) orows.push([T('Everything was chosen.', 8)])
  const left: XSheet = { name: 'Not chosen', widths: [22, 26, 13, 13, 44, 12], rows: orows }

  return makeXlsx([need, shop, left])
}
