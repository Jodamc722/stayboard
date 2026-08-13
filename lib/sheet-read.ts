// READ A SPREADSHEET, WITH NO DEPENDENCY (Jon, 2026-08-13: "a place where we can upload a catalog").
//
// lib/xlsx-lite.ts writes workbooks; this reads them. Same reason for the hand-rolling — this repo
// ships through the GitHub web editor and cannot gain an npm dependency mid-flight — and the same
// realisation makes it tractable: an .xlsx is a ZIP of XML, and Node's zlib can already inflate,
// so the whole job is walking the ZIP central directory and pulling three parts out of the XML.
//
// WHY BOTHER WHEN CSV EXISTS. Because nobody has a CSV. They have the file the vendor emailed, and
// telling somebody to "just save it as CSV first" is where a feature quietly stops being used. This
// takes .xlsx, .csv and .tsv and returns the same shape for all three.
//
// WHAT IT DELIBERATELY DOES NOT DO: formulas (it reads the cached value, which is what a vendor
// quote has anyway), styles, dates as anything but their raw serial, merged cells, or multiple
// sheets — the first sheet is the sheet. A catalog import needs rows of text and numbers.
import 'server-only'
import { inflateRawSync } from 'zlib'

export type SheetRow = string[]

/** Column letters to a zero-based index: A -> 0, Z -> 25, AA -> 26. */
function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase())
  if (!m) return 0
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const unesc = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&')

/** Every file in a ZIP, by name. Handles stored (method 0) and deflated (method 8) entries. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {}
  // Find the end-of-central-directory record by scanning back from the tail.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localAt = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8')

    // The local header repeats the name and extra lengths, and they can differ from the central
    // ones — reading the central copy is the classic way to land in the middle of the data.
    const lNameLen = buf.readUInt16LE(localAt + 26)
    const lExtraLen = buf.readUInt16LE(localAt + 28)
    const dataAt = localAt + 30 + lNameLen + lExtraLen
    const raw = buf.slice(dataAt, dataAt + compSize)
    try {
      out[name] = method === 0 ? raw : inflateRawSync(raw)
    } catch { /* one unreadable part should not lose the workbook */ }
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function readXlsx(buf: Buffer): SheetRow[] {
  const files = unzip(buf)

  // Shared strings: xlsx stores most text once and references it by index.
  const shared: string[] = []
  const ss = files['xl/sharedStrings.xml']
  if (ss) {
    const xml = ss.toString('utf8')
    for (const si of xml.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || []) {
      // An <si> can hold one <t>, or several inside <r> runs for mixed formatting — join them.
      const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
      shared.push(parts.map(t => unesc(t.replace(/<t[^>]*>|<\/t>/g, ''))).join(''))
    }
  }

  // The first sheet, whatever it is called.
  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(files).find(n => /^xl\/worksheets\/.*\.xml$/.test(n))
  if (!sheetName) return []
  const xml = files[sheetName].toString('utf8')

  const rows: SheetRow[] = []
  for (const rowXml of xml.match(/<row[\s>][\s\S]*?<\/row>|<row[^>]*\/>/g) || []) {
    const cells: string[] = []
    for (const cell of rowXml.match(/<c[\s>][\s\S]*?<\/c>|<c[^>]*\/>/g) || []) {
      const refM = /r="([A-Z]+\d+)"/.exec(cell)
      const idx = refM ? colIndex(refM[1]) : cells.length
      const type = /t="([^"]+)"/.exec(cell)?.[1] || 'n'
      let value = ''
      if (type === 'inlineStr') {
        value = (cell.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
          .map(t => unesc(t.replace(/<t[^>]*>|<\/t>/g, ''))).join('')
      } else {
        const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1]
        if (v != null) value = type === 's' ? (shared[Number(v)] ?? '') : unesc(v)
      }
      while (cells.length < idx) cells.push('')
      cells[idx] = value
    }
    rows.push(cells)
  }
  return rows
}

/** CSV / TSV, quote-aware, tolerant of \r\n and embedded newlines inside quotes. */
export function readDelimited(text: string): SheetRow[] {
  const t = text.replace(/^﻿/, '')
  // Whichever of tab or comma appears more in the first line is the delimiter.
  const first = t.split(/\r?\n/, 1)[0] || ''
  const delim = (first.split('\t').length > first.split(',').length) ? '\t' : ','

  const rows: SheetRow[] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delim) { row.push(cur); cur = ''; continue }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue }
    if (ch === '\r') continue
    cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

/** One entry point for whatever they uploaded. Empty trailing rows are dropped. */
export function readSheet(buf: Buffer, filename: string): SheetRow[] {
  const name = String(filename || '').toLowerCase()
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b
  const rows = (isZip || /\.xlsx?$/.test(name))
    ? readXlsx(buf)
    : readDelimited(buf.toString('utf8'))
  return rows.filter(r => r.some(c => String(c || '').trim() !== ''))
}

// ── MAPPING A SHEET TO PRODUCTS ─────────────────────────────────────────────────────────────────
// Nobody's spreadsheet has our column names. Rather than demanding a template — which is how an
// import becomes a support ticket — this recognises the headers people actually use, and falls back
// to the same shape-based guessing the paste box uses when there is no header row at all.
export type SheetColumnMap = {
  name?: number; code?: number; category?: number; tier?: number; kind?: number
  vendor?: number; sku?: number; price?: number; url?: number; image?: number
  spec?: number; room?: number; notes?: number; qty?: number
}

// Spanish alternates are in here for the same reason the walk form is bilingual — half the team
// works in Spanish, and a sheet built by the person doing the buying should import as cleanly as
// one built by the person doing the approving.
const HEADERS: { key: keyof SheetColumnMap; re: RegExp }[] = [
  { key: 'name', re: /^(item|product|name|description|desc|title|art[ií]culo|producto|nombre|descripci[oó]n)/i },
  { key: 'code', re: /^(code|item ?#|item no|our sku|internal|c[oó]digo)/i },
  { key: 'category', re: /^(category|type|group|categor[ií]a|tipo)/i },
  { key: 'tier', re: /^(tier|level|grade|package)/i },
  { key: 'kind', re: /^(kind|class|department)/i },
  // The lookahead matters: a sheet with both "Vendor" and "Vendor SKU" is the normal case, and
  // without it the first column wins and the real vendor column is never read.
  { key: 'vendor', re: /^(vendor|supplier|store|source|brand|merchant|proveedor|tienda)(?!\s*[-_ ]*(sku|#|no\b|num|item|part|code|model|id\b|c[oó]digo))/i },
  { key: 'sku', re: /^(sku|model|part|mpn|asin|upc|item ?code|vendor ?[-_ ]?sku|supplier ?[-_ ]?(sku|code)|modelo)/i },
  { key: 'price', re: /^(price|cost|unit ?cost|each|amount|precio|costo|\$)/i },
  { key: 'url', re: /^(url|link|product ?link|web|enlace|liga)/i },
  { key: 'image', re: /^(image|photo|picture|img|foto|imagen)/i },
  { key: 'spec', re: /^(size|spec|dimension|finish|colou?r|tama[nñ]o|medida|color|acabado)/i },
  { key: 'room', re: /^(room|area|location|place|habitaci[oó]n|cuarto|lugar|ubicaci[oó]n)/i },
  { key: 'qty', re: /^(qty|quantity|number|count|cant|cantidad)/i },
  { key: 'notes', re: /^(note|comment|remark|nota|comentario)/i },
]

/** Does the first row look like headers rather than data? */
export function detectHeader(rows: SheetRow[]): SheetColumnMap | null {
  if (!rows.length) return null
  const head = rows[0].map(c => String(c || '').trim())
  const map: SheetColumnMap = {}
  let hits = 0
  for (let i = 0; i < head.length; i++) {
    for (const h of HEADERS) {
      if (map[h.key] == null && h.re.test(head[i])) { map[h.key] = i; hits++; break }
    }
  }
  // Two recognised headers is enough to trust the row; one could be a coincidence in real data.
  return hits >= 2 ? map : null
}
