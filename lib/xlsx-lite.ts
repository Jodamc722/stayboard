// A REAL .xlsx, WITH NO DEPENDENCY.
//
// An xlsx is a zip of XML parts, so this writes both by hand: a stored-entry ZIP writer and the
// handful of Office Open XML parts a workbook needs. The reason is the same one that produced
// lib/salato-pdf.ts — this repo ships through the GitHub web editor, so package.json cannot gain a
// dependency mid-flight, and "download the order sheet" should not depend on a CDN being reachable
// from an owner's hotel wifi.
//
// Style indexes (cellXfs below):
//   0 default · 1 bold · 2 title (bold 14) · 3 header (bold, grey fill, bottom border)
//   4 currency · 5 number 0.00 · 6 total currency (bold, top border) · 7 total label · 8 muted/link
//
// NOTE: app/api/billing/export/route.ts carries its own older copy of this writer. Leave it be —
// it is live and working; new callers should import from here.
import 'server-only'

const xesc = (s: any) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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
export type XCell = { v: string | number; s?: number; num?: boolean }
export type XSheet = { name: string; widths: number[]; rows: XCell[][]; links?: { ref: string; url: string }[] }

export function colRef(i: number): string {
  let n = i + 1; let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
  '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
  '<font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font>' +
  '<font><u/><sz val="11"/><color rgb="FF2563EB"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEEEFF3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFB8BCC6"/></bottom><diagonal/></border>' +
  '<border><left/><right/><top style="medium"/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="9">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs></styleSheet>'

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
    rowsXml.push(`<row r="${r + 1}">` + cells.join('') + '</row>')
  }
  const links = sh.links || []
  const hyperlinks = links.length
    ? '<hyperlinks>' + links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rhl${i + 1}"/>`).join('') + '</hyperlinks>'
    : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    (cols ? '<cols>' + cols + '</cols>' : '') +
    '<sheetData>' + rowsXml.join('') + '</sheetData>' + hyperlinks + '</worksheet>'
}

export function makeXlsx(sheets: XSheet[]): Buffer {
  const entries: { name: string; data: Buffer }[] = []
  const put = (name: string, xml: string) => entries.push({ name, data: Buffer.from(xml, 'utf8') })
  const overrides = sheets.map((_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  put('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides + '</Types>')
  put('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  const sheetTags = sheets.map((sh, i) => `<sheet name="${xesc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  put('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheetTags + '</sheets></workbook>')
  const rels = sheets.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  put('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>')
  put('xl/styles.xml', XLSX_STYLES)
  for (let i = 0; i < sheets.length; i++) {
    put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[i]))
    const links = sheets[i].links || []
    if (links.length) {
      const linkRels = links.map((l, j) =>
        `<Relationship Id="rhl${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xesc(l.url)}" TargetMode="External"/>`).join('')
      put(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + linkRels + '</Relationships>')
    }
  }
  return buildZip(entries)
}