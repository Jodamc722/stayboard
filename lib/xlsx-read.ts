// A SPREADSHEET READER SMALL ENOUGH TO OWN (2026-10-27). The writer is lib/xlsx-lite.
//
// Jon asked for the sales deck's projection slide to take "a projections PDF or any file type",
// and a spreadsheet is the file most projections actually live in. We ship no spreadsheet library
// (dependencies: @supabase, @vercel, jspdf, lucide, mammoth, next, react, sharp), and adding one
// to read a handful of cells is a poor trade — so this reads the parts of .xlsx we need and
// nothing else.
//
// An .xlsx is a ZIP of XML (lib/xlsx-lite writes one by hand for the same reason). This walks the ZIP's central directory, inflates the two entries that
// matter (the shared string table and the first worksheet), and turns the sheet into rows of
// strings with the blanks kept in place, so column alignment survives. Formatting, formulas,
// merged cells, dates-as-serial-numbers and every other thing a spreadsheet can do are ignored:
// what comes out is the grid as text, which is exactly what the model reading it needs.
//
// It returns null rather than throwing on anything it does not understand, because the caller's
// job is to say "export it as CSV or PDF" and carry on, never to fail a request.
import { inflateRawSync } from 'zlib'

type Entry = { name: string; method: number; size: number; at: number }

/** The ZIP central directory, read back to front from the end-of-central-directory record. */
function entries(buf: Buffer): Entry[] | null {
  // The EOCD is at most 22 bytes plus a comment of up to 64KB.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  if (at >= buf.length) return null // zip64, or a file we should not be guessing at
  const out: Entry[] = []
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 24)
    const nLen = buf.readUInt16LE(at + 28)
    const eLen = buf.readUInt16LE(at + 30)
    const cLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    out.push({ name: buf.toString('utf8', at + 46, at + 46 + nLen), method, size, at: local })
    at += 46 + nLen + eLen + cLen
  }
  return out
}

function read(buf: Buffer, e: Entry): string | null {
  try {
    if (e.at + 30 > buf.length || buf.readUInt32LE(e.at) !== 0x04034b50) return null
    const nLen = buf.readUInt16LE(e.at + 26)
    const eLen = buf.readUInt16LE(e.at + 28)
    const start = e.at + 30 + nLen + eLen
    // The central directory's compressed size is the one we trust; the local header may carry
    // zeros when the writer streamed the entry.
    const end = buf.length
    const raw = buf.subarray(start, end)
    if (e.method === 0) return raw.subarray(0, e.size).toString('utf8')
    if (e.method === 8) return inflateRawSync(raw).toString('utf8')
    return null
  } catch { return null }
}

const unesc = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&')

/** "BC12" -> 54. Column letters are base-26 with no zero. */
function colOf(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref || '')
  if (!m) return 0
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * The first worksheet as rows of strings, blanks kept so columns line up.
 * Returns null for anything that is not a readable .xlsx.
 */
export function xlsxRows(buf: Buffer, maxRows = 200, maxCols = 40): string[][] | null {
  const list = entries(buf)
  if (!list) return null
  const sheetEntry = list.find(e => /^xl\/worksheets\/sheet1\.xml$/i.test(e.name))
    || list.find(e => /^xl\/worksheets\/.+\.xml$/i.test(e.name))
  if (!sheetEntry) return null
  const sheet = read(buf, sheetEntry)
  if (!sheet) return null

  const shared: string[] = []
  const ssEntry = list.find(e => /^xl\/sharedStrings\.xml$/i.test(e.name))
  if (ssEntry) {
    const ss = read(buf, ssEntry) || ''
    for (const si of ss.match(/<si\b[\s\S]*?<\/si>/g) || []) {
      // A string split across formatting runs arrives as several <t>; it is one value.
      const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
      shared.push(unesc(parts.map(p => p.replace(/<t[^>]*>|<\/t>/g, '')).join('')))
    }
  }

  const rows: string[][] = []
  for (const rowXml of sheet.match(/<row\b[\s\S]*?(?:\/>|<\/row>)/g) || []) {
    const cells: string[] = []
    for (const cXml of rowXml.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || []) {
      const ref = (/\sr="([A-Z]+\d+)"/.exec(cXml) || [])[1] || ''
      const type = (/\st="([^"]+)"/.exec(cXml) || [])[1] || ''
      let v = ''
      if (type === 'inlineStr') {
        v = unesc((cXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(p => p.replace(/<t[^>]*>|<\/t>/g, '')).join(''))
      } else {
        const raw = (/<v[^>]*>([\s\S]*?)<\/v>/.exec(cXml) || [])[1]
        if (raw != null) v = type === 's' ? (shared[Number(raw)] ?? '') : unesc(raw)
      }
      const at = ref ? colOf(ref) : cells.length
      while (cells.length < at) cells.push('')
      if (at < maxCols) cells[at] = v
    }
    rows.push(cells)
    if (rows.length >= maxRows) break
  }
  // A sheet of nothing is not a projection.
  return rows.some(r => r.some(c => String(c).trim())) ? rows : null
}

/** The grid as CSV, which is the shape the model reads best. */
export function xlsxCsv(buf: Buffer, maxRows = 200, maxCols = 40): string | null {
  const rows = xlsxRows(buf, maxRows, maxCols)
  if (!rows) return null
  return rows.map(r => r.map(c => {
    const v = String(c == null ? '' : c)
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
  }).join(',')).join('\n')
}
