// BILLING EXPORT. GET ?month=YYYY-MM&format=csv|xls|zip[&owner=<ownerId>][&done=1][&reviewed=1]
//   csv — flat file, one row per billable line.
//   xls — a REAL .xlsx workbook (Office Open XML, built with the in-file ZIP writer — no
//         dependency): Summary sheet + one styled worksheet per owner. Replaces the old
//         SpreadsheetML output, which Excel opened reluctantly and rendered poorly.
//   zip — one standalone .xlsx per owner, named "<Owner> - Billable Labor - <Month>.xlsx",
//         for dropping straight into each owner's statement. $0 owners are skipped.
// done=1 → completed work only (matches the board default). reviewed=1 → only owners marked
// reviewed for the month (the close-out set).
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth, billingRange, type BillingTask } from '@/lib/billing'
import { getSetting } from '@/lib/app-settings'

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
    out.push({ ...base, kind: it.kind, description: desc, hours: '', rate: '', amount: it.amount })
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
type XSheet = { name: string; widths: number[]; rows: XCell[][]; links?: { ref: string; url: string }[] }

function colRef(i: number): string {
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

function makeXlsx(sheets: XSheet[]): Buffer {
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

// ── The owner sheet content: clean, statement-ready ─────────────────────────
// Every INDIVIDUAL task line: what was done, when it was completed, by whom, the labor math,
// and a clickable Breezeway link straight to the task (Jon 2026-08-07).
const OWNER_WIDTHS = [11, 20, 42, 13, 18, 12, 7, 9, 11, 10]
const LINK_COL = 9   // column J

function ownerSheetData(month: string, ownerName: string, ts: BillingTask[], chargeRate: number, used: Record<string, boolean>): XSheet {
  const billable = ts.filter(t => t.billedAmount > 0)
    .sort((a, b) => (a.unit + (a.scheduledDate || '')).localeCompare(b.unit + (b.scheduledDate || '')))
  const rows: XCell[][] = []
  const links: { ref: string; url: string }[] = []
  rows.push([{ v: 'Stay Hospitality — Billable Services', s: 2 }])
  rows.push([{ v: ownerName, s: 1 }])
  rows.push([{ v: 'Period: ' + monthLabel(month), s: 8 }])
  rows.push([])
  rows.push(['Date', 'Unit', 'Service', 'Type', 'Completed by', 'Completed', 'Hours', 'Rate', 'Amount', 'Task'].map(h => ({ v: h, s: 3 })))
  let total = 0
  for (const t of billable) {
    for (const l of linesOf(t)) {
      if (l.amount <= 0) continue
      total += l.amount
      let service = l.kind === 'labor' || l.kind === 'override' ? l.task : l.task + ' — ' + l.description
      if (l.note) service += ' (' + l.note + ')'
      const dept = String(t.department || 'labor')
      const typeLabel = l.kind === 'supply' ? 'Supply' : (dept.charAt(0).toUpperCase() + dept.slice(1))
      const isLabor = l.kind !== 'supply'
      const h = isLabor
        ? (t.billedHours != null && (l.kind === 'labor' || l.kind === 'override') ? t.billedHours.toFixed(2) : (l.amount / chargeRate).toFixed(2))
        : ''
      const by = t.finishedBy || l.assignee || ''
      const doneOn = t.finishedAt ? String(t.finishedAt).slice(0, 10) : ''
      rows.push([
        { v: l.date }, { v: l.unit }, { v: service }, { v: typeLabel },
        { v: by }, { v: doneOn },
        h ? { v: h, s: 5, num: true } : { v: '' },
        h ? { v: chargeRate.toFixed(2), s: 4, num: true } : { v: '' },
        { v: money(l.amount), s: 4, num: true },
        { v: 'View task', s: 9 },
      ])
      links.push({ ref: colRef(LINK_COL) + String(rows.length), url: 'https://app.breezeway.io/task/' + t.id })
    }
  }
  rows.push([
    { v: 'TOTAL', s: 7 }, { v: '', s: 7 }, { v: '', s: 7 }, { v: '', s: 7 }, { v: '', s: 7 },
    { v: '', s: 7 }, { v: '', s: 7 }, { v: '', s: 7 }, { v: money(total), s: 6, num: true }, { v: '', s: 7 },
  ])
  return { name: sheetName(ownerName, used), widths: OWNER_WIDTHS, rows, links }
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
    rows.push([{ v: 'Billable Services — ' + monthLabel(month), s: 2 }])
    rows.push([])
    rows.push(['Billing owner', 'Tasks', 'Hours', 'In-house labor', 'Vendor labor', 'Billed'].map(h => ({ v: h, s: 3 })))
    let grand = 0, grandIn = 0, grandVen = 0
    for (const o of ownerNames) {
      const ts = byOwner[o]
      const mins = ts.reduce((s, t) => s + (t.actualMinutes || 0), 0)
      const billed = ts.reduce((s, t) => s + t.billedAmount, 0)
      const laborIn = ts.reduce((s, t) => s + (!t.excluded && t.crew === 'inhouse' ? t.laborAmount : 0), 0)
      const laborVen = ts.reduce((s, t) => s + (!t.excluded && t.crew === 'vendor' ? t.laborAmount : 0), 0)
      grand += billed; grandIn += laborIn; grandVen += laborVen
      rows.push([{ v: o }, { v: String(ts.length), num: true }, { v: hrs(mins) || '0.00', s: 5, num: true }, { v: money(laborIn), s: 4, num: true }, { v: money(laborVen), s: 4, num: true }, { v: money(billed), s: 4, num: true }])
    }
    rows.push([{ v: 'TOTAL', s: 7 }, { v: '', s: 7 }, { v: '', s: 7 }, { v: money(grandIn), s: 6, num: true }, { v: money(grandVen), s: 6, num: true }, { v: money(grand), s: 6, num: true }])
    used['Summary'] = true
    sheets.push({ name: 'Summary', widths: [34, 8, 10, 14, 14, 14], rows })
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
      const reviews = await getSetting<Record<string, any>>('billing_review:' + month, {})
      scoped = scoped.filter(t => !!reviews[String(t.ownerId || 'unassigned')])
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
