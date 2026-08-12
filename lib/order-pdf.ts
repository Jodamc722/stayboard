// A PRINTABLE QUOTE, WITH NO DEPENDENCY.
//
// Same constraint as lib/salato-pdf.ts: this repo ships through the GitHub web editor, so
// package.json cannot gain a PDF library mid-flight. A furniture quote is a title block, a table
// grouped by unit and room, and a total — well inside what a hand-written PDF can do properly.
// Helvetica and Helvetica-Bold, WinAnsi, no images.
//
// WHY A PDF AT ALL when the shareable page exists: an owner signing off on $40k of furniture wants
// something to file, forward to their accountant and print. The page is for deciding; this is for
// keeping. Both are generated from the same order rows, so they cannot disagree.
import 'server-only'

export type QuoteColumn = { header: string; width: number; align?: 'l' | 'r' }
export type QuoteSection = { heading: string; sub?: string; rows: string[][]; subtotal?: string }
export type QuoteDoc = {
  title: string
  subtitle?: string
  meta: { label: string; value: string }[]
  columns: QuoteColumn[]
  sections: QuoteSection[]
  totals: { label: string; value: string; strong?: boolean }[]
  note?: string
  footer?: string
}

const PAGE_W = 612, PAGE_H = 792, MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2

// Helvetica has no glyph for smart punctuation or emoji; fold what we actually emit to ASCII so it
// renders rather than silently dropping, then strip anything still outside Latin-1.
function latin1(s: any): string {
  return String(s == null ? '' : s)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}
const esc = (s: any) => latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

// Helvetica averages ~0.5em, bold ~0.53em. Good enough to right-align money and to know when a
// cell needs truncating; this is a quote, not typesetting.
const widthOf = (s: string, size: number, bold = false) => latin1(s).length * size * (bold ? 0.53 : 0.5)
function fit(s: string, maxW: number, size: number, bold = false): string {
  const t = latin1(s)
  if (widthOf(t, size, bold) <= maxW) return t
  const per = size * (bold ? 0.53 : 0.5)
  const n = Math.max(1, Math.floor(maxW / per) - 1)
  return t.slice(0, n) + '…'.replace('…', '..')
}
function wrap(s: string, maxW: number, size: number): string[] {
  const words = latin1(s).split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (widthOf(next, size) <= maxW) cur = next
    else { if (cur) out.push(cur); cur = w }
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}

type Page = { ops: string[] }

export function buildQuotePdf(doc: QuoteDoc): Buffer {
  const pages: Page[] = []
  let page: Page = { ops: [] }
  let y = 0

  const newPage = () => { page = { ops: [] }; pages.push(page); y = PAGE_H - MARGIN }
  const text = (x: number, yy: number, size: number, s: string, bold = false, grey = false) => {
    page.ops.push(
      'BT ' + (grey ? '0.42 0.45 0.5 rg ' : '0 0 0 rg ') +
      '/' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf 1 0 0 1 ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Tm (' + esc(s) + ') Tj ET')
  }
  const rule = (yy: number, w = 0.6, grey = 0.78) => {
    page.ops.push(grey.toFixed(2) + ' G ' + w + ' w ' + MARGIN + ' ' + yy.toFixed(1) + ' m ' + (PAGE_W - MARGIN) + ' ' + yy.toFixed(1) + ' l S')
  }
  const band = (yy: number, h: number) => {
    page.ops.push('0.945 0.949 0.957 rg ' + MARGIN + ' ' + (yy).toFixed(1) + ' ' + CONTENT_W + ' ' + h + ' re f 0 0 0 rg')
  }

  // Column x positions from the declared widths, scaled to the content width.
  const totalW = doc.columns.reduce((a, c) => a + c.width, 0) || 1
  const colW = doc.columns.map(c => (c.width / totalW) * CONTENT_W)
  const colX: number[] = []
  { let x = MARGIN; for (const w of colW) { colX.push(x); x += w } }

  const cellX = (i: number, s: string, size: number, bold: boolean) =>
    doc.columns[i].align === 'r' ? colX[i] + colW[i] - 6 - widthOf(fit(s, colW[i] - 8, size, bold), size, bold) : colX[i] + 2

  const headerRow = () => {
    band(y - 13, 17)
    for (let i = 0; i < doc.columns.length; i++) {
      const h = doc.columns[i].header
      text(cellX(i, h, 8, true), y - 8, 8, fit(h, colW[i] - 8, 8, true), true)
    }
    y -= 21
  }

  // ---- title block ----
  newPage()
  text(MARGIN, y - 16, 19, doc.title, true)
  y -= 24
  if (doc.subtitle) { text(MARGIN, y - 10, 10.5, doc.subtitle, false, true); y -= 16 }
  y -= 4
  for (const m of doc.meta) {
    text(MARGIN, y - 9, 9, m.label, false, true)
    text(MARGIN + 96, y - 9, 9, m.value, true)
    y -= 13
  }
  y -= 4
  rule(y); y -= 16

  if (doc.note) {
    for (const ln of wrap(doc.note, CONTENT_W, 9.5)) { text(MARGIN, y - 9, 9.5, ln); y -= 13 }
    y -= 6
    rule(y); y -= 16
  }

  // ---- the table ----
  let headerDrawn = false
  for (const sec of doc.sections) {
    // Never orphan a heading at the foot of a page — a unit name with no rows under it reads as an
    // empty unit, which on a furniture quote is a real misunderstanding.
    if (y < MARGIN + 90) { newPage(); headerDrawn = false }
    y -= 4
    text(MARGIN, y - 11, 11.5, sec.heading, true)
    if (sec.sub) text(MARGIN + widthOf(sec.heading, 11.5, true) + 10, y - 11, 9, sec.sub, false, true)
    y -= 18
    headerRow(); headerDrawn = true

    for (const row of sec.rows) {
      if (y < MARGIN + 40) { newPage(); headerRow() }
      for (let i = 0; i < doc.columns.length; i++) {
        const v = row[i] == null ? '' : String(row[i])
        if (!v) continue
        text(cellX(i, v, 9, false), y - 8, 9, fit(v, colW[i] - 8, 9), false)
      }
      y -= 14
      rule(y + 3, 0.4, 0.88)
    }
    if (sec.subtotal) {
      const s = sec.subtotal
      text(PAGE_W - MARGIN - widthOf(s, 9.5, true), y - 9, 9.5, s, true)
      y -= 16
    }
    y -= 6
  }
  if (!headerDrawn && !doc.sections.length) {
    text(MARGIN, y - 10, 10, 'No lines on this order yet.', false, true)
    y -= 18
  }

  // ---- totals ----
  if (y < MARGIN + 70) newPage()
  y -= 4
  rule(y, 1, 0.4); y -= 18
  for (const t of doc.totals) {
    const size = t.strong ? 12 : 9.5
    text(PAGE_W - MARGIN - 150, y - size, size, t.label, !!t.strong, !t.strong)
    text(PAGE_W - MARGIN - widthOf(t.value, size, !!t.strong), y - size, size, t.value, !!t.strong)
    y -= size + 7
  }

  if (doc.footer) {
    if (y < MARGIN + 40) newPage()
    y -= 10
    for (const ln of wrap(doc.footer, CONTENT_W, 8.5)) { text(MARGIN, y - 8, 8.5, ln, false, true); y -= 11 }
  }

  // ---- page numbers, once the count is known ----
  for (let i = 0; i < pages.length; i++) {
    const label = 'Page ' + (i + 1) + ' of ' + pages.length
    pages[i].ops.push(
      'BT 0.55 0.58 0.62 rg /F1 8 Tf 1 0 0 1 ' +
      (PAGE_W - MARGIN - widthOf(label, 8)).toFixed(1) + ' ' + (MARGIN - 18).toFixed(1) +
      ' Tm (' + esc(label) + ') Tj ET')
  }

  return assemble(pages)
}

/** Objects: 1 catalog, 2 pages, then per page a Page + a Contents stream, then the two fonts. */
function assemble(pages: Page[]): Buffer {
  const n = pages.length
  const fontA = 3 + n * 2, fontB = fontA + 1
  const objs: string[] = []
  const put = (i: number, body: string) => { objs[i - 1] = i + ' 0 obj\n' + body + '\nendobj\n' }

  const kids = pages.map((_, i) => (3 + i * 2) + ' 0 R').join(' ')
  put(1, '<< /Type /Catalog /Pages 2 0 R >>')
  put(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>')
  for (let i = 0; i < n; i++) {
    const pageObj = 3 + i * 2, contentObj = pageObj + 1
    put(pageObj,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
      '/Resources << /Font << /F1 ' + fontA + ' 0 R /F2 ' + fontB + ' 0 R >> >> ' +
      '/Contents ' + contentObj + ' 0 R >>')
    const stream = pages[i].ops.join('\n')
    put(contentObj, '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream')
  }
  put(fontA, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  put(fontB, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const o of objs) { offsets.push(Buffer.byteLength(out, 'latin1')); out += o }
  const xrefAt = Buffer.byteLength(out, 'latin1')
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n'
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF'
  return Buffer.from(out, 'latin1')
}
