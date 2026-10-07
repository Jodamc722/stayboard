// BILLING EXPORT. GET ?month=YYYY-MM&format=csv|xls|zip[&owner=<ownerId>][&done=1][&reviewed=1]
//   csv — flat file, one row per billable line.
//   xls — a REAL .xlsx workbook (Office Open XML, built with the in-file ZIP writer — no
//         dependency): Summary sheet + one styled worksheet per owner. Replaces the old
//         SpreadsheetML output, which Excel opened reluctantly and rendered poorly.
//   zip — one standalone .xlsx per owner, named "<Owner> - Billable Labor - <Month>.xlsx",
//         for dropping straight into each owner's statement. $0 owners are skipped.
// done=1 → completed work only (matches the board default). reviewed=1 → only lines that are
// GM-approved (review_state = 'gm_approved'; the close-out set).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth, billingRange, type BillingTask } from '@/lib/billing'
import { getSetting } from '@/lib/app-settings'
import { stayLogoPng, STAY_LOGO_W, STAY_LOGO_H } from '@/lib/brand-logo'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const hrs = (min: number | null) => min == null ? '' : (Math.round((min / 60) * 100) / 100).toFixed(2)
const esc = (s: any) => {
  const v = String(s == null ? '' : s)
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}
const xesc = (s: any) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function monthLabel(month: string): string {
  const d = new Date(month + '-15T12:00:00Z')
  return isNaN(d.getTime()) ? month : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function sheetName(s: string, used: Record<string, boolean>): string {
  let n = s.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Owner'
  let k = n; let i = 2
  while (used[k]) { k = n.slice(0, 25) + ' ' + i; i++ }
  used[k] = true
  return k
}
const cleanName = (s: string) => String(s || 'Owner').replace(/[^A-Za-z0-9 ,&._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

// ── Billable lines per task ─────────────────────────────────────────────────
type Line = { owner: string; unit: string; building: string; date: string; task: string; dept: string; kind: string; description: string; hours: string; rate: string; amount: number; assignee: string; status: string; excluded: boolean; note: string }

function linesOf(t: BillingTask): Line[] {
  const base = {
    owner: t.ownerName, unit: t.unit, building: t.building || '', date: t.scheduledDate || (t.finishedAt || '').slice(0, 10),
    task: t.name, dept: t.department, assignee: t.assignees.map(a => a.name).filter(Boolean).join(', ') || t.finishedBy || '',
    status: t.status, excluded: t.excluded, note: t.note || '',
  }
  const out: Line[] = []
  if (t.overrideAmount != null) {
    out.push({ ...base, kind: 'override', description: 'Billed amount (manual override)', hours: hrs(t.actualMinutes), rate: '', amount: t.overrideAmount })
    return out
  }
  if (t.laborAmount > 0 || t.ratePaid != null) {
    const hourly = String(t.rateType || '').toLowerCase() === 'hourly'
    out.push({
      ...base, kind: 'labor',
      description: hourly ? 'Labor (hourly)' : 'Labor (flat)',
      hours: t.billedHours != null ? t.billedHours.toFixed(2) : hrs(t.actualMinutes),
      rate: t.ratePaid != null ? money(t.ratePaid) : '',
      amount: t.laborAmount,
    })
  }
  for (const it of t.items) {
    if (String(it.bill_to || 'owner') === 'guest') continue
    const desc = it.originalAmount != null ? it.description + ' (adjusted from $' + money(it.originalAmount) + ')' : it.description
    out.push({ ...base, kind: it.type ? it.type.toLowerCase() : it.kind, description: desc, hours: '', rate: '', amount: it.amount })
  }
  if (!out.length) out.push({ ...base, kind: 'labor', description: 'No billing recorded', hours: hrs(t.actualMinutes), rate: '', amount: 0 })
  return out
}

function toCsv(tasks: BillingTask[]): string {
  const head = ['Billing owner', 'Unit', 'Building', 'Date', 'Task', 'Department', 'Line type', 'Description', 'Hours', 'Rate', 'Amount', 'Assignee', 'Status', 'Excluded', 'Note']
  const rows: string[] = [head.join(',')]
  for (const t of tasks) {
    for (const l of linesOf(t)) {
      rows.push([l.owner, l.unit, l.building, l.date, l.task, l.dept, l.kind, l.description, l.hours, l.rate, money(t.excluded ? 0 : l.amount), l.assignee, l.status, l.excluded ? 'yes' : '', l.note].map(esc).join(','))
    }
  }
  return rows.join('\n')
}

// ── Minimal ZIP writer (stored entries, no compression, no dependency) ──────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(d: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2))) & 0xFFFF
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameB = Buffer.from(e.name, 'utf8')
    const crc = crc32(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8)
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28)
    locals.push(lh, nameB, e.data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24)
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32)
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameB)
    offset += 30 + nameB.length + e.data.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20)
  return Buffer.concat([Buffer.concat(locals), cd, eocd])
}

// ── Real .xlsx builder (Office Open XML — an xlsx IS a zip of XML parts) ────
// Style indexes (cellXfs below):
//   0 default · 1 bold · 2 title (bold 14) · 3 header (bold, grey fill, bottom border)
//   4 currency · 5 number 0.00 · 6 total currency (bold, top border) · 7 total label · 8 muted
type XCell = { v: string | number; s?: number; num?: boolean }
type XSheet = {
  name: string; widths: number[]; rows: XCell[][]
  links?: { ref: string; url: string }[]
  merges?: string[]            // 'A1:C1'
  heights?: Record<number, number>  // 1-based row → points
  freeze?: number              // rows to keep on screen while the list scrolls
  logo?: boolean               // the letterhead, top left
  printTitleRow?: number       // 1-based header row, repeated on every printed page
}

function colRef(i: number): string {
  let n = i + 1; let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
// THE LOOK (Jon, 2026-10-07: "make the zip file / downloadable reports just look better for
// billables … make it look a little bit cleaner, a little bit nicer. Maybe use our Stay logo. Put
// the month, the total").
//
// Stay's own colours: ink #101114 and the bronze #8C6D3A the app uses as its accent. The header
// band is ink with white type, the rule under the letterhead is bronze, rows alternate against a
// warm off-white, and the total is the biggest thing on the page after the logo. Gridlines are
// off — a statement should read as a document, not as a spreadsheet someone forgot to finish.
const INK = 'FF101114', BRONZE = 'FF8C6D3A', MUTED = 'FF8A8578', BAND = 'FFF7F4ED', LINE = 'FFE4E0D8', TOTALBG = 'FFF4F1EA'
const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
  '<fonts count="9">' +
  `<font><sz val="11"/><color rgb="${INK}"/><name val="Calibri"/></font>` +                                  // 0 body
  `<font><b/><sz val="11"/><color rgb="${INK}"/><name val="Calibri"/></font>` +                               // 1 bold
  `<font><b/><sz val="18"/><color rgb="${INK}"/><name val="Calibri"/></font>` +                               // 2 owner name
  `<font><sz val="10"/><color rgb="${MUTED}"/><name val="Calibri"/></font>` +                                 // 3 muted
  `<font><u/><sz val="10"/><color rgb="${BRONZE}"/><name val="Calibri"/></font>` +                            // 4 link
  '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +                             // 5 header band
  `<font><b/><sz val="20"/><color rgb="${BRONZE}"/><name val="Calibri"/></font>` +                            // 6 the total
  `<font><b/><sz val="9"/><color rgb="${MUTED}"/><name val="Calibri"/></font>` +                              // 7 small label
  `<font><b/><sz val="12"/><color rgb="${INK}"/><name val="Calibri"/></font>` +                               // 8 total row
  '</fonts>' +
  '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  `<fill><patternFill patternType="solid"><fgColor rgb="${INK}"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="${BAND}"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="${TOTALBG}"/><bgColor indexed="64"/></patternFill></fill>` +
  '</fills>' +
  '<borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  `<border><left/><right/><top/><bottom style="hair"><color rgb="${LINE}"/></bottom><diagonal/></border>` +
  `<border><left/><right/><top style="medium"><color rgb="${BRONZE}"/></top><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="medium"><color rgb="${BRONZE}"/></bottom><diagonal/></border>` +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="22">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                                                       // 0 default
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                                          // 1 bold
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +                     // 2 owner name
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' +                     // 3 muted
  '<xf numFmtId="0" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +       // 4 header band
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +                      // 5 cell
  '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +        // 6 cell banded
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +   // 7 money
  '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' + // 8 money banded
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +     // 9 number
  '<xf numFmtId="2" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +   // 10 number banded
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +        // 11 link
  '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' + // 12 link banded
  '<xf numFmtId="0" fontId="8" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +       // 13 total label
  '<xf numFmtId="164" fontId="8" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' + // 14 total money
  '<xf numFmtId="164" fontId="6" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +            // 15 the big total
  '<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="bottom"/></xf>' +  // 16 small label, right
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +         // 17 wrapped cell
  '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' + // 18 wrapped banded
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1"/>' +                                                                        // 19 the bronze rule
  '<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                                                          // 20 small label, left
  '<xf numFmtId="0" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +     // 21 header band, right
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

function sheetXml(sh: XSheet): string {
  const cols = sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const rowsXml: string[] = []
  for (let r = 0; r < sh.rows.length; r++) {
    const cells: string[] = []
    const row = sh.rows[r]
    for (let c = 0; c < row.length; c++) {
      const cellDef = row[c]
      if (cellDef == null) continue
      const ref = colRef(c) + String(r + 1)
      const s = cellDef.s ? ` s="${cellDef.s}"` : ''
      if (cellDef.num) cells.push(`<c r="${ref}"${s}><v>${cellDef.v}</v></c>`)
      else if (cellDef.v === '' || cellDef.v == null) cells.push(`<c r="${ref}"${s}/>`)
      else cells.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(cellDef.v)}</t></is></c>`)
    }
    const ht = sh.heights?.[r + 1]
    rowsXml.push(`<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>` + cells.join('') + '</row>')
  }
  const links = sh.links || []
  const hyperlinks = links.length
    ? '<hyperlinks>' + links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rhl${i + 1}"/>`).join('') + '</hyperlinks>'
    : ''
  const merges = (sh.merges || []).length
    ? `<mergeCells count="${sh.merges!.length}">` + sh.merges!.map(m => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>'
    : ''
  // Gridlines off, the list frozen under the header, and the whole thing set up to print on one
  // page wide — an owner who hits Print should get the statement, not columns A–F of it.
  const frozen = sh.freeze
    ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
    : ''
  const views = `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${frozen}</sheetView></sheetViews>`
  const print = '<printOptions/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="1"/>'
  // The order of these elements is fixed by the schema: cols, sheetData, mergeCells, hyperlinks,
  // print, then the drawing. Out of order, Excel calls the file corrupt.
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' + views +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? '<cols>' + cols + '</cols>' : '') +
    '<sheetData>' + rowsXml.join('') + '</sheetData>' + merges + hyperlinks + print +
    (sh.logo ? '<drawing r:id="rdrw"/>' : '') +
    '</worksheet>'
}

function makeXlsx(sheets: XSheet[]): Buffer {
  const entries: { name: string; data: Buffer }[] = []
  const put = (name: string, xml: string) => entries.push({ name, data: Buffer.from(xml, 'utf8') })
  const overrides = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  const anyLogo = sheets.some(sh => sh.logo)
  put('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (anyLogo ? '<Default Extension="png" ContentType="image/png"/>' : '') +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    (anyLogo ? sheets.map((sh, i) => sh.logo ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '').join('') : '') +
    overrides + '</Types>')
  put('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  const sheetTags = sheets.map((sh, i) => `<sheet name="${xesc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  // Print_Titles: the column headings repeat at the top of every printed page.
  const titles = sheets.map((sh, i) => sh.printTitleRow
    ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xesc(sh.name).replace(/'/g, "''")}'!$${sh.printTitleRow}:$${sh.printTitleRow}</definedName>`
    : '').join('')
  put('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetTags + '</sheets>' + (titles ? '<definedNames>' + titles + '</definedNames>' : '') + '</workbook>')
  const rels = sheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  put('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>')
  put('xl/styles.xml', XLSX_STYLES)
  if (anyLogo) entries.push({ name: 'xl/media/stay-logo.png', data: stayLogoPng() })
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i]
    put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh))
    const links = sh.links || []
    const rels = links.map((l, j) =>
      `<Relationship Id="rhl${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xesc(l.url)}" TargetMode="External"/>`).join('')
      + (sh.logo ? `<Relationship Id="rdrw" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/>` : '')
    if (rels) {
      put(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>')
    }
    if (sh.logo) {
      // One-cell anchor at A1: the mark floats over the header block at a third of its size,
      // which is ~140×59 px — letterhead, not a billboard. EMU = pixels × 9525.
      const w = Math.round(STAY_LOGO_W / 3 * 9525), h = Math.round(STAY_LOGO_H / 3 * 9525)
      put(`xl/drawings/drawing${i + 1}.xml`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<xdr:oneCellAnchor>' +
        '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>57150</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>57150</xdr:rowOff></xdr:from>' +
        `<xdr:ext cx="${w}" cy="${h}"/>` +
        '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Stay Hospitality"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rid1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>')
      put(`xl/drawings/_rels/drawing${i + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rid1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/stay-logo.png"/></Relationships>')
    }
  }
  return buildZip(entries)
}

// ── The owner sheet content: clean, statement-ready ─────────────────────────
// Every INDIVIDUAL task line: what was done, when it was completed, by whom, the labor math,
// and a clickable Breezeway link straight to the task (Jon 2026-08-07).
const OWNER_WIDTHS = [10, 22, 46, 14, 18, 12, 8, 10, 14, 9]
const LINK_COL = 9   // column J
// The last column holds the "View" links, and a heading over it only crowds the right-aligned
// Amount beside it — the links say what they are.
const HEADERS = ['Date', 'Unit', 'Service', 'Type', 'Completed by', 'Completed', 'Hours', 'Rate', 'Amount', '']
/** "Oct 4" — the year is in the period line above, so the column stays narrow. */
const shortDay = (ymd: string) => {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(ymd || '')
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return MON[Number(m[2]) - 1] + ' ' + Number(m[3])
}

/**
 * THE LETTERHEAD, on every sheet: the logo at A1, who it is for and what period, and the total —
 * the three things Jon asked to be unmissable. Five rows, then the work.
 */
function letterhead(rows: XCell[][], merges: string[], heights: Record<number, number>, title: string, sub: string, total: number, cols: number): void {
  // The logo occupies roughly the first two columns of rows 1–3, so the title starts clear of it
  // and the total sits in the last two columns, hard right.
  const tCol = cols >= 9 ? 3 : 2                   // where the name begins
  const mStart = Math.max(tCol + 1, cols - 2)      // where the total block begins
  const mEnd = cols - 1
  const row = (fill: (i: number) => XCell | null) => { const r: XCell[] = []; for (let i = 0; i < cols; i++) r.push(fill(i) || { v: '' }); return r }
  rows.push(row(i => i === mStart ? { v: 'TOTAL BILLED', s: 16 } : (i > mStart && i <= mEnd ? { v: '', s: 16 } : null)))
  rows.push(row(i => i === tCol ? { v: title, s: 2 } : i === mStart ? { v: total, s: 15, num: true } : (i > mStart && i <= mEnd ? { v: '', s: 15 } : null)))
  rows.push(row(i => i === tCol ? { v: sub, s: 3 } : null))
  rows.push(row(() => ({ v: '', s: 19 })))
  const A = (i: number) => colRef(i)
  merges.push(`${A(tCol)}2:${A(mStart - 1)}2`, `${A(tCol)}3:${A(mStart - 1)}3`, `${A(mStart)}1:${A(mEnd)}1`, `${A(mStart)}2:${A(mEnd)}2`)
  heights[1] = 20; heights[2] = 28; heights[3] = 16; heights[4] = 10
}

function ownerSheetData(month: string, ownerName: string, ts: BillingTask[], chargeRate: number, used: Record<string, boolean>): XSheet {
  const billable = ts.filter(t => t.billedAmount > 0)
    .sort((a, b) => (a.unit + (a.scheduledDate || '')).localeCompare(b.unit + (b.scheduledDate || '')))
  const rows: XCell[][] = []
  const links: { ref: string; url: string }[] = []
  const merges: string[] = []
  const heights: Record<number, number> = {}

  // Every billable line, worked out first — the total has to be in the letterhead, above them.
  type Out = { cells: (string | number)[]; url: string }
  const out: Out[] = []
  let total = 0
  for (const t of billable) {
    for (const l of linesOf(t)) {
      if (l.amount <= 0) continue
      total += l.amount
      let service = l.kind === 'labor' || l.kind === 'override' ? l.task : l.task + ' — ' + l.description
      if (l.note) service += ' (' + l.note + ')'
      const dept = String(t.department || 'labor')
      const typeLabel = l.kind === 'supply' ? 'Supply' : (dept.charAt(0).toUpperCase() + dept.slice(1))
      // Hours and a rate only where they are real. A price set by hand has no hours behind it, and
      // dividing it by the charge rate would print an invented 7.5h beside it.
      const isLabor = l.kind !== 'supply' && l.kind !== 'override'
      const h = isLabor
        ? (t.billedHours != null && l.kind === 'labor' ? t.billedHours : l.amount / chargeRate)
        : null
      out.push({
        cells: [shortDay(l.date), l.unit, service, typeLabel, t.finishedBy || l.assignee || '',
          shortDay(t.finishedAt ? String(t.finishedAt).slice(0, 10) : ''),
          h == null ? '' : Math.round(h * 100) / 100, h == null ? '' : chargeRate, Math.round(l.amount * 100) / 100, 'View'],
        url: 'https://app.breezeway.io/task/' + t.id,
      })
    }
  }

  letterhead(rows, merges, heights, ownerName, 'Billable services · ' + monthLabel(month), Math.round(total * 100) / 100, HEADERS.length)

  // The column headings: ink band, white type.
  rows.push(HEADERS.map((h, i) => ({ v: h, s: i >= 6 && i <= 8 ? 21 : 4 })))
  heights[rows.length] = 22
  const headerRow = rows.length

  // The work. Rows alternate against a warm off-white so the eye can hold a line across ten columns.
  out.forEach((o, i) => {
    const b = i % 2 === 1
    const text = b ? 6 : 5, wrap = b ? 18 : 17, mon = b ? 8 : 7, num = b ? 10 : 9, link = b ? 12 : 11
    rows.push([
      { v: o.cells[0], s: text }, { v: o.cells[1], s: text }, { v: o.cells[2], s: wrap }, { v: o.cells[3], s: text },
      { v: o.cells[4], s: text }, { v: o.cells[5], s: text },
      o.cells[6] === '' ? { v: '', s: text } : { v: o.cells[6], s: num, num: true },
      o.cells[7] === '' ? { v: '', s: text } : { v: o.cells[7], s: mon, num: true },
      { v: o.cells[8], s: mon, num: true },
      { v: o.cells[9], s: link },
    ])
    links.push({ ref: colRef(LINK_COL) + String(rows.length), url: o.url })
  })
  if (!out.length) rows.push([{ v: 'Nothing billable in this period.', s: 3 }])

  // The total again, at the foot of the list, where an accountant looks for it.
  rows.push(HEADERS.map((_, i) => i === 0 ? { v: 'TOTAL', s: 13 } : i === 8 ? { v: Math.round(total * 100) / 100, s: 14, num: true } : { v: '', s: 13 }))
  heights[rows.length] = 22
  rows.push([])
  rows.push([{ v: 'Stay Hospitality · questions about any line on this statement: support@stay-hospitality.com', s: 3 }])

  return { name: sheetName(ownerName, used), widths: OWNER_WIDTHS, rows, links, merges, heights, freeze: headerRow, logo: true, printTitleRow: headerRow }
}

function workbookSheets(month: string, tasks: BillingTask[], chargeRate: number): XSheet[] {
  const live = tasks.filter(t => !t.excluded)
  const byOwner: Record<string, BillingTask[]> = {}
  for (const t of live) {
    const k = t.ownerName
    if (!byOwner[k]) byOwner[k] = []
    byOwner[k].push(t)
  }
  const ownerNames = Object.keys(byOwner).sort((a, b) => a.localeCompare(b))
  const used: Record<string, boolean> = {}
  const sheets: XSheet[] = []
  if (ownerNames.length > 1) {
    const rows: XCell[][] = []
    const merges: string[] = []
    const heights: Record<number, number> = {}
    const head = ['Billing owner', 'Jobs', 'Hours', 'In-house labor', 'Vendor labor', 'Billed']
    const body: { o: string; n: number; mins: number; billed: number; laborIn: number; laborVen: number }[] = []
    let grand = 0, grandIn = 0, grandVen = 0
    for (const o of ownerNames) {
      const ts = byOwner[o]
      const mins = ts.reduce((s, t) => s + (t.actualMinutes || 0), 0)
      const billed = ts.reduce((s, t) => s + t.billedAmount, 0)
      const laborIn = ts.reduce((s, t) => s + (!t.excluded && t.crew === 'inhouse' ? t.laborAmount : 0), 0)
      const laborVen = ts.reduce((s, t) => s + (!t.excluded && t.crew === 'vendor' ? t.laborAmount : 0), 0)
      grand += billed; grandIn += laborIn; grandVen += laborVen
      body.push({ o, n: ts.length, mins, billed, laborIn, laborVen })
    }
    // Biggest bill first: a summary is read for who owes what, not alphabetically.
    body.sort((a, b) => b.billed - a.billed || a.o.localeCompare(b.o))
    letterhead(rows, merges, heights, 'Billable services', monthLabel(month) + ' · ' + body.length + ' owner' + (body.length === 1 ? '' : 's'), Math.round(grand * 100) / 100, head.length)
    rows.push(head.map((h, i) => ({ v: h, s: i >= 1 ? 21 : 4 })))
    heights[rows.length] = 22
    const headerRow = rows.length
    body.forEach((r, i) => {
      const b = i % 2 === 1
      const text = b ? 6 : 5, mon = b ? 8 : 7, num = b ? 10 : 9
      rows.push([{ v: r.o, s: text }, { v: r.n, s: num, num: true }, { v: Math.round(r.mins / 60 * 100) / 100, s: num, num: true },
        { v: Math.round(r.laborIn * 100) / 100, s: mon, num: true }, { v: Math.round(r.laborVen * 100) / 100, s: mon, num: true },
        { v: Math.round(r.billed * 100) / 100, s: mon, num: true }])
    })
    rows.push([{ v: 'TOTAL', s: 13 }, { v: '', s: 13 }, { v: '', s: 13 },
      { v: Math.round(grandIn * 100) / 100, s: 14, num: true }, { v: Math.round(grandVen * 100) / 100, s: 14, num: true },
      { v: Math.round(grand * 100) / 100, s: 14, num: true }])
    heights[rows.length] = 22
    used['Summary'] = true
    sheets.push({ name: 'Summary', widths: [36, 9, 10, 16, 16, 15], rows, merges, heights, freeze: headerRow, logo: true, printTitleRow: headerRow })
  }
  for (const o of ownerNames) sheets.push(ownerSheetData(month, o, byOwner[o], chargeRate, used))
  return sheets
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET(req: NextRequest) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const month = String(sp.get('month') || '').slice(0, 7)
  const format = String(sp.get('format') || 'csv')
  const ownerId = String(sp.get('owner') || '')
  // Honour the board's custom date window so an export always matches what was on screen.
  const isYmd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  const xFrom = String(sp.get('from') || ''), xTo = String(sp.get('to') || '')
  const xCustom = isYmd(xFrom) && isYmd(xTo) && xFrom <= xTo
  try {
    const { tasks } = xCustom ? await billingRange(xFrom, xTo) : await billingMonth(month)
    const doneOnly = sp.get('done') === '1'
    let scoped = ownerId ? tasks.filter(t => String(t.ownerId || '') === ownerId) : tasks
    if (doneOnly) scoped = scoped.filter(t => /complet|close|approv|finish/.test(t.status) || t.finishedAt || t.overrideAmount != null)
    if (sp.get('reviewed') === '1') {
      // The close-out set: only lines that passed ops review AND GM sign-off (billing_adjustments.review_state).
      scoped = scoped.filter(t => t.reviewState === 'gm_approved')
    }

    if (format === 'zip') {
      // One real .xlsx per owner, zipped — each named for the owner + month. $0 owners skipped:
      // if there is a number on the report it goes on the statement; $0 does not.
      const def = await getSetting<{ rate: number }>('billing_default_rate', { rate: 40 })
      const chargeRate = Number(def?.rate) > 0 ? Number(def.rate) : 40
      const byOwner: Record<string, BillingTask[]> = {}
      for (const t of scoped) {
        if (t.excluded) continue
        const k = t.ownerName
        if (!byOwner[k]) byOwner[k] = []
        byOwner[k].push(t)
      }
      const label = monthLabel(month)
      const entries: { name: string; data: Buffer }[] = []
      const usedNames: Record<string, boolean> = {}
      for (const o of Object.keys(byOwner).sort((a, b) => a.localeCompare(b))) {
        const ts = byOwner[o]
        const billed = ts.reduce((s, t) => s + t.billedAmount, 0)
        if (billed <= 0) continue
        const base = cleanName(o) + ' - Billable Labor - ' + label
        let name = base + '.xlsx'; let i = 2
        while (usedNames[name]) { name = base + ' (' + i + ').xlsx'; i++ }
        usedNames[name] = true
        const used: Record<string, boolean> = {}
        entries.push({ name, data: makeXlsx([ownerSheetData(month, o, ts, chargeRate, used)]) })
      }
      if (!entries.length) return NextResponse.json({ ok: false, error: 'No owners with billable amounts in this month.' }, { status: 404 })
      const zip = buildZip(entries)
      return new NextResponse(zip as any, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="billable-labor-${month || 'month'}.zip"`,
        },
      })
    }

    if (format === 'xls') {
      const def = await getSetting<{ rate: number }>('billing_default_rate', { rate: 40 })
      const chargeRate = Number(def?.rate) > 0 ? Number(def.rate) : 40
      const body = makeXlsx(workbookSheets(month, scoped, chargeRate))
      const ownerName = ownerId && scoped[0] ? cleanName(String(scoped[0].ownerName || '')).replace(/\s+/g, '-').slice(0, 40) : ''
      const fname = ownerName ? `billable-${ownerName}-${month || 'month'}.xlsx` : `billing-${month || 'month'}.xlsx`
      return new NextResponse(body as any, {
        headers: {
          'Content-Type': XLSX_MIME,
          'Content-Disposition': `attachment; filename="${fname}"`,
        },
      })
    }

    const body = toCsv(scoped)
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="billing-${month || 'month'}.csv"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}


// ── TEST HATCH ─────────────────────────────────────────────────────────────
// __TEST_EXPORTS__ — the workbook builders, so a script can render a sample and prove Excel will
// open it without standing up the whole route. Not referenced by the app.
export const __testBuild = { makeXlsx, ownerSheetData, workbookSheets }
