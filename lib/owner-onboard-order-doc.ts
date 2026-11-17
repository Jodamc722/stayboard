// THE ORDER LIST, FOR OUR TEAM TO BUY FROM (Jon, 2026-11-17: "have a pdf format / printout and excel for team to
// download if we are ordering for owner"). The same saved list the owner reviews, as two files:
//   pdf   a printout grouped by category, with a tick box per line and a subtotal per category
//   xlsx  a spreadsheet with the links, a live total, and columns for "Ordered" and the order number
// What the owner said they already have is taken off the buying list and named at the foot, so nobody orders it;
// what they need that our catalog does not carry is listed too (its own sheet in the spreadsheet).
import 'server-only'
import ExcelJS from 'exceljs'
import { buildQuotePdf } from '@/lib/order-pdf'
import { unitsOf, unitName, type OORecord, type OOOrderLine } from '@/lib/owner-onboard'

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export type OrderDoc = { ok: true; buf: Buffer; type: string; name: string } | { ok: false; error: string }
export async function orderDoc(r: OORecord, format: 'pdf' | 'xlsx'): Promise<OrderDoc> {
  const o = r.order
  if (!o || !o.lines.length) return { ok: false, error: 'There is no order list yet: build it first.' }
  const units = unitsOf(r)
  const label = (i: number) => unitName(units[i], i)
  const multi = units.length > 1 && units.length <= 6
  // What the owner said they already have comes off the buying list, and is named at the foot so nobody orders it.
  const skip = o.review?.skip || []
  const buy = o.lines.filter(l => skip.indexOf(l.key) < 0), has = o.lines.filter(l => skip.indexOf(l.key) >= 0)
  const qty = (l: OOOrderLine) => l.qty.reduce((a, b) => a + (Number(b) || 0), 0)
  const cats = Array.from(new Set(buy.map(l => l.category || 'Other')))
  const total = buy.reduce((a, l) => a + (l.price || 0) * qty(l), 0)
  const unpriced = buy.filter(l => l.price == null).length
  const where = [r.attach.property, r.home?.address].filter(Boolean).join(' - ') || 'New home'
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())
  const status = o.status === 'approved' ? 'Approved by the owner' : o.status === 'changes' ? 'Owner asked for changes' : o.status === 'sent' ? 'With the owner for review' : 'Draft, not sent to the owner'
  const file = (ext: string) => (where.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Home') + ' - Order list.' + ext
  // What the owner needs that our catalog does not carry, less whatever the team has since added to the list by hand.
  const bare = (x: string) => x.replace(/\s×\d+$/, '').replace(/\s\([^()]+\)$/, '').trim().toLowerCase()
  const notInCatalog = (o.basis?.uncovered || []).filter(x => !o.lines.some(l => l.name.trim().toLowerCase() === bare(x)))

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook(); wb.creator = 'Lighthouse'
    const ws = wb.addWorksheet('Order list', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
    const unitCols = multi ? units.map((_, i) => label(i)) : []
    const head = ['Category', 'Item', 'Details', ...unitCols, 'Qty', 'Each', 'Total', 'Link', 'Ordered', 'Order # / notes']
    ws.addRow(['Order list: ' + where]).font = { bold: true, size: 14 }
    ws.addRow([date + ' · ' + status + ' · ' + (units.length === 1 ? label(0) : units.length + ' units')]).font = { color: { argb: 'FF666666' } }
    ws.addRow([o.note ? 'Note to the owner: ' + o.note : '']).font = { italic: true, color: { argb: 'FF666666' } }
    ws.addRow([])
    const hr = ws.addRow(head); hr.font = { bold: true }
    hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EFEA' } }; c.border = { bottom: { style: 'thin' } } })
    const qCol = 4 + unitCols.length, eCol = qCol + 1, tCol = qCol + 2, lCol = qCol + 3
    const L = (n: number) => ws.getColumn(n).letter
    const first = ws.rowCount + 1
    for (const c of cats) for (const l of buy.filter(x => (x.category || 'Other') === c)) {
      const row = ws.addRow([c, l.name, l.detail && l.detail !== l.name ? l.detail : '', ...(multi ? units.map((_, i) => Number(l.qty[i]) || 0) : []), qty(l), l.price ?? null, null, null, '', ''])
      row.getCell(tCol).value = { formula: `IF(${L(eCol)}${row.number}="","",${L(qCol)}${row.number}*${L(eCol)}${row.number})`, result: l.price != null ? l.price * qty(l) : '' } as any
      if (l.url) { row.getCell(lCol).value = { text: 'Open', hyperlink: l.url } as any; row.getCell(lCol).font = { color: { argb: 'FF1D4ED8' }, underline: true } }
      row.alignment = { vertical: 'top', wrapText: true }
    }
    const last = ws.rowCount
    const tr = ws.addRow([]); tr.getCell(2).value = 'Estimated total' + (unpriced ? ' (' + unpriced + ' not priced yet)' : ''); tr.getCell(tCol).value = { formula: `SUM(${L(tCol)}${first}:${L(tCol)}${last})`, result: total } as any; tr.font = { bold: true }
    tr.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'thin' } } })
    ws.getColumn(eCol).numFmt = '$#,##0.00'; ws.getColumn(tCol).numFmt = '$#,##0.00'
    ;[20, 34, 44, ...unitCols.map(() => 9), 7, 11, 12, 9, 10, 26].forEach((w, i) => { ws.getColumn(i + 1).width = w })
    if (has.length) { ws.addRow([]); ws.addRow(['The owner already has these: do not order']).font = { bold: true }; for (const l of has) ws.addRow(['', l.name, l.detail && l.detail !== l.name ? l.detail : '']).font = { color: { argb: 'FF888888' } } }
    if (notInCatalog.length) {
      const w2 = wb.addWorksheet('Not in our catalog')
      w2.addRow(['The owner marked these as needed and they are not in our catalog']).font = { bold: true }
      w2.addRow(['Add the ones we are buying to the order list in Lighthouse, or source them here.']).font = { color: { argb: 'FF666666' } }
      w2.addRow([]); const h2 = w2.addRow(['Item', 'Where to buy / link', 'Each', 'Ordered', 'Notes']); h2.font = { bold: true }
      for (const x of notInCatalog) w2.addRow([x]);
      [42, 40, 11, 10, 30].forEach((w, i) => { w2.getColumn(i + 1).width = w })
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
    return { ok: true, buf, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: file('xlsx') }
  }

  const pdf = buildQuotePdf({
    title: 'Order list', subtitle: where,
    meta: [{ label: 'Date', value: date }, { label: 'Status', value: status }, { label: units.length === 1 ? 'Unit' : 'Units', value: units.map((_, i) => label(i)).join(', ') }, { label: 'Lines', value: String(buy.length) }],
    columns: [{ header: 'Done', width: 6 }, { header: 'Item', width: multi ? 40 : 52, wrap: true }, ...(multi ? units.map((_, i) => ({ header: label(i), width: Math.floor(18 / units.length), align: 'r' as const })) : []), { header: 'Qty', width: 7, align: 'r' as const }, { header: 'Each', width: multi ? 13 : 16, align: 'r' as const }, { header: 'Total', width: multi ? 16 : 19, align: 'r' as const }],
    sections: [
      ...cats.map(c => { const ls = buy.filter(l => (l.category || 'Other') === c); return {
        heading: c,
        rows: ls.map(l => ['[   ]', l.name + (l.detail && l.detail !== l.name ? ' - ' + l.detail : ''), ...(multi ? units.map((_, i) => (Number(l.qty[i]) ? String(l.qty[i]) : '')) : []), String(qty(l)), l.price != null ? usd(l.price) : '', l.price != null ? usd(l.price * qty(l)) : '']),
        subtotal: ls.some(l => l.price != null) ? usd(ls.reduce((a, l) => a + (l.price || 0) * qty(l), 0)) : undefined,
      } }),
      ...(has.length ? [{ heading: 'The owner already has these: do not order', rows: has.map(l => ['', l.name, ...(multi ? units.map(() => '') : []), '', '', '']) }] : []),
      ...(notInCatalog.length ? [{ heading: 'Needed, not in our catalog', lines: ['The owner marked these as needed. Add the ones we are buying to the list in Lighthouse.'], rows: notInCatalog.map(x => ['[   ]', x, ...(multi ? units.map(() => '') : []), '', '', '']) }] : []),
    ],
    totals: [{ label: 'Estimated total', value: usd(total), strong: true }],
    note: 'For the Stay team. Prices are catalog estimates; linen is quoted separately.' + (unpriced ? ' ' + unpriced + (unpriced === 1 ? ' line is' : ' lines are') + ' not priced yet, so the total is short by those.' : ''),
  })
  return { ok: true, buf: pdf, type: 'application/pdf', name: file('pdf') }
}
