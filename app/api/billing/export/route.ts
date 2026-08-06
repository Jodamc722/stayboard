// BILLING EXPORT. GET ?month=YYYY-MM&format=csv|xls[&owner=<ownerId>]
//   csv — flat file, one row per billable line (labor / cost / supply / extra), Excel-friendly.
//   xls — SpreadsheetML workbook (no dependency needed): a Summary sheet of owner totals plus
//         one worksheet per billing owner. Opens directly in Excel / Numbers / Sheets.
// Excluded tasks are omitted from per-owner sheets and amounts; they appear in the CSV with
// excluded=yes so nothing silently disappears from the record.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingMonth, type BillingTask } from '@/lib/billing'

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
      hours: hourly ? (t.billedHours != null ? t.billedHours.toFixed(2) : hrs(t.actualMinutes)) : hrs(t.actualMinutes),
      rate: t.ratePaid != null ? money(t.ratePaid) : '',
      amount: t.laborAmount,
    })
  }
  for (const it of t.items) {
    if (String(it.bill_to || 'owner') === 'guest') continue
    out.push({ ...base, kind: it.kind, description: it.description, hours: '', rate: '', amount: it.amount })
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

function cell(v: string, type: 'String' | 'Number' = 'String'): string {
  return `<Cell><Data ss:Type="${type}">${type === 'Number' ? v : xml(v)}</Data></Cell>`
}
function row(cells: string[]): string { return '<Row>' + cells.join('') + '</Row>' }
function sheetName(s: string, used: Record<string, boolean>): string {
  let n = s.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Owner'
  let k = n; let i = 2
  while (used[k]) { k = n.slice(0, 25) + ' ' + i; i++ }
  used[k] = true
  return k
}

function toXls(month: string, tasks: BillingTask[]): string {
  const live = tasks.filter(t => !t.excluded)
  const byOwner: Record<string, BillingTask[]> = {}
  for (const t of live) {
    const k = t.ownerName
    if (!byOwner[k]) byOwner[k] = []
    byOwner[k].push(t)
  }
  const ownerNames = Object.keys(byOwner).sort((a, b) => a.localeCompare(b))
  const used: Record<string, boolean> = {}
  const head = ['Unit', 'Date', 'Task', 'Department', 'Line type', 'Description', 'Hours', 'Rate', 'Amount', 'Assignee', 'Note']

  const summaryRows = [row([cell('Billing owner'), cell('Tasks'), cell('Actual hours'), cell('Billed')])]
  for (const o of ownerNames) {
    const ts = byOwner[o]
    const mins = ts.reduce((s, t) => s + (t.actualMinutes || 0), 0)
    const billed = ts.reduce((s, t) => s + t.billedAmount, 0)
    summaryRows.push(row([cell(o), cell(String(ts.length), 'Number'), cell(hrs(mins) || '0.00', 'Number'), cell(money(billed), 'Number')]))
  }
  const sheets: string[] = [
    `<Worksheet ss:Name="Summary ${xml(month)}"><Table>` + summaryRows.join('') + '</Table></Worksheet>',
  ]
  for (const o of ownerNames) {
    const ts = byOwner[o].slice().sort((a, b) => (a.unit + (a.scheduledDate || '')).localeCompare(b.unit + (b.scheduledDate || '')))
    const rows: string[] = [row(head.map(h => cell(h)))]
    let total = 0
    for (const t of ts) {
      for (const l of linesOf(t)) {
        total += l.amount
        rows.push(row([
          cell(l.unit), cell(l.date), cell(l.task), cell(l.dept), cell(l.kind), cell(l.description),
          cell(l.hours || '0', 'Number'), cell(l.rate || '0', 'Number'), cell(money(l.amount), 'Number'),
          cell(l.assignee), cell(l.note),
        ]))
      }
    }
    rows.push(row([cell('TOTAL'), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell(money(total), 'Number'), cell(''), cell('')]))
    sheets.push(`<Worksheet ss:Name="${xml(sheetName(o, used))}"><Table>` + rows.join('') + '</Table></Worksheet>')
  }
  return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    sheets.join('') + '</Workbook>'
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
    const scoped = ownerId ? tasks.filter(t => String(t.ownerId || '') === ownerId) : tasks
    if (format === 'xls') {
      const body = toXls(month, scoped)
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="billing-${month || 'month'}.xls"`,
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
