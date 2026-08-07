// BILLING EXPORT. GET ?month=YYYY-MM&format=csv|xls[&owner=<ownerId>]
//   csv — flat file, one row per billable line (labor / cost / supply / extra), Excel-friendly.
//   xls — SpreadsheetML workbook (no dependency needed): a Summary sheet of owner totals plus
//         one worksheet per billing owner. Opens directly in Excel / Numbers / Sheets.
// Excluded tasks are omitted from per-owner sheets and amounts; they appear in the CSV with
// excluded=yes so nothing silently disappears from the record.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth, type BillingTask } from '@/lib/billing'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const hrs = (min: number | null) => min == null ? '' : (Math.round((min / 60) * 100) / 100).toFixed(2)
const esc = (s: any) => {
  const v = String(s == null ? '' : s)
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}
const xml = (s: any) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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

function cell(v: string, type: 'String' | 'Number' = 'String', styleId?: string): string {
  const st = styleId ? ` ss:StyleID="${styleId}"` : ''
  return `<Cell${st}><Data ss:Type="${type}">${type === 'Number' ? v : xml(v)}</Data></Cell>`
}
function row(cells: string[]): string { return '<Row>' + cells.join('') + '</Row>' }
// Basic look for the owner-statement attachment: bold title/headers, currency columns, real column
// widths — so the sheet drops straight into an owner statement without cleanup.
const XLS_STYLES =
  '<Styles>' +
  '<Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/></Style>' +
  '<Style ss:ID="sub"><Font ss:Color="#666666"/></Style>' +
  '<Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#EEEFF3" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>' +
  '<Style ss:ID="cur"><NumberFormat ss:Format="&quot;$&quot;#,##0.00"/></Style>' +
  '<Style ss:ID="num"><NumberFormat ss:Format="0.00"/></Style>' +
  '<Style ss:ID="tot"><Font ss:Bold="1"/><NumberFormat ss:Format="&quot;$&quot;#,##0.00"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders></Style>' +
  '<Style ss:ID="totlbl"><Font ss:Bold="1"/><Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders></Style>' +
  '</Styles>'
const OWNER_COLS = '<Column ss:Width="62"/><Column ss:Width="130"/><Column ss:Width="230"/><Column ss:Width="80"/><Column ss:Width="46"/><Column ss:Width="52"/><Column ss:Width="70"/><Column ss:Width="150"/>'
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

// One clean, statement-ready sheet per owner: title block, Date/Unit/Service columns, currency
// formatting, grand total. Only lines with money on them — a $0 clean has no place on an owner
// statement attachment.
function ownerSheet(month: string, ownerName: string, ts: BillingTask[], used: Record<string, boolean>, chargeRate: number): string {
  const billable = ts.filter(t => t.billedAmount > 0)
    .sort((a, b) => (a.unit + (a.scheduledDate || '')).localeCompare(b.unit + (b.scheduledDate || '')))
  const rows: string[] = []
  rows.push(row([cell('Stay Hospitality — Billable Services', 'String', 'title')]))
  rows.push(row([cell(ownerName, 'String', 'sub')]))
  rows.push(row([cell('Period: ' + monthLabel(month), 'String', 'sub')]))
  rows.push('<Row/>')
  rows.push(row(['Date', 'Unit', 'Service', 'Type', 'Hours', 'Rate', 'Amount', 'Note'].map(h => cell(h, 'String', 'hdr'))))
  let total = 0
  for (const t of billable) {
    for (const l of linesOf(t)) {
      if (l.amount <= 0) continue
      total += l.amount
      const service = l.kind === 'labor' || l.kind === 'override' ? l.task : l.task + ' — ' + l.description
      // The team enters FLAT AMOUNTS in Breezeway; billing reads them as labor at the charge
      // rate — hours = amount ÷ rate, regardless of the task clock. Supplies stay hourless.
      const isLabor = l.kind !== 'supply'
      const h = isLabor
        ? (t.billedHours != null && (l.kind === 'labor' || l.kind === 'override') ? t.billedHours.toFixed(2) : (l.amount / chargeRate).toFixed(2))
        : ''
      rows.push(row([
        cell(l.date), cell(l.unit), cell(service), cell(l.kind === 'supply' ? 'supply' : 'labor'),
        cell(h, h ? 'Number' : 'String', h ? 'num' : undefined),
        cell(h ? chargeRate.toFixed(2) : '', h ? 'Number' : 'String', h ? 'cur' : undefined),
        cell(money(l.amount), 'Number', 'cur'),
        cell(l.note),
      ]))
    }
  }
  rows.push(row([
    cell('TOTAL', 'String', 'totlbl'), cell('', 'String', 'totlbl'), cell('', 'String', 'totlbl'), cell('', 'String', 'totlbl'),
    cell('', 'String', 'totlbl'), cell('', 'String', 'totlbl'), cell(money(total), 'Number', 'tot'), cell('', 'String', 'totlbl'),
  ]))
  return `<Worksheet ss:Name="${xml(sheetName(ownerName, used))}"><Table>` + OWNER_COLS + rows.join('') + '</Table></Worksheet>'
}

function toXls(month: string, tasks: BillingTask[], chargeRate: number): string {
  const live = tasks.filter(t => !t.excluded)
  const byOwner: Record<string, BillingTask[]> = {}
  for (const t of live) {
    const k = t.ownerName
    if (!byOwner[k]) byOwner[k] = []
    byOwner[k].push(t)
  }
  const ownerNames = Object.keys(byOwner).sort((a, b) => a.localeCompare(b))
  const used: Record<string, boolean> = {}

  const sheets: string[] = []
  if (ownerNames.length > 1) {
    const summaryRows: string[] = []
    summaryRows.push(row([cell('Billable Services — ' + monthLabel(month), 'String', 'title')]))
    summaryRows.push('<Row/>')
    summaryRows.push(row([cell('Billing owner', 'String', 'hdr'), cell('Tasks', 'String', 'hdr'), cell('Hours', 'String', 'hdr'), cell('Billed', 'String', 'hdr')]))
    let grand = 0
    for (const o of ownerNames) {
      const ts = byOwner[o]
      const mins = ts.reduce((s, t) => s + (t.actualMinutes || 0), 0)
      const billed = ts.reduce((s, t) => s + t.billedAmount, 0)
      grand += billed
      summaryRows.push(row([cell(o), cell(String(ts.length), 'Number'), cell(hrs(mins) || '0.00', 'Number', 'num'), cell(money(billed), 'Number', 'cur')]))
    }
    summaryRows.push(row([cell('TOTAL', 'String', 'totlbl'), cell('', 'String', 'totlbl'), cell('', 'String', 'totlbl'), cell(money(grand), 'Number', 'tot')]))
    sheets.push('<Worksheet ss:Name="Summary"><Table><Column ss:Width="220"/><Column ss:Width="50"/><Column ss:Width="60"/><Column ss:Width="80"/>' + summaryRows.join('') + '</Table></Worksheet>')
  }
  for (const o of ownerNames) sheets.push(ownerSheet(month, o, byOwner[o], used, chargeRate))
  return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    XLS_STYLES + sheets.join('') + '</Workbook>'
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const month = String(sp.get('month') || '').slice(0, 7)
  const format = String(sp.get('format') || 'csv')
  const ownerId = String(sp.get('owner') || '')
  try {
    const { tasks } = await billingMonth(month)
    // done=1 → completed work only (matches the board's "Completed only" default — you bill finished work).
    const doneOnly = sp.get('done') === '1'
    let scoped = ownerId ? tasks.filter(t => String(t.ownerId || '') === ownerId) : tasks
    if (doneOnly) scoped = scoped.filter(t => /complet|close|approv|finish/.test(t.status) || t.finishedAt)
    if (format === 'xls') {
      const def = await getSetting<{ rate: number }>('billing_default_rate', { rate: 40 })
      const chargeRate = Number(def?.rate) > 0 ? Number(def.rate) : 40
      const body = toXls(month, scoped, chargeRate)
      // Per-owner downloads carry the owner's name so the file drops into their statement folder.
      const ownerName = ownerId && scoped[0] ? String(scoped[0].ownerName || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) : ''
      const fname = ownerName ? `billable-${ownerName}-${month || 'month'}.xls` : `billing-${month || 'month'}.xls`
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
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
