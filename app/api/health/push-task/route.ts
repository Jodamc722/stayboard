// Push an Action-Plan issue into Breezeway as a smart-routed task, scheduled on the unit's
// NEXT VACANT day, and record it for tracking. Logged-in users only. Two-step: the first call
// is a PREVIEW (creates nothing); only a call with confirm===true creates the task. Idempotent.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, createBreezewayTask, normalizeTaskStatus } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function departmentFor(key: string, owner: string): string | null {
  const k = String(key || '').toLowerCase()
  const o = String(owner || '').toLowerCase()
  if (k === 'clean' || o.includes('housekeep')) return 'housekeeping'
  if (k === 'ac' || k === 'maint' || k === 'checkin') return 'maintenance'
  if (k === 'noise' || k === 'ops') return 'inspection'
  if (o.includes('maintenance')) return 'maintenance'
  if (o.includes('field') || o.includes('ops')) return 'inspection'
  return null
}
const PRIORITY: Record<string, string> = { critical: 'urgent', high: 'high', medium: 'normal', low: 'low' }

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

function nextVacantDay(reservations: { check_in: string; check_out: string }[], horizon = 21): string {
  const today = todayET()
  for (let i = 0; i <= horizon; i++) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() + i * 86400000))
    const occupied = reservations.some(r => r.check_in && r.check_out && r.check_in <= d && d < r.check_out)
    if (!occupied) return d
  }
  return today
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured in Vercel env.' }, { status: 503 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = String(body?.listingId || '').trim()
  const issueKey = String(body?.issueKey || '').trim()
  const issueTitle = String(body?.issueTitle || '').trim()
  const action = String(body?.action || '').trim()
  const unitName = String(body?.unitName || '').trim().slice(0, 60)
  const severity = String(body?.severity || 'medium').toLowerCase()
  const owner = String(body?.owner || '').trim()
  const assigneeIds = (Array.isArray(body?.assigneeIds) ? body.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
  if (!listingId || !issueTitle) return NextResponse.json({ error: 'listingId and issueTitle required' }, { status: 400 })

  const explicitDept = String(body?.department || '').toLowerCase().trim()
  const VALID_DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
  const department = VALID_DEPTS.includes(explicitDept) ? explicitDept : departmentFor(issueKey, owner)
  if (!department) return NextResponse.json({ error: 'This is a desk task (CCS/Listings), not a Breezeway field task.' }, { status: 400 })
  const explicitPriority = String(body?.priority || '').toLowerCase().trim()
  const VALID_PRI = ['urgent', 'high', 'normal', 'low', 'watch']
  const priority = VALID_PRI.includes(explicitPriority) ? explicitPriority : (PRIORITY[severity] || 'normal')

  const db = supabaseAdmin()

  const { data: existing } = await db.from('breezeway_tasks')
    .select('id, status, scheduled_date, breezeway_task_id')
    .eq('listing_id', listingId).eq('issue_title', issueTitle)
    .in('status', ['created', 'in_progress']).limit(1)
  if (existing && existing.length) {
    return NextResponse.json({ ok: true, already: true, status: existing[0].status, scheduled_date: existing[0].scheduled_date, taskId: existing[0].breezeway_task_id })
  }

  const { data: prop } = await db.from('breezeway_properties').select('home_id, name').eq('reference_property_id', listingId).limit(1)
  const home_id = prop && prop[0] ? Number(prop[0].home_id) : null
  if (!home_id) return NextResponse.json({ error: 'No Breezeway property mapped for this unit. Run /api/sync/breezeway?sync=properties first.' }, { status: 400 })

  const { data: resv } = await db.from('guesty_reservations')
    .select('check_in, check_out, status')
    .eq('listing_id', listingId)
    .gte('check_out', todayET()).limit(500)
  const cleanResv = (resv || []).filter((r: any) => !/cancel|declin/i.test(String(r.status || ''))).map((r: any) => ({ check_in: String(r.check_in).slice(0, 10), check_out: String(r.check_out).slice(0, 10) }))
  const reqDate = String(body?.scheduledDate || '').trim()
  const scheduled = /^\d{4}-\d{2}-\d{2}$/.test(reqDate) ? reqDate : nextVacantDay(cleanResv)

  // CONFIRMATION GATE: first call is a preview (creates nothing).
  if (body?.confirm !== true) {
    return NextResponse.json({ ok: true, preview: true, department, priority, scheduled_date: scheduled, home_id, message: `Will create a ${priority} ${department} task on ${scheduled} (next vacant day). Confirm to push.` })
  }

  const r = await createBreezewayTask({
    home_id,
    name: (unitName ? unitName + ' — ' : '') + issueTitle.slice(0, unitName ? 120 - unitName.length - 3 : 120),
    description: (action ? action + ' ' : '') + '[Flagged by StayBoard Action Plan]',
    type_department: department,
    type_priority: priority,
    scheduled_date: scheduled,
    requested_by: 'review',
    assignments: assigneeIds.length ? assigneeIds : undefined,
    assign_default_workers: assigneeIds.length ? false : true,
  })
  if (!r.ok) return NextResponse.json({ error: `Breezeway create ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })

  const t = r.data || {}
  const status = normalizeTaskStatus(t)
  const row = {
    listing_id: listingId, home_id, issue_key: issueKey || null, issue_title: issueTitle, action: action || null,
    department, priority, breezeway_task_id: t?.id != null ? String(t.id) : null,
    scheduled_date: t?.scheduled_date || scheduled, status, report_url: t?.report_url || null, pushed_by: user.email || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('breezeway_tasks').insert(row)
  if (error) return NextResponse.json({ ok: true, warning: `Task created in Breezeway but local save failed: ${error.message}`, taskId: row.breezeway_task_id, scheduled_date: scheduled, status }, { status: 200 })

  return NextResponse.json({ ok: true, taskId: row.breezeway_task_id, department, priority, scheduled_date: scheduled, status, reportUrl: row.report_url })
}
