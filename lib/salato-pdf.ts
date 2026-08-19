// Dependency-free PDF builder for the Salato verification record.
//
// WHY HAND-ROLLED. The app can't take a new npm dependency in this workflow (direct git push is
// blocked, so we ship through the web editor and can't update the lockfile). A verification record
// is simple — a page of text plus a few JPEG photos — so we emit a minimal, valid PDF by hand:
// Helvetica text (WinAnsi) and JPEG images embedded directly via /DCTDecode (no re-encoding).
// Every image passed in MUST be a JPEG buffer.
import 'server-only'

export type PdfDetail = { label: string; value: string }
export type PdfRule = { n: number; title: string; initials: string; body?: string }
export type PdfImage = { caption: string; jpeg: Buffer }
export type PdfInput = {
  title: string
  subtitle?: string
  details: PdfDetail[]
  rulesVersion?: number
  rules: PdfRule[]
  images: PdfImage[]
}

// Helvetica has no glyphs for smart punctuation / emoji; fold the common ones to ASCII so the text
// renders instead of dropping to blanks, then hard-strip anything still outside Latin-1.
function toLatin1(s: string): string {
  return String(s == null ? '' : s)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[✅✓✔]/g, '(check)')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}
function esc(s: string): string { return toLatin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }

// Wrap to ~maxChars per line (Helvetica avg ~0.5em; good enough for a record sheet).
function wrap(s: string, maxChars: number): string[] {
  const words = toLatin1(s).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!cur) { cur = w }
    else if ((cur + ' ' + w).length <= maxChars) { cur += ' ' + w }
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

// Read pixel size + component count (1=gray, 3=rgb) from a JPEG's SOF marker.
function jpegInfo(buf: Buffer): { w: number; h: number; comps: number } {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue }
    const marker = buf[i + 1]
    // SOF0..SOF15 carry the frame header, except the non-SOF markers in that range.
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      const h = buf.readUInt16BE(i + 5)
      const w = buf.readUInt16BE(i + 7)
      const comps = buf[i + 9]
      return { w, h, comps }
    }
    if (buf[i + 1] === 0xD8 || buf[i + 1] === 0xD9) { i += 2; continue }
    const len = buf.readUInt16BE(i + 2)
    i += 2 + len
  }
  return { w: 0, h: 0, comps: 3 }
}

const PAGE_W = 612, PAGE_H = 792, MARGIN = 54
const CONTENT_W = PAGE_W - MARGIN * 2

export function buildVerifyPdf(input: PdfInput): Buffer {
  // ---- Compose page content streams (text) + collect image placements ----
  type ImgPlace = { objName: string; x: number; y: number; w: number; h: number; caption: string }
  const pages: { text: string; images: ImgPlace[] }[] = []
  const validImages = (input.images || []).map((im, idx) => {
    const info = jpegInfo(im.jpeg)
    return { ...im, idx, ...info }
  }).filter(im => im.w > 0 && im.h > 0)

  let text = ''
  let y = PAGE_H - MARGIN
  const imagesThisPage: ImgPlace[] = []
  const LH = 14
  const newPage = () => { pages.push({ text, images: imagesThisPage.slice() }); text = ''; imagesThisPage.length = 0; y = PAGE_H - MARGIN }
  const ensure = (need: number) => { if (y - need < MARGIN) newPage() }
  const line = (s: string, opts?: { font?: string; size?: number; gap?: number }) => {
    const font = (opts && opts.font) || 'F1'
    const size = (opts && opts.size) || 10
    ensure(LH)
    text += `BT /${font} ${size} Tf ${MARGIN} ${(y - size).toFixed(1)} Td (${esc(s)}) Tj ET\n`
    y -= (opts && opts.gap != null) ? opts.gap : LH
  }
  const para = (s: string, size: number, font: string) => { const ls = wrap(s, Math.floor(CONTENT_W / (size * 0.5))); for (let i = 0; i < ls.length; i++) line(ls[i], { font, size }) }

  // Header
  line(input.title, { font: 'F2', size: 18, gap: 24 })
  if (input.subtitle) line(input.subtitle, { font: 'F1', size: 10, gap: 20 })
  // Details
  for (let i = 0; i < input.details.length; i++) {
    const d = input.details[i]
    para((d.label + ': ' + d.value), 11, 'F1')
  }
  y -= 8
  line('House & building rules' + (input.rulesVersion ? ' (v' + input.rulesVersion + ')' : '') + ' - initialed by guest', { font: 'F2', size: 12, gap: 18 })
  for (let i = 0; i < input.rules.length; i++) {
    const r = input.rules[i]
    line(r.n + '. ' + r.title + '   [initials: ' + r.initials + ']', { font: 'F2', size: 10 })
    if (r.body) {
      // Body holds newline-separated bullet lines — render each as its own "- " bullet (hyphen is
      // WinAnsi-safe; a raw • may not encode in the base-14 Helvetica font).
      const bl = String(r.body).split('\n').map(s => s.trim()).filter(Boolean)
      for (let b = 0; b < bl.length; b++) para('- ' + bl[b], 9, 'F1')
      y -= 4
    }
  }

  // Images — each captioned, fitted to the content box, on the current/next page.
  for (let k = 0; k < validImages.length; k++) {
    const im = validImages[k]
    const objName = 'Im' + im.idx
    const maxW = CONTENT_W
    const maxH = 360
    const scale = Math.min(maxW / im.w, maxH / im.h, 1)
    const dw = Math.round(im.w * scale), dh = Math.round(im.h * scale)
    ensure(dh + 22)
    line(im.caption, { font: 'F2', size: 10, gap: 6 })
    const iy = y - dh
    imagesThisPage.push({ objName, x: MARGIN, y: iy, w: dw, h: dh, caption: im.caption })
    y = iy - 14
  }
  newPage() // flush last

  // ---- Assemble objects ----
  const chunks: Buffer[] = []
  let offset = 0
  const offsets: number[] = []
  const push = (s: string | Buffer) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'); chunks.push(b); offset += b.length }

  // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then images, then per page (content, page).
  const nImg = validImages.length
  const imgBase = 5
  const pageBase = imgBase + nImg
  const pageObjNums: number[] = []
  for (let p = 0; p < pages.length; p++) pageObjNums.push(pageBase + p * 2 + 1) // page object numbers
  const totalObjs = 4 + nImg + pages.length * 2

  const startObj = (n: number) => { offsets[n] = offset; push(n + ' 0 obj\n') }
  const endObj = () => push('endobj\n')

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')

  // 1 catalog
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj()
  // 2 pages
  startObj(2); push('<< /Type /Pages /Kids [' + pageObjNums.map(n => n + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>\n'); endObj()
  // 3 F1, 4 F2
  startObj(3); push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n'); endObj()
  startObj(4); push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n'); endObj()
  // images
  for (let k = 0; k < nImg; k++) {
    const im = validImages[k]
    const n = imgBase + k
    const cs = im.comps === 1 ? '/DeviceGray' : '/DeviceRGB'
    startObj(n)
    push('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.jpeg.length + ' >>\nstream\n')
    push(im.jpeg)
    push('\nendstream\n')
    endObj()
  }
  // pages: content + page objects
  for (let p = 0; p < pages.length; p++) {
    const contentNum = pageBase + p * 2
    const pageNum = pageBase + p * 2 + 1
    let body = pages[p].text
    for (const ip of pages[p].images) {
      body += 'q ' + ip.w + ' 0 0 ' + ip.h + ' ' + ip.x + ' ' + ip.y.toFixed(1) + ' cm /' + ip.objName + ' Do Q\n'
    }
    const bodyBuf = Buffer.from(body, 'latin1')
    startObj(contentNum)
    push('<< /Length ' + bodyBuf.length + ' >>\nstream\n'); push(bodyBuf); push('\nendstream\n')
    endObj()
    // page uses only the images placed on it
    const xobjs = pages[p].images.map(ip => '/' + ip.objName + ' ' + (imgBase + validImages.findIndex(v => ('Im' + v.idx) === ip.objName)) + ' 0 R').join(' ')
    startObj(pageNum)
    push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] '
      + '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> ' + (xobjs ? '/XObject << ' + xobjs + ' >> ' : '') + '>> '
      + '/Contents ' + contentNum + ' 0 R >>\n')
    endObj()
  }

  // xref
  const xrefStart = offset
  push('xref\n0 ' + (totalObjs + 1) + '\n')
  push('0000000000 65535 f \n')
  for (let n = 1; n <= totalObjs; n++) {
    const off = offsets[n] || 0
    push(String(off).padStart(10, '0') + ' 00000 n \n')
  }
  push('trailer\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n')

  return Buffer.concat(chunks)
}
