// THE STARTER KIT WORKBOOK WRITER (Jon, 2026-11-11: "there should be a must have, recommended and
// optional in the excel download… add a checkmark list for them too, so when they order they can check
// it off and a checklist for added to unit. Make it super nice").
//
// A sibling of lib/xlsx-lite (same no-dependency idea: an xlsx is a zip of XML parts), with what the
// kit's two downloads need and xlsx-lite does not do: tier colour bands, tick cells (☐ / ☑ chosen from
// an in-cell list, turning green when ticked), frozen header rows AND columns, a header row repeated
// on every printed page, landscape fit-to-width printing and a page footer. xlsx-lite is shared by
// billing and other exports, so it is left untouched; the kit's writers use this one.
//
// Real Excel checkboxes (the 2024 "Insert > Checkbox" cell feature) need a feature-property-bag part
// that older Excel, Numbers and Google Sheets do not read, so ticks are a data-validation list instead:
// works everywhere, prints as a box, and COUNTIF can count it for the progress rows.
import 'server-only'

export const CHECK_OFF = '☐'
export const CHECK_ON = '☑'

const xesc = (s: unknown) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function colRef(i: number): string {
  let n = i + 1; let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

/** Today in Miami (America/New_York) as YYYY-MM-DD, for file names. */
export function nyDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
/** Safe for a download file name: no path or reserved characters, one space between words. */
export const safeName = (s: string) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

/** Rows (1-based) in one column, written as the fewest ranges: "K8:K12 K14:K20". */
export function runs(col: number, rows: number[]): string[] {
  const c = colRef(col)
  const s = Array.from(new Set(rows)).sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(s[i] === s[j] ? `${c}${s[i]}` : `${c}${s[i]}:${c}${s[j]}`)
    i = j
  }
  return out
}

// ── styles ──────────────────────────────────────────────────────────────────────────────────────────
// Stay's palette (teal #1F5F5B, ink #15212B) and the tier colours the kit page uses:
// must #1C4A7E on #E1EAF5 · recommended #25633A on #E0EFE4 · optional #56626B on #ECEFF1.
const FONTS = [
  '<font><sz val="11"/><color rgb="FF15212B"/><name val="Calibri"/></font>',                 // 0 body
  '<font><b/><sz val="11"/><color rgb="FF15212B"/><name val="Calibri"/></font>',             // 1 bold
  '<font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',             // 2 title
  '<font><sz val="10"/><color rgb="FFE2EFED"/><name val="Calibri"/></font>',                 // 3 band subtitle
  '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',             // 4 header
  '<font><sz val="10"/><color rgb="FF6B7880"/><name val="Calibri"/></font>',                 // 5 muted
  '<font><b/><sz val="10"/><color rgb="FF1C4A7E"/><name val="Calibri"/></font>',             // 6 must
  '<font><b/><sz val="10"/><color rgb="FF25633A"/><name val="Calibri"/></font>',             // 7 recommended
  '<font><b/><sz val="10"/><color rgb="FF56626B"/><name val="Calibri"/></font>',             // 8 optional
  '<font><u/><sz val="10"/><color rgb="FF1F5F5B"/><name val="Calibri"/></font>',             // 9 link
  '<font><sz val="15"/><color rgb="FF15212B"/><name val="Segoe UI Symbol"/></font>',         // 10 tick box
  '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',             // 11 tier band
  '<font><b/><sz val="11"/><color rgb="FF1F5F5B"/><name val="Calibri"/></font>',             // 12 progress
]
const FILLS = ['', '', 'FF1F5F5B', 'FF15212B', 'FFE1EAF5', 'FFE0EFE4', 'FFECEFF1', 'FF1C4A7E', 'FF25633A', 'FF56626B', 'FFFFF8E6', 'FFE2EFED']
//             0 none, 1 gray125, 2 teal, 3 ink, 4-6 pale tiers, 7-9 strong tiers, 10 input, 11 soft teal
const BORDERS = [
  '<border><left/><right/><top/><bottom/><diagonal/></border>',
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE2E0"/></bottom><diagonal/></border>',
  '<border><left/><right/><top style="medium"><color rgb="FF15212B"/></top><bottom style="thin"><color rgb="FFDCE2E0"/></bottom><diagonal/></border>',
  '<border><left style="thin"><color rgb="FFC9D1CE"/></left><right style="thin"><color rgb="FFC9D1CE"/></right><top style="thin"><color rgb="FFC9D1CE"/></top><bottom style="thin"><color rgb="FFC9D1CE"/></bottom><diagonal/></border>',
]
type Xf = { font: number; fill?: number; border?: number; fmt?: number; h?: 'left' | 'center' | 'right'; wrap?: boolean }
const TIER_FILL = { must: [6, 4, 7], recommended: [7, 5, 8], optional: [8, 6, 9] } as const   // [font, pale fill, strong fill]
const STYLE_DEFS: Record<string, Xf> = {
  plain: { font: 0 },
  title: { font: 2, fill: 2, h: 'left' },
  sub: { font: 3, fill: 2, h: 'left', wrap: true },
  cta: { font: 4, fill: 3, h: 'left', wrap: true },
  head: { font: 4, fill: 3, border: 1, h: 'left', wrap: true },
  headC: { font: 4, fill: 3, border: 1, h: 'center', wrap: true },
  body: { font: 0, border: 1, h: 'left', wrap: true },
  bodyB: { font: 1, border: 1, h: 'left', wrap: true },
  muted: { font: 5, border: 1, h: 'left', wrap: true },
  qty: { font: 0, border: 1, h: 'center' },
  qtyB: { font: 1, border: 1, h: 'center' },
  money: { font: 0, border: 1, fmt: 164, h: 'right' },
  input: { font: 0, fill: 10, border: 3, h: 'center' },
  check: { font: 10, border: 3, h: 'center' },
  dash: { font: 5, border: 1, h: 'center' },
  link: { font: 9, border: 1, h: 'left' },
  tot: { font: 1, border: 2, h: 'left' },
  totQ: { font: 1, border: 2, h: 'center' },
  totM: { font: 1, border: 2, fmt: 164, h: 'right' },
  prog: { font: 12, fill: 11, h: 'left' },
  progC: { font: 12, fill: 11, h: 'center' },
  note: { font: 5, h: 'left', wrap: true },
}
for (const [t, [font, pale, strong]] of Object.entries(TIER_FILL)) {
  STYLE_DEFS['chip_' + t] = { font, fill: pale, border: 1, h: 'center' }
  STYLE_DEFS['band_' + t] = { font: 11, fill: strong, h: 'left' }
  STYLE_DEFS['sub_' + t] = { font: 1, fill: pale, border: 1, h: 'left' }
  STYLE_DEFS['subQ_' + t] = { font: 1, fill: pale, border: 1, h: 'center' }
  STYLE_DEFS['subM_' + t] = { font: 1, fill: pale, border: 1, fmt: 164, h: 'right' }
}
const STYLE_NAMES = ['default', ...Object.keys(STYLE_DEFS)]
const STYLE_INDEX: Record<string, number> = Object.fromEntries(STYLE_NAMES.map((n, i) => [n, i]))
export type KStyle = string

const STYLES_XML = (() => {
  const fills = FILLS.map((c, i) => i === 0 ? '<fill><patternFill patternType="none"/></fill>' : i === 1 ? '<fill><patternFill patternType="gray125"/></fill>'
    : `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('')
  const xf = (d: Xf) => `<xf numFmtId="${d.fmt || 0}" fontId="${d.font}" fillId="${d.fill || 0}" borderId="${d.border || 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">` +
    `<alignment horizontal="${d.h || 'general'}" vertical="center"${d.wrap ? ' wrapText="1"' : ''}/></xf>`
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', ...Object.values(STYLE_DEFS).map(xf)]
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
    `<fills count="${FILLS.length}">${fills}</fills>` +
    `<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    // dxf 0: a ticked box goes green.
    '<dxfs count="1"><dxf><font><b/><color rgb="FF25633A"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFE0EFE4"/></patternFill></fill></dxf></dxfs>' +
    '</styleSheet>'
})()

// ── sheets ──────────────────────────────────────────────────────────────────────────────────────────
export type KCell = { v?: string | number | null; s?: KStyle; f?: string } | null
export type KSheet = {
  name: string; widths: number[]; rows: KCell[][]
  merges?: string[]; heights?: Record<number, number>            // heights keyed by 1-based row
  freezeRows?: number; freezeCols?: number
  links?: { ref: string; url: string }[]
  checks?: string[]                                              // ranges holding ☐ / ☑ tick cells
  printTitleRows?: [number, number]                              // repeated at the top of every printed page
  landscape?: boolean; footer?: string; tabColor?: string
}

/** Shorthands for building rows. */
export const T = (v: string | number, s: KStyle = 'body'): KCell => ({ v, s })
export const N = (v: number, s: KStyle = 'qty'): KCell => ({ v, s })
export const F = (f: string, s: KStyle = 'qty'): KCell => ({ f, s })
export const pad = (row: KCell[], n: number, s: KStyle): KCell[] => { while (row.length < n) row.push({ v: '', s }); return row }

function sheetXml(sh: KSheet): string {
  const rows: string[] = []
  for (let r = 0; r < sh.rows.length; r++) {
    const cells: string[] = []
    const row = sh.rows[r] || []
    for (let c = 0; c < row.length; c++) {
      const d = row[c]
      if (!d) continue
      const ref = colRef(c) + (r + 1)
      const s = d.s && STYLE_INDEX[d.s] ? ` s="${STYLE_INDEX[d.s]}"` : ''
      if (d.f) cells.push(`<c r="${ref}"${s}><f>${xesc(d.f)}</f></c>`)
      else if (typeof d.v === 'number' && Number.isFinite(d.v)) cells.push(`<c r="${ref}"${s}><v>${d.v}</v></c>`)
      else if (d.v === '' || d.v == null) cells.push(`<c r="${ref}"${s}/>`)
      else cells.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(d.v)}</t></is></c>`)
    }
    const ht = sh.heights?.[r + 1]
    rows.push(`<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`)
  }
  const fr = sh.freezeRows || 0, fc = sh.freezeCols || 0
  const pane = fr || fc
    ? `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${colRef(fc)}${fr + 1}" activePane="${fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : ''
  const views = `<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100">${pane}</sheetView></sheetViews>`
  const sheetPr = `<sheetPr>${sh.tabColor ? `<tabColor rgb="${sh.tabColor}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>`
  const cols = sh.widths.length ? '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : ''
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  const checks = (sh.checks || []).filter(Boolean)
  const cf = checks.length
    ? `<conditionalFormatting sqref="${checks.join(' ')}"><cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>"${CHECK_ON}"</formula></cfRule></conditionalFormatting>`
    : ''
  const dv = checks.length
    ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" promptTitle="Tick it off" prompt="Pick ${CHECK_ON} when done, ${CHECK_OFF} to undo." errorTitle="Pick from the list" error="Use ${CHECK_OFF} or ${CHECK_ON}." sqref="${checks.join(' ')}"><formula1>"${CHECK_OFF},${CHECK_ON}"</formula1></dataValidation></dataValidations>`
    : ''
  const links = sh.links || []
  const hl = links.length ? '<hyperlinks>' + links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rhl${i + 1}"/>`).join('') + '</hyperlinks>' : ''
  const print = '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.25" footer="0.3"/>' +
    `<pageSetup paperSize="1" orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>${xesc(`&L&8${(sh.footer || sh.name).replace(/&/g, '&&')}&R&8Page &P of &N`)}</oddFooter></headerFooter>`
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    sheetPr + views + '<sheetFormatPr defaultRowHeight="18"/>' + cols + '<sheetData>' + rows.join('') + '</sheetData>' +
    merges + cf + dv + hl + print + '</worksheet>'
}

// ── zip (stored entries; same approach as lib/xlsx-lite) ───────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0 } return t })()
const crc32 = (d: Buffer) => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const now = new Date()
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xFFFF
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF
  const locals: Buffer[] = [], centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), crc = crc32(e.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8)
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28)
    locals.push(lh, name, e.data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(e.data.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length + e.data.length
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, cd, end])
}

/** Sheet names: Excel's 31-character limit, no []:*?/\ and unique. */
function sheetNames(sheets: KSheet[]): string[] {
  const used = new Set<string>()
  return sheets.map((s, i) => {
    let n = (s.name || `Sheet ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || `Sheet ${i + 1}`
    while (used.has(n.toLowerCase())) n = n.slice(0, 27) + ' ' + (i + 1)
    used.add(n.toLowerCase())
    return n
  })
}

export function makeKitWorkbook(sheets: KSheet[]): Buffer {
  const names = sheetNames(sheets)
  const entries: { name: string; data: Buffer }[] = []
  const put = (name: string, xml: string) => entries.push({ name, data: Buffer.from(xml, 'utf8') })
  put('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>')
  put('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  const quoted = (n: string) => `'${n.replace(/'/g, "''")}'`
  const defined = sheets.map((s, i) => s.printTitleRows
    ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xesc(`${quoted(names[i])}!$${s.printTitleRows[0]}:$${s.printTitleRows[1]}`)}</definedName>` : '').join('')
  put('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView activeTab="0"/></bookViews>' +
    '<sheets>' + names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
    (defined ? `<definedNames>${defined}</definedNames>` : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')
  put('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  put('xl/styles.xml', STYLES_XML)
  sheets.forEach((s, i) => {
    put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml({ ...s, name: names[i] }))
    const links = s.links || []
    if (links.length) put(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      links.map((l, j) => `<Relationship Id="rhl${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xesc(l.url)}" TargetMode="External"/>`).join('') + '</Relationships>')
  })
  return zip(entries)
}

// ── shared kit vocabulary for the sheets ───────────────────────────────────────────────────────────
export type Tier = 'must' | 'recommended' | 'optional'
export const TIERS: Tier[] = ['must', 'recommended', 'optional']
export const TIER_NAME: Record<Tier, string> = { must: 'Must have', recommended: 'Recommended', optional: 'Optional' }
export const TIER_BLURB: Record<Tier, string> = {
  must: 'every home needs these before the first guest',
  recommended: 'guests notice when these are missing',
  optional: 'nice extras, add them if you like',
}
/** Excel formula: "Ordered 12 of 40 (30%)" for the tick cells in `ranges`. */
export function progressFormula(label: string, ranges: string[], total: number): string {
  if (!ranges.length || !total) return `"${label} 0 of 0"`
  const count = ranges.map(r => `COUNTIF(${r},"${CHECK_ON}")`).join('+')
  return `"${label} "&(${count})&" of ${total}  ("&TEXT((${count})/${total},"0%")&")"`
}
/** Excel formula: "12 / 40" for a subtotal row. */
export function countFormula(ranges: string[], total: number): string {
  if (!ranges.length) return `"0 / 0"`
  return `(${ranges.map(r => `COUNTIF(${r},"${CHECK_ON}")`).join('+')})&" / ${total}"`
}
