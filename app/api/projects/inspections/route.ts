// INSPECTIONS ON A PROJECT'S UNITS — what the field actually walked, and which of it the owner
// may see (Jon, 2026-10-09: "should be able to see all inspection completed from Roberto,
// Ernesto and Yoslenis. Must be approved by me").
//
// Not a score. Jon was explicit that this is not pass-or-fail — it is visibility: somebody was in
// the unit on this date, here is their report. Breezeway holds the judgement; this holds the fact.
//
// GET  ?project=<id>               → completed inspections on that project's units, newest first
// POST { projectId, bzTaskId, on } → release one to the share link, or take it back
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const DONE = /^(completed|closed|finished|done)$/i

/** Who walked it. Breezeway spells the assignee two ways depending on the sync path. */
function inspectorOf(t: any): string {
  const name = str(t.assignee_name)
  if (name) return name
  const a = Array.isArray(t.assignees) ? t.assignees : []
  return a.map((x: any) => (typeof x === 'string' ? x : str(x?.name) || str(x?.display))).filter(Boolean).join(', ')
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!atLeast(access.levels['projects'], 'view')) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  const projectId = str(req.nextUrl.searchParams.get('project'))
  if (!projectId) return NextResponse.json({ error: 'project required' }, { status: 400 })
  const sb = supabaseAdmin()

  const { data: links } = await sb.from('project_links').select('ref_id,label').eq('project_id', projectId).eq('kind', 'listing')
  const units = (links || []) as any[]
  if (!units.length) return NextResponse.json({ ok: true, rows: [] })
  const labelOf: Record<string, string> = {}
  for (const l of units) labelOf[String(l.ref_id)] = str(l.label)

  const { data: ts } = await sb.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,type_department,scheduled_date,finished_at,assignees,assignee_name,report_url')
    .in('reference_property_id', units.map(u => String(u.ref_id)).slice(0, 400))
    .eq('type_department', 'inspection')
    .order('finished_at', { ascending: false })
    .limit(400)

  const { data: shares } = await sb.from('project_inspection_shares').select('bz_task_id').eq('project_id', projectId)
  const shared = new Set(((shares || []) as any[]).map(s => String(s.bz_task_id)))

  const rows = ((ts || []) as any[])
    .filter(t => DONE.test(str(t.status)) || !!t.finished_at)
    .map(t => ({
      id: String(t.id),
      unit: labelOf[String(t.reference_property_id)] || String(t.reference_property_id),
      name: str(t.name) || 'Inspection',
      inspector: inspectorOf(t) || null,
      date: str(t.finished_at).slice(0, 10) || str(t.scheduled_date).slice(0, 10) || null,
      reportUrl: t.report_url || null,
      shared: shared.has(String(t.id)),
    }))
  return NextResponse.json({ ok: true, rows })
}

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // Releasing something to people outside the company is an edit, not a read.
  if (!atLeast(access.levels['projects'], 'edit')) return NextResponse.json({ error: 'no-access' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const projectId = str(b.projectId)
  const bzTaskId = str(b.bzTaskId)
  if (!projectId || !bzTaskId) return NextResponse.json({ error: 'projectId and bzTaskId required' }, { status: 400 })
  const sb = supabaseAdmin()
  if (b.on) {
    const { error } = await sb.from('project_inspection_shares')
      .upsert({ project_id: projectId, bz_task_id: bzTaskId, approved_by: access.email || null, approved_at: new Date().toISOString() }, { onConflict: 'project_id,bz_task_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('project_inspection_shares').delete().eq('project_id', projectId).eq('bz_task_id', bzTaskId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
