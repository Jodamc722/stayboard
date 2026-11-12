// THE SUPPLY CALCULATOR AS AN EXCEL CHECKLIST (Jon, 2026-11-12: "make Excel download options with a
// built-in checklist… leave it as a count"). Counts only, no shop links or prices: one row per item with
// its set, must-have / recommended / optional, the count, and two tick columns (Bought, In the home),
// then the linen at par the same way, and the note on what Stay does with this list. Same email gate as
// the PDF: no valid email, no file.
import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { cleanInput, TOOL_META, PARTNER_NOTE, type InventoryFull } from '@/lib/free-tools'
import { runTool } from '@/lib/free-tools-server'
import { EMAIL_RE } from '@/lib/need-list-leads'
import { STAY_CONTACT } from '@/lib/need-list-contact'

export const dynamic = 'force-dynamic'
const TIER: Record<string, string> = { must: 'Must-have', recommended: 'Recommended', suggested: 'Optional' }

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const email = String(b?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 })
  const f = await runTool('inventory', cleanInput('inventory', b?.input)) as InventoryFull

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Stay Hospitality'
  const ws = wb.addWorksheet('Checklist', { views: [{ state: 'frozen', ySplit: 6 }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.columns = [{ width: 22 }, { width: 44 }, { width: 14 }, { width: 9 }, { width: 10 }, { width: 13 }]
  const ink = 'FF101114', acc = 'FF8C6D3A', mute = 'FF6B6C72', soft = 'FFF3F2EF'
  ws.mergeCells('A1:F1'); ws.getCell('A1').value = 'STAY HOSPITALITY · ' + TOOL_META.inventory.short.toUpperCase()
  ws.getCell('A1').font = { bold: true, size: 9, color: { argb: acc } }
  ws.mergeCells('A2:F2'); ws.getCell('A2').value = 'Everything this rental needs'
  ws.getCell('A2').font = { name: 'Georgia', size: 18, color: { argb: ink } }
  ws.mergeCells('A3:F3'); ws.getCell('A3').value = f.describe
  ws.getCell('A3').font = { size: 10, color: { argb: mute } }
  ws.mergeCells('A4:F4'); ws.getCell('A4').value = `${(f.pieces + f.linenPieces).toLocaleString()} pieces: ${f.items} supply items (${f.pieces} pieces) and ${f.linenPieces} pieces of linen at a par of ${f.par}. Tick each item as it is bought and as it goes into the home.`
  ws.getCell('A4').font = { size: 10, color: { argb: ink } }; ws.getCell('A4').alignment = { wrapText: true }; ws.getRow(4).height = 28
  const hdr = ws.getRow(6)
  hdr.values = ['Set', 'Item', 'Type', 'Count', 'Bought', 'In the home']
  hdr.eachCell(c => { c.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } }; c.alignment = { vertical: 'middle' } })
  hdr.height = 20
  const box = (c: ExcelJS.Cell) => {
    c.value = '☐'; c.alignment = { horizontal: 'center' }
    c.dataValidation = { type: 'list', allowBlank: true, formulae: ['"☐,☑"'] }
  }
  const add = (set: string, item: string, type: string, count: number, shade: boolean) => {
    const r = ws.addRow([set, item, type, count, '', ''])
    r.getCell(4).alignment = { horizontal: 'center' }
    box(r.getCell(5)); box(r.getCell(6))
    r.eachCell({ includeEmpty: true }, c => { c.border = { bottom: { style: 'thin', color: { argb: 'FFE4E2DD' } } }; if (shade) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: soft } } })
    if (type === 'Must-have') r.getCell(3).font = { color: { argb: acc }, bold: true, size: 10 }
  }
  let shade = false, last = ''
  for (const r of f.rows) { if (r.group !== last) { shade = !shade; last = r.group } add(r.group, r.name, TIER[r.tier] || r.tier, r.qty, shade) }
  for (const r of f.linen) { if ('Linen · ' + r.group !== last) { shade = !shade; last = 'Linen · ' + r.group } add('Linen · ' + r.group, r.name + (r.size ? ' · ' + r.size : ''), 'Linen at par', r.qty, shade) }
  ws.addRow([])
  const n1 = ws.addRow(['Notes']); n1.getCell(1).font = { bold: true, size: 9, color: { argb: acc } }
  for (const t of [PARTNER_NOTE, f.parText, 'Counts are a starting point for a home of this size; adjust for your building and your guests.']) {
    const r = ws.addRow([t]); ws.mergeCells(`A${r.number}:F${r.number}`); r.getCell(1).alignment = { wrapText: true }; r.getCell(1).font = { size: 10, color: { argb: ink } }; r.height = 30
  }
  const p = STAY_CONTACT.person
  const c = ws.addRow([[p?.name, p?.role, p?.phone, p?.email].filter(Boolean).join(' · ') + ' · Stay Hospitality · stay-hospitality.com'])
  ws.mergeCells(`A${c.number}:F${c.number}`); c.getCell(1).font = { size: 9, color: { argb: mute } }

  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="rental-supply-checklist.xlsx"',
    'Cache-Control': 'no-store',
  } })
}
