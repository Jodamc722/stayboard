// Guest sentiment -> targeted QC task in Breezeway. EXPLICIT approval only (button click) - never
// automatic (Jon's rule). Resolves the unit from the conversation, creates a specific inspection/
// maintenance/housekeeping task with guest context, logs to qc_tasks (idempotent per conversation).
// GET ?conversationIds=a,b,c returns existing QC tasks so the board can show created-state.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, createBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const ids = String(new URL(req.url).searchParams.get('conversationIds') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
  if (!ids.length) return NextResponse.json({ ok: true, tasks: [] })
  try {
    const { data } = await supabaseAdmin().from('qc_tasks').select('conversation_id,breezeway_task_id,report_url,issue_type,department,status,created_at').in('conversation_id', ids).order('created_at', { ascending: false })
    return NextResponse.json({ ok: true, tasks: data || [] })
  } catch { return NextResponse.json({ ok: true, tasks: [] }) }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const body = await req.json().catch(() => ({} as any))
  const conversationId = String(body?.conversationId || '').trim()
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  const department = DEPTS.includes(String(body?.department)) ? String(body.department) : 'inspection'
  const priority = PRIOS.includes(String(body?.priority)) ? String(body.priority) : 'high'
  const title = String(body?.title || 'QC - guest-reported issue').slice(0, 120)
  const description = String(body?.description || '').slice(0, 1500)
  const issueType = String(body?.issueType || 'upset-guest').slice(0, 40)
  const db = supabaseAdmin()
  const { data: existing } = await db.from('qc_tasks').select('breezeway_task_id,report_url').eq('conversation_id', conversationId).limit(1)
  if (existing && existing[0] && existing[0].breezeway_task_id) return NextResponse.json({ ok: true, taskId: existing[0].breezeway_task_id, reportUrl: existing[0].report_url || null, existing: true })
  const { data: convs } = await db.from('guesty_conversations').select('listing_id,guest_name').eq('id', conversationId).limit(1)
  const conv: any = (convs || [])[0]
  if (!conv || !conv.listing_id) return NextResponse.json({ error: 'This conversation is not linked to a unit in Guesty, so a task cannot be attached. Create it in Breezeway directly.' }, { status: 400 })
  const listingId = String(conv.listing_id)
  const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
  const homeId = Number((props || [])[0]?.home_id)
  const payload: Record<string, any> = { name: title, type_department: department, type_priority: priority, scheduled_date: todayET(), description }
  if (Number.isFinite(homeId)) payload.home_id = homeId
  else payload.reference_property_id = listingId
  const r = await createBreezewayTask(payload)
  if (!r.ok || !r.data?.id) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + r.text.slice(0, 160) }, { status: 502 })
  const taskId = String(r.data.id)
  const reportUrl = r.data?.report_url || null
  try { await db.from('qc_tasks').insert({ breezeway_task_id: taskId, listing_id: listingId, conversation_id: conversationId, issue_type: issueType, guest_name: conv.guest_name || null, title, description, department, report_url: reportUrl, status: 'open', created_by: user.email || null }) } catch { /* log optional */ }
  return NextResponse.json({ ok: true, taskId, reportUrl })
}
