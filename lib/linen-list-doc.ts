// The linen list files (PDF + Excel) for /api/onboard/linens/list — kept apart from the route so they can be
// rendered and looked at outside a request. See the route for the why.
import ExcelJS from 'exceljs'
import { buildQuotePdf } from '@/lib/order-pdf'

export type LinenListRow = { item: string; size: string; par: string; qty: number }
export type LinenListSection = { label: string; rows: LinenListRow[] }
export type LinenListInput = { name: string; subtitle: string; meta: { label: string; value: string }[]; dateLabel: string; sections: LinenListSection[] }

const fmt = (n: number) => n.toLocaleString('en-US')
const sumOf = (s: LinenListSection) => s.rows.reduce((a, r) => a + r.qty, 0)

export function linenListPdf(d: LinenListInput): Buffer {
  const total = d.sections.reduce((a, s) => a + sumOf(s), 0)
  return buildQuotePdf({
    title: 'Linen list - ' + d.name,
    subtitle: d.subtitle || undefined,
    meta: [{ label: 'Date', value: d.dateLabel }, ...d.meta],
    columns: [{ header: 'Item', width: 0.46 }, { header: 'Bed size', width: 0.22 }, { header: 'Par', width: 0.14, align: 'r' }, { header: 'Qty', width: 0.18, align: 'r' }],
    sections: d.sections.map(s => ({ heading: s.label, rows: s.rows.map(r => [r.item, r.size || '-', r.par || '-', fmt(r.qty)]), subtotal: fmt(sumOf(s)) + ' pcs' })),
    totals: [{ label: 'Total pieces', value: fmt(total), strong: true }],
    footer: 'Stay Hospitality - Linen list - ' + d.dateLabel,
  })
}

export async function linenListXlsx(d: LinenListInput): Promise<Buffer> {
  const { name, subtitle, meta, dateLabel, sections } = d
  const total = sections.reduce((a, s) => a + sumOf(s), 0)
  // EXCEL: a title block, then one band per section, Item | Bed size | Par | Qty, a subtotal under each and the total at the foot.
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Stay Hospitality'
  const ws = wb.addWorksheet('Linen list', { views: [{ showGridLines: false }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } } })
  ws.columns = [{ width: 34 }, { width: 16 }, { width: 10 }, { width: 12 }]
  const INK = 'FF1F2A37', MUTED = 'FF6B7280', BAND = 'FFEEF2F0', LINE = 'FFD9DED9', ACCENT = 'FF2F5D50'
  const thin = { style: 'thin' as const, color: { argb: LINE } }

  const t = ws.addRow(['Linen list — ' + name])
  ws.mergeCells(t.number, 1, t.number, 4)
  t.font = { name: 'Calibri', size: 18, bold: true, color: { argb: INK } }
  t.height = 28
  const sub = ws.addRow([[subtitle, dateLabel].filter(Boolean).join('  ·  ')])
  ws.mergeCells(sub.number, 1, sub.number, 4)
  sub.font = { size: 11, color: { argb: MUTED } }
  for (const m of meta) {
    const r = ws.addRow([m.label + ': ' + m.value])
    ws.mergeCells(r.number, 1, r.number, 4)
    r.font = { size: 10.5, color: { argb: MUTED } }
  }
  ws.addRow([])

  const head = ws.addRow(['Item', 'Bed size', 'Par', 'Qty'])
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } }
    c.alignment = { vertical: 'middle', horizontal: Number(c.col) <= 2 ? 'left' : 'right', indent: Number(c.col) === 1 ? 1 : 0 }
  })
  head.height = 20

  for (const s of sections) {
    const band = ws.addRow([s.label.toUpperCase()])
    ws.mergeCells(band.number, 1, band.number, 4)
    band.font = { bold: true, size: 10.5, color: { argb: ACCENT } }
    band.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
    band.getCell(1).alignment = { indent: 1 }
    band.height = 18
    for (const r of s.rows) {
      const parNum = Number(r.par)
      const row = ws.addRow([r.item, r.size || '—', r.par && Number.isFinite(parNum) ? parNum : (r.par || '—'), r.qty])
      row.getCell(1).alignment = { indent: 1 }
      row.getCell(2).font = { color: { argb: r.size ? INK : MUTED } }
      row.getCell(3).alignment = { horizontal: 'right' }
      row.getCell(3).font = { color: { argb: MUTED } }
      row.getCell(4).alignment = { horizontal: 'right' }
      row.getCell(4).font = { bold: true }
      row.getCell(4).numFmt = '#,##0'
      row.eachCell({ includeEmpty: true }, c => { c.border = { bottom: thin } })
    }
    const st = ws.addRow(['', '', s.label + ' total', s.rows.reduce((a, r) => a + r.qty, 0)])
    st.getCell(3).alignment = { horizontal: 'right' }
    st.getCell(3).font = { size: 10, color: { argb: MUTED } }
    st.getCell(4).font = { bold: true, color: { argb: MUTED } }
    st.getCell(4).numFmt = '#,##0'
    st.getCell(4).alignment = { horizontal: 'right' }
    ws.addRow([])
  }
  const tot = ws.addRow(['Total pieces', '', '', total])
  tot.font = { bold: true, size: 12, color: { argb: INK } }
  tot.getCell(4).numFmt = '#,##0'
  tot.getCell(4).alignment = { horizontal: 'right' }
  tot.eachCell({ includeEmpty: true }, c => { c.border = { top: { style: 'medium', color: { argb: INK } } } })
  // One face throughout — a cell without a font falls back to the viewer's default (a serif in some apps).
  ws.eachRow(r => r.eachCell({ includeEmpty: true }, c => { c.font = { ...(c.font || {}), name: 'Calibri' } }))
  ws.headerFooter.oddFooter = '&L&8Stay Hospitality · Linen list&R&8Page &P of &N'

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
