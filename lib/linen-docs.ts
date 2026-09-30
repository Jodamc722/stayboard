// THE TWO LINEN DOCUMENTS, AS DATA (Jon, 2026-09-30: "It should then draft an invoice and a quantity
// sheet that we can send to our vendors for purchasing"). Each builder returns the QuoteDoc that
// lib/order-pdf.ts draws; /api/onboard/linens/doc gates the request, reads the saved standard and
// hands the result to buildQuotePdf. Kept apart from the route so the layout is plain data built from
// lib/linens.ts arithmetic — the same numbers the page and the test show.
//
//   OWNER INVOICE   what the owner is billed: the pieces their unit receives at the tier's piece
//                   price, markup and tax on top. A DRAFT: numbered, dated, never stored.
//   VENDOR ORDER    what we buy: pieces pooled across every unit, whole cases per vendor, a page per
//                   vendor with how to order, the minimum and the lead time; the overage goes to stock.
import type { QuoteDoc, QuoteSection } from './order-pdf'
import { LINEN_GROUPS, linenQuote, vendorOrder, fmtUsd, type LinenStandard, type LinenUnit, type LinenTier, type VendorGroup } from './linens'

export type LinenDocContext = {
  labels: string[]        // one per typed-in unit, "Salato 302 ×3"
  dateLabel: string       // "Sep 30, 2026"
  invoiceNo?: string      // the invoice's draft number
  billTo?: string
}

/** LIN-20260930-K4QZ — a draft number. Nothing is stored, so it only has to tell drafts apart. */
export function linenDraftNo(ymd: string, rand: () => number = Math.random): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += A[Math.floor(rand() * A.length) % A.length]
  return 'LIN-' + String(ymd).replace(/-/g, '') + '-' + s
}

/** "Salato 302 ×3, Salato 602" — capped so a 40-unit order still fits its meta line. */
export function linenUnitsLabel(labels: string[], count: number): string {
  const shown = labels.slice(0, 4).join(', ')
  return labels.length > 4 ? `${count} units — ${shown} +${labels.length - 4} more` : shown || '1 unit'
}

const itemText = (name: string, product?: string) => name + (product ? ' - ' + product : '')
/**
 * A SKU broken into lines of at most `n` characters, at its hyphens where it can — a SKU has no spaces
 * to wrap at and capitals print wider than the PDF's width estimate, so a long one would run into the
 * next column. Never shortened: every character is kept (the CSV carries it on one line).
 */
export function skuLines(s: string, n = 9): string {
  if (s.length <= n) return s
  const out: string[] = []
  let cur = ''
  for (const tok of s.match(/[^-]+-?|-/g) || [s]) {
    if ((cur + tok).length <= n) { cur += tok; continue }
    if (cur) out.push(cur)
    cur = tok
    while (cur.length > n) { out.push(cur.slice(0, n)); cur = cur.slice(n) }
  }
  if (cur) out.push(cur)
  return out.join('\n')
}
const r2 = (x: number) => Math.round(x * 100) / 100

/** The owner's invoice for one tier: grouped Bed / Bath / Kitchen / Other, subtotal, markup, tax, total. */
export function linenInvoiceDoc(standard: LinenStandard, units: LinenUnit[], tier: LinenTier, ctx: LinenDocContext): QuoteDoc {
  const q = linenQuote(standard, units, tier)
  const where = linenUnitsLabel(ctx.labels, units.length)
  const sections: QuoteSection[] = []
  for (const grp of LINEN_GROUPS) {
    const rows = q.rows.filter(r => r.group === grp)
    if (!rows.length) continue
    const sub = rows.reduce((a, r) => a + (r.cost || 0), 0)
    sections.push({
      heading: grp,
      rows: rows.map(r => [itemText(r.name, r.product), r.size || '', String(r.qty), r.price !== null ? fmtUsd(r.price) : 'TBC', r.cost !== null ? fmtUsd(r.cost) : 'TBC']),
      subtotal: sub > 0 ? 'Subtotal ' + fmtUsd(r2(sub)) : undefined,
    })
  }
  const totals: QuoteDoc['totals'] = []
  if (q.unpriced) totals.push({ label: `${q.unpriced} line(s) still to be priced`, value: 'TBC' })
  totals.push({ label: 'Subtotal', value: fmtUsd(q.subtotal) })
  if (q.markup > 0) totals.push({ label: `Markup (${q.markupPct}%)`, value: fmtUsd(q.markup) })
  if (q.tax > 0) totals.push({ label: `Tax (${q.taxPct}%)`, value: fmtUsd(q.tax) })
  totals.push({ label: 'Total', value: fmtUsd(q.total), strong: true })
  const billTo = String(ctx.billTo || '').trim()
  return {
    title: 'Linen package — invoice (draft)',   // the PDF font has no em dash; order-pdf folds it to '-'
    subtitle: q.label + ' tier',
    meta: [
      ...(ctx.invoiceNo ? [{ label: 'Invoice no.', value: ctx.invoiceNo + ' (draft)' }] : []),
      { label: 'Date', value: ctx.dateLabel },
      ...(billTo ? [{ label: 'Bill to', value: billTo }] : []),
      { label: units.length === 1 ? 'Unit' : 'Units', value: where },
      { label: 'Tier', value: q.label },
    ],
    columns: [
      { header: 'Item', width: 46, wrap: true },
      { header: 'Size', width: 11 },
      { header: 'Qty', width: 8, align: 'r' },
      { header: 'Unit price', width: 14, align: 'r' },
      { header: 'Amount', width: 15, align: 'r' },
    ],
    sections,
    totals,
    note: `Billed for the ${q.pieces.toLocaleString('en-US')} pieces the ${units.length === 1 ? 'unit receives' : units.length + ' units receive'}, at ${standard.par} set(s) of every rotating item.` +
      (q.off.length ? ` Not part of the ${q.label} package: ${q.off.map(o => o.name).join(', ')}.` : ''),
    footer: 'Draft — review before sending.',
  }
}

/** A vendor's lines under its heading: contact, how to order, lead time and minimum, and any warning. */
function vendorLines(gr: VendorGroup): string[] {
  if (!gr.vendor) return ['No vendor is set on these lines yet - set one per tier on the linen standard and reprint.']
  const out: string[] = []
  const v = gr.info
  if (v) {
    const who = [v.contact, v.email, v.phone].filter(Boolean).join(' - ')
    if (who) out.push('Contact: ' + who)
    if (v.orderVia) out.push('How to order: ' + v.orderVia)
    const terms = [gr.leadDays !== null ? `Lead time ${gr.leadDays} day${gr.leadDays === 1 ? '' : 's'}` : '', gr.minOrder !== null ? 'Minimum order ' + fmtUsd(gr.minOrder) : ''].filter(Boolean).join(' - ')
    if (terms) out.push(terms)
    if (v.notes) out.push(v.notes)
  } else {
    out.push('Not on the vendor list yet - add it on the linen standard for contact, minimum and lead time.')
  }
  if (gr.belowMinimum) out.push(`BELOW MINIMUM: ${fmtUsd(gr.subtotal)} is ${fmtUsd(gr.shortBy)} short of the ${fmtUsd(gr.minOrder as number)} minimum - add stock or combine with another order.`)
  if (gr.unpriced) out.push(`${gr.unpriced} line(s) have no price - TBC with the vendor.`)
  return out
}

/** The vendor order / quantity sheet for one tier: a page per vendor, whole cases, the overage to stock. */
export function linenOrderDoc(standard: LinenStandard, units: LinenUnit[], tier: LinenTier, ctx: LinenDocContext): QuoteDoc {
  const o = vendorOrder(standard, units, tier)
  const where = linenUnitsLabel(ctx.labels, units.length)
  const sections: QuoteSection[] = o.groups.map((gr, i) => ({
    // The first vendor shares the title page; every one after it starts a sheet of its own.
    newPage: i > 0,
    heading: gr.vendor || 'No vendor set',
    sub: `${gr.lines.length} line(s) - ${gr.piecesOrdered.toLocaleString('en-US')} pieces`,
    lines: vendorLines(gr),
    rows: gr.lines.map(l => [
      l.sku ? skuLines(l.sku) : '-',
      itemText(l.name, l.product),
      l.size || '',
      String(l.piecesNeeded),
      l.packSize > 1 ? `${l.cases} x ${l.packSize}` : 'singly',
      String(l.piecesOrdered) + (l.overage ? ` (+${l.overage})` : ''),
      l.casePrice !== null ? fmtUsd(l.casePrice) : 'TBC',
      l.cost !== null ? fmtUsd(l.cost) : 'TBC',
    ]),
    subtotal: 'Subtotal ' + fmtUsd(gr.subtotal),
  }))
  return {
    title: 'Linen order — quantity sheet',
    subtitle: o.label + ' tier - ' + where,
    meta: [
      { label: 'Date', value: ctx.dateLabel },
      { label: 'Tier', value: o.label },
      { label: units.length === 1 ? 'Unit' : 'Units', value: where },
      { label: 'Vendors', value: String(o.groups.filter(x => x.vendor).length) + (o.groups.some(x => !x.vendor) ? ' + lines with no vendor' : '') },
      { label: 'Pieces', value: `${o.piecesNeeded.toLocaleString('en-US')} needed - ${o.piecesOrdered.toLocaleString('en-US')} ordered - ${o.overage.toLocaleString('en-US')} to stock` },
    ],
    columns: [
      { header: 'SKU', width: 13, wrap: true },
      { header: 'Item', width: 29, wrap: true },
      { header: 'Size', width: 7 },
      { header: 'Needed', width: 8, align: 'r' },
      { header: 'Cases', width: 9, align: 'r' },         // "2 x 12": cases x pieces per case
      { header: 'Ordered', width: 11, align: 'r' },
      { header: 'Case price', width: 11, align: 'r' },
      { header: 'Amount', width: 12, align: 'r' },
    ],
    sections,
    totals: [
      ...(o.unpriced ? [{ label: `${o.unpriced} line(s) still to be priced`, value: 'TBC' }] : []),
      { label: 'Pieces ordered', value: o.piecesOrdered.toLocaleString('en-US') },
      { label: 'To stock', value: o.overage.toLocaleString('en-US') },
      { label: 'Order total', value: fmtUsd(o.total), strong: true },
    ],
    footer: 'Pieces are pooled across every unit on this order and rounded up to whole cases ("2 x 12" = 2 cases of 12); (+n) is the overage, which goes to stock. ' +
      'Case price = price per piece x pieces per case. Draft - confirm prices and stock with the vendor before ordering.',
  }
}
