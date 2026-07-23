// All OPEN, NON-CLEAN work for a single unit — so if someone is already going to the unit today,
// you can batch every outstanding maintenance / inspection / QC / audit item into the same visit.
// Deliberately EXCLUDES departure cleans and strips (those are auto-scheduled; showing them is noise).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
const DONE = /complete|finish|cancel|closed/i
// clean activities we DO NOT want in this panel
const CLEAN = /departure clean|turnover clean|strip|walkthrough|deep clean/i
function typeOf(name: string, dept: string) {
  const s = name.toLowerCase()
  if (/field reported/.test(s)) return 'Field-reported'
  if (/preventative|preventive|\bpm\b/.test(s)) return 'PM'
  if (/pool|pest/.test(s)) return 'Pool / Pest'
  if (/audit/.test(s)) return 'Audit'
  if (/unit check|inspect/.test(s)) return 'Inspection'
  if (dept === 'maintenance') return 'Maintenance'
  if (dept === 'inspection') return 'Inspection'
  return 'Task'
}
function deptOf(v: any) { const s = str(v).toLowerCase(); if (/maint/.test(s)) return 'maintenance'; if (/inspect/.test(s)) return 'inspection'; if (/housekeep|clean/.test(s)) return 'housekeeping'; return s || 'other' }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const listingId = String(new URL(req.url).searchParams.get('listingId') || '').trim()
  if (!listingId) return NextResponse.json({ ok: false, error: 'listingId required' }, { status: 400 })
  const db = supabaseAdmin()
  const today = ymd(new Date())
  const from = addDays(today, -14)
  const to = addDays(today, 60)

  // 1) open, non-clean Breezeway tasks for the unit (assignable + reschedulable)
  const open: any[] = []
  try {
    const { data } = await db.from('breezeway_tasks_sync')
      .select('id,name,status,scheduled_date,assignees,type_department,report_url')
      .eq('reference_property_id', listingId).gte('scheduled_date', from).lte('scheduled_date', to).limit(400)
    for (const t of (data || []) as any[]) {
      const name = str(t.name)
      if (DONE.test(str(t.status))) continue
      if (CLEAN.test(name)) continue
      const dept = deptOf(t.type_department)
      const ppl = Array.isArray(t.assignees) ? t.assignees : []
      open.push({
        id: String(t.id), source: 'breezeway', title: name || 'Task', type: typeOf(name, dept), dept,
        status: str(t.status).toLowerCase(), scheduledDate: str(t.scheduled_date).slice(0, 10),
        onToday: str(t.scheduled_date).slice(0, 10) === today,
        assignees: ppl.map((p: any) => p && p.name).filter(Boolean), reportUrl: t.report_url || null,
      })
    }
  } catch (e) { console.error('unit-items tasks', e) }

  // 2) open QC issues
  const qc: any[] = []
  try {
    const { data } = await db.from('qc_tasks').select('issue_type,status,breezeway_task_id,report_url,department,created_at').eq('listing_id', listingId).neq('status', 'closed').limit(50)
    for (const q of (data || []) as any[]) qc.push({ issue: q.issue_type || 'Issue', status: str(q.status), taskId: q.breezeway_task_id ? String(q.breezeway_task_id) : null, dept: q.department || 'inspection', reportUrl: q.report_url || null })
  } catch (e) { console.error('unit-items qc', e) }

  // 3) open audit findings (fix / replace / add)
  const audits: any[] = []
  try {
    const { data } = await db.from('audit_items').select('id,room,kind,title,status,breezeway_task_id').eq('listing_id', listingId).limit(80)
    for (const a of (data || []) as any[]) { if (/done|complete|dismiss|resolved|ordered/i.test(str(a.status))) continue; audits.push({ id: String(a.id), room: a.room || null, kind: a.kind || 'fix', title: a.title || 'Item', status: str(a.status || 'open'), taskId: a.breezeway_task_id ? String(a.breezeway_task_id) : null }) }
  } catch (e) { console.error('unit-items audits', e) }

  // 4) service history — last time each recurring job was DONE (from completed Breezeway tasks)
  const history: { lastAudit: string | null; lastPM: string | null; lastBattery: string | null; lastAcFilter: string | null } = { lastAudit: null, lastPM: null, lastBattery: null, lastAcFilter: null }
  try {
    const back = addDays(today, -420)
    const { data } = await db.from('breezeway_tasks_sync').select('name,finished_at,scheduled_date,status').eq('reference_property_id', listingId).gte('scheduled_date', back).limit(600)
    const most = (cur: string | null, when: string) => (when && (!cur || when > cur) ? when : cur)
    for (const t of (data || []) as any[]) {
      if (!/complete|finish/i.test(str(t.status))) continue
      const nm = str(t.name).toLowerCase()
      const when = str(t.finished_at || t.scheduled_date).slice(0, 10)
      if (!when) continue
      if (/audit/.test(nm)) history.lastAudit = most(history.lastAudit, when)
      if (/preventative|preventive|\bpm\b/.test(nm)) history.lastPM = most(history.lastPM, when)
      if (/batter/.test(nm)) history.lastBattery = most(history.lastBattery, when)
      if (/a\/?c filter|air filter|hvac filter|filter change|change.*filter/.test(nm)) history.lastAcFilter = most(history.lastAcFilter, when)
    }
  } catch (e) { console.error('unit-items history', e) }

  // 4) recommended inspection from recent low guest reviews
  let recommended: { inspection: boolean; reasons: string[] } = { inspection: false, reasons: [] }
  try {
    const since = addDays(today, -180)
    const { data } = await db.from('guesty_reviews').select('rating,overall,created_at,date').eq('listing_id', listingId).limit(60)
    let low = 0
    for (const r of (data || []) as any[]) {
      const rate = Number(r.rating ?? r.overall)
      const when = str(r.created_at || r.date).slice(0, 10)
      if (Number.isFinite(rate) && rate <= 3 && when >= since) low++
    }
    const reasons: string[] = []
    if (low > 0) reasons.push(low + ' low review' + (low > 1 ? 's' : '') + ' in the last 180 days')
    if (qc.length) reasons.push(qc.length + ' open QC issue' + (qc.length > 1 ? 's' : ''))
    recommended = { inspection: reasons.length > 0, reasons }
  } catch (e) { console.error('unit-items reviews', e) }

  return NextResponse.json({ ok: true, today, listingId, open, qc, audits, recommended, history })
}
