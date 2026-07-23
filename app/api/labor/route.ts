// LABOR — Homebase timesheet CSV upload + KPIs joined against Breezeway completed work.
// POST { csv, filename } parses a Homebase-style export TOLERANTLY (header names vary by
// export version) and upserts one row per employee per day. GET ?from&to returns totals and
// a per-person table: hours, cost, cleans completed, hours/clean, cost/clean.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const CLEANISH = /departure clean|strip|walkthrough|deep clean/i
const DONE = /complete|finish|close|approv/i

// split a CSV line respecting double quotes
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map(x => x.trim())
}

function normDate(v: string): string | null {
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[1] + '-' + m[2] + '-' + m[3]
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') }
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}
function num(v: string): number | null {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({} as any))
    const csv = str(body.csv)
    const source = str(body.filename) || 'upload'
    if (!csv.trim()) return NextResponse.json({ ok: false, error: 'Empty file.' }, { status: 400 })
    const lines = csv.split(/\r?\n/).filter(l => l.trim())
    // find the header row: must mention a name-ish column AND a date or hours column
    let hi = -1, header: string[] = []
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const cols = splitCsv(lines[i]).map(c => c.toLowerCase())
      const hasName = cols.some(c => /employee|first name|last name|^name$|team member/.test(c))
      const hasData = cols.some(c => /date/.test(c)) || cols.some(c => /hour/.test(c))
      if (hasName && hasData) { hi = i; header = cols; break }
    }
    if (hi < 0) return NextResponse.json({ ok: false, error: 'Could not find a header row with employee + date/hours columns. Send me the file and I will adapt the parser.' }, { status: 400 })
    const idx = (re: RegExp) => header.findIndex(c => re.test(c))
    const iEmp = idx(/^employee$|employee name|team member|^name$/)
    const iFirst = idx(/first name/)
    const iLast = idx(/last name/)
    const iDate = idx(/^date$|work date|shift date|^day$/)
    const iHours = (() => { let k = idx(/total paid hours|paid hours|total hours/); if (k < 0) k = idx(/scheduled hours/); if (k < 0) k = idx(/^hours$|regular hours|^hrs/); return k })()
    const iWage = idx(/wage|^rate$|hourly rate|pay rate/)
    const iCost = idx(/total pay|total wages|labor cost|^wages$|est.*wages|gross pay/)
    if (iDate < 0 || (iEmp < 0 && iFirst < 0)) return NextResponse.json({ ok: false, error: 'Missing employee or date column. Header seen: ' + header.join(' | ').slice(0, 200) }, { status: 400 })
    // aggregate per employee+date (multiple shifts/day roll up)
    const agg: Record<string, { employee: string; work_date: string; hours: number; cost: number; wage: number | null }> = {}
    let parsed = 0
    for (let i = hi + 1; i < lines.length; i++) {
      const c = splitCsv(lines[i])
      if (c.length < 2) continue
      const emp = iEmp >= 0 ? c[iEmp] : [c[iFirst], iLast >= 0 ? c[iLast] : ''].filter(Boolean).join(' ').trim()
      const wd = iDate >= 0 ? normDate(str(c[iDate])) : null
      if (!emp || /total/i.test(emp) || !wd) continue
      const hours = iHours >= 0 ? (num(str(c[iHours])) || 0) : 0
      const wage = iWage >= 0 ? num(str(c[iWage])) : null
      let cost = iCost >= 0 ? (num(str(c[iCost])) || 0) : 0
      if (!cost && wage != null && hours) cost = Math.round(wage * hours * 100) / 100
      const k = emp.toLowerCase() + '|' + wd
      if (!agg[k]) agg[k] = { employee: emp, work_date: wd, hours: 0, cost: 0, wage }
      agg[k].hours += hours; agg[k].cost += cost
      if (wage != null) agg[k].wage = wage
      parsed++
    }
    const rows = Object.keys(agg).map(k => ({ ...agg[k], source }))
    if (!rows.length) return NextResponse.json({ ok: false, error: 'No usable rows found under the header.' }, { status: 400 })
    const db = supabaseAdmin()
    const { error } = await db.from('labor_timesheets').upsert(rows, { onConflict: 'employee,work_date,source' })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    const dates = rows.map(r => r.work_date).sort()
    return NextResponse.json({ ok: true, rows: rows.length, shifts: parsed, from: dates[0], to: dates[dates.length - 1] })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const db = supabaseAdmin()
    const today = ymd(new Date())
    const to = /^\d{4}-\d{2}-\d{2}$/.test(str(req.nextUrl.searchParams.get('to'))) ? str(req.nextUrl.searchParams.get('to')) : today
    const from = /^\d{4}-\d{2}-\d{2}$/.test(str(req.nextUrl.searchParams.get('from'))) ? str(req.nextUrl.searchParams.get('from')) : addDays(to, -13)
    const [tRes, bRes] = await Promise.all([
      db.from('labor_timesheets').select('employee,work_date,hours,wage,cost').neq('source', '__synthetic_test.csv').gte('work_date', from).lte('work_date', to).limit(5000),
      db.from('breezeway_tasks_sync').select('name,status,scheduled_date,finished_at,assignees,total_minutes').gte('scheduled_date', from).lte('scheduled_date', to).limit(8000),
    ])
    const sheets = (tRes.data || []) as any[]
    // cleans completed per person (first-name + last-initial matching, same as the roster matcher)
    const norm = (x: any) => { let s2 = String(x || '').toLowerCase(); let out = ''; for (let i = 0; i < s2.length; i++) { const ch = s2[i]; if ((ch >= 'a' && ch <= 'z') || ch === ' ') out += ch } return out.split(' ').filter(Boolean) }
    const keyOf = (name: string) => { const t = norm(name); return t.length ? t[0] + '|' + ((t[1] || '')[0] || '') : '' }
    const cleansBy: Record<string, { cleans: number; minutes: number }> = {}
    for (const t of (bRes.data || []) as any[]) {
      if (!CLEANISH.test(str(t.name))) continue
      if (!(DONE.test(str(t.status)) || t.finished_at)) continue
      const ppl = Array.isArray(t.assignees) ? t.assignees : []
      for (const p of ppl) {
        const k = keyOf(str(p && p.name))
        if (!k) continue
        if (!cleansBy[k]) cleansBy[k] = { cleans: 0, minutes: 0 }
        cleansBy[k].cleans += 1
        cleansBy[k].minutes += Number(t.total_minutes) || 0
      }
    }
    const perPerson: Record<string, { employee: string; hours: number; cost: number; days: Set<string> }> = {}
    for (const r of sheets) {
      const k = r.employee
      if (!perPerson[k]) perPerson[k] = { employee: r.employee, hours: 0, cost: 0, days: new Set() }
      perPerson[k].hours += Number(r.hours) || 0
      perPerson[k].cost += Number(r.cost) || 0
      perPerson[k].days.add(r.work_date)
    }
    const people = Object.keys(perPerson).map(k => {
      const p = perPerson[k]
      const c = cleansBy[keyOf(p.employee)] || { cleans: 0, minutes: 0 }
      return {
        employee: p.employee, hours: Math.round(p.hours * 10) / 10, cost: Math.round(p.cost * 100) / 100,
        days: p.days.size, cleans: c.cleans,
        hoursPerClean: c.cleans ? Math.round((p.hours / c.cleans) * 10) / 10 : null,
        costPerClean: c.cleans && p.cost ? Math.round((p.cost / c.cleans) * 100) / 100 : null,
      }
    }).sort((a, b) => b.hours - a.hours)
    const totals = {
      hours: Math.round(people.reduce((a, p) => a + p.hours, 0) * 10) / 10,
      cost: Math.round(people.reduce((a, p) => a + p.cost, 0) * 100) / 100,
      cleans: people.reduce((a, p) => a + p.cleans, 0),
      people: people.length,
    }
    return NextResponse.json({ ok: true, from, to, totals, people, hasData: sheets.length > 0 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
