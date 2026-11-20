// The owner financials as an Excel workbook (Jon, 2026-11-20: "make sure it's formatted as an Excel as well").
// Five sheets: the P&L by month, then the same lines by building, by listing and by owner, then every statement
// line name behind each P&L line. Money is real numbers with a currency format, so it sums and sorts in Excel.
import 'server-only'
import ExcelJS from 'exceljs'
import { FIN_LINES, type Financials, type FinRow, type FinVals } from './owner-financials-shared'

const USD = '"$"#,##0.00;[Red]-"$"#,##0.00'
const PCT = '0.0%'
const INK = 'FF1A1A1A', BAND = 'FFF3F1EC', RULE = 'FFD9D3C6'
const mLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const head = (ws: ExcelJS.Worksheet, n: number) => { const r = ws.getRow(n); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }; r.alignment = { vertical: 'middle', wrapText: true }; r.height = 22 }
const title = (ws: ExcelJS.Worksheet, t: string, sub: string) => { ws.addRow([t]).font = { bold: true, size: 15 }; ws.addRow([sub]).font = { color: { argb: 'FF6B665C' }, size: 10 }; ws.addRow([]) }

function groupSheet(wb: ExcelJS.Workbook, name: string, f: Financials, rows: FinRow[], cols: { h: string; w: number; v: (r: FinRow) => string | number }[], period: string) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: cols.length, ySplit: 4 }] })
  title(ws, 'Owner financials · ' + name.toLowerCase(), period)
  const money: { h: string; k: keyof FinVals }[] = [
    { h: 'Gross booking value (guests)', k: 'guestGross' }, { h: 'Cleaning fees guests paid', k: 'guestCleaning' },
    { h: 'Rental income', k: 'rental' }, { h: 'Cleaning credited to owner', k: 'cleaning' }, { h: 'Guest fees', k: 'fees' }, { h: 'Other income', k: 'other' }, { h: 'Gross owner revenue', k: 'gross' },
    { h: 'Management commission', k: 'commission' }, { h: 'Owner charges', k: 'charges' }, { h: 'Total expenses', k: 'expenses' }, { h: 'Pass-through (net)', k: 'passthru' }, { h: 'Net to owner', k: 'net' }, { h: 'Paid out', k: 'paid' },
  ]
  ws.addRow([...cols.map(c => c.h), ...money.map(m => m.h), 'Commission % of rental', 'Net % of gross', ...f.months.map(m => 'Net ' + mLabel(m))])
  head(ws, 4)
  for (const r of rows) {
    const x = ws.addRow([...cols.map(c => c.v(r)), ...money.map(m => r[m.k]), r.rental ? r.commission / r.rental : null, r.gross ? r.net / r.gross : null, ...f.months.map(m => r.byMonth[m]?.net ?? null)])
    for (let i = 0; i < money.length; i++) x.getCell(cols.length + 1 + i).numFmt = USD
    x.getCell(cols.length + money.length + 1).numFmt = PCT; x.getCell(cols.length + money.length + 2).numFmt = PCT
    for (let i = 0; i < f.months.length; i++) x.getCell(cols.length + money.length + 3 + i).numFmt = USD
    for (const k of ['gross', 'net'] as const) x.getCell(cols.length + 1 + money.findIndex(m => m.k === k)).font = { bold: true }
  }
  const t = ws.addRow([...cols.map((_, i) => (i === 0 ? 'Total' : '')), ...money.map(m => f.total[m.k]), f.total.rental ? f.total.commission / f.total.rental : null, f.total.gross ? f.total.net / f.total.gross : null, ...f.monthly.map(m => m.net)])
  t.font = { bold: true }; t.eachCell(c => { c.border = { top: { style: 'thin', color: { argb: INK } } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } } })
  for (let i = 0; i < money.length; i++) t.getCell(cols.length + 1 + i).numFmt = USD
  t.getCell(cols.length + money.length + 1).numFmt = PCT; t.getCell(cols.length + money.length + 2).numFmt = PCT
  for (let i = 0; i < f.months.length; i++) t.getCell(cols.length + money.length + 3 + i).numFmt = USD
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w })
  for (let i = cols.length + 1; i <= cols.length + money.length + 2 + f.months.length; i++) ws.getColumn(i).width = 16
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length + money.length + 2 } }
}

export async function financialsWorkbook(f: Financials): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Lighthouse'; wb.created = new Date()
  const period = `${mLabel(f.from)} to ${mLabel(f.to)} · ${f.statements} owner statements · ${f.ledgerLines.toLocaleString()} statement lines · made ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}`

  // ── P&L: the lines down, the months across ──
  const ws = wb.addWorksheet('P&L', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] })
  title(ws, 'Owner financials · profit and loss', period)
  ws.addRow(['', ...f.months.map(mLabel), 'Total', '% of gross']); head(ws, 4)
  const section = (label: string) => { const r = ws.addRow([label]); r.font = { bold: true, size: 10, color: { argb: 'FF6B665C' } } }
  section('WHAT GUESTS PAID (from the bookings)')
  for (const ln of FIN_LINES) {
    if (ln.key === 'rental') { ws.addRow([]); section('OWNER STATEMENTS · REVENUE') }
    if (ln.key === 'commission') section('OWNER STATEMENTS · EXPENSES')
    const k = ln.key as keyof FinVals, guest = ln.kind === 'guest' || ln.kind === 'guestTotal' || ln.kind === 'count'
    const r = ws.addRow([(ln.kind === 'total' || ln.kind === 'guestTotal' ? '' : '   ') + ln.label, ...f.monthly.map(m => m[k]), f.total[k], f.total.gross && ln.key !== 'paid' && !guest ? f.total[k] / f.total.gross : null])
    for (let i = 2; i <= f.months.length + 2; i++) r.getCell(i).numFmt = ln.kind === 'count' ? '#,##0' : USD
    if (ln.kind === 'guestTotal') r.font = { bold: true }
    r.getCell(f.months.length + 3).numFmt = PCT
    if (ln.kind === 'total') { r.font = { bold: true }; r.eachCell(c => { c.border = { top: { style: 'thin', color: { argb: RULE } } } }); if (ln.key === 'net') r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }; c.border = { top: { style: 'thin', color: { argb: INK } }, bottom: { style: 'double', color: { argb: INK } } } }) }
    if (ln.kind === 'memo') r.font = { italic: true, color: { argb: 'FF6B665C' } }
    if (ln.key === 'gross' || ln.key === 'expenses' || ln.key === 'net') ws.addRow([])
  }
  ws.addRow([]); const notes = [
    'Source: the recognized lines of the owner ledger in Guesty, the same lines the owner statements are made of.',
    'What guests paid is from the bookings: the accommodation fare spread over the nights of each stay, and the cleaning fee on the check-in month. Units with no statement line in the period are left out' + (f.offStatement.stays ? ' (' + f.offStatement.stays + ' stays, $' + Math.round(f.offStatement.gross).toLocaleString() + ').' : '.'),
    'The guest side and the owner side are not meant to tie: channel commissions, taxes and the cleaning that pays for the clean sit between them.',
    'Gross owner revenue is what the units earned for the owner before Stay’s commission and any owner charges.',
    'Pass-through reservations: a stay whose commission is 90 to 110% of its rental is a wash; both legs are kept out of gross and commission.',
    'Paid out is the payouts actually sent. It is a settlement, shown for reference, and is not part of net.',
    ...(f.notSynced.length ? ['NOT FULLY SYNCED, figures may be short: ' + f.notSynced.map(mLabel).join(', ') + '.'] : []),
    ...(f.noStatements.length ? ['Ledger lines but no statement generated yet: ' + f.noStatements.map(mLabel).join(', ') + '.'] : []),
  ]
  for (const n of notes) ws.addRow([n]).font = { size: 9, color: { argb: 'FF6B665C' } }
  ws.getColumn(1).width = 40; for (let i = 2; i <= f.months.length + 3; i++) ws.getColumn(i).width = 15

  groupSheet(wb, 'By building', f, f.buildings, [{ h: 'Building', w: 30, v: r => r.name }, { h: 'Units', w: 8, v: r => r.units }], period)
  groupSheet(wb, 'By listing', f, f.listings, [{ h: 'Listing', w: 30, v: r => r.name }, { h: 'Building', w: 24, v: r => r.building }, { h: 'Owner', w: 28, v: r => r.owner }], period)
  groupSheet(wb, 'By owner', f, f.owners, [{ h: 'Owner', w: 32, v: r => r.name }, { h: 'Units', w: 8, v: r => r.units }], period)

  // ── what is inside each line ──
  const d = wb.addWorksheet('Line detail', { views: [{ state: 'frozen', ySplit: 4 }] })
  title(d, 'Owner financials · what is inside each line', period)
  d.addRow(['P&L line', 'Statement line name', 'Amount', 'Statement lines']); head(d, 4)
  const label = (c: string) => FIN_LINES.find(l => l.key === c)?.label || c
  for (const x of f.detail) { const r = d.addRow([label(x.cat), x.name, x.amount, x.lines]); r.getCell(3).numFmt = USD }
  d.getColumn(1).width = 34; d.getColumn(2).width = 46; d.getColumn(3).width = 18; d.getColumn(4).width = 16
  d.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 4 } }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
