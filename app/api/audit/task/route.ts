// Property Audit: one Breezeway task PER identified item - desktop only (managed + assigned in
// the app, not the mobile link). Approval-gated by design: a manager clicks per item.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, createBreezewayTask, updateBreezewayTask, listBreezewayPeople } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ ok: true, people: [] })
  try { const people = await listBreezewayPeople(); return NextResponse.json({ ok: true, people: people || [] }) } catch { return NextResponse.json({ ok: true, people: [] }) }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const itemId = String(body.itemId || '')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const { data: rows } = await db.from('audit_items').select('*').eq('id', itemId).limit(1)
  const item = rows && rows[0]
  if (!item) return NextResponse.json({ error: 'item not found' }, { status: 404 })
  if (item.breezeway_task_id) return NextResponse.json({ ok: true, taskId: item.breezeway_task_id, reportUrl: item.report_url || null, existing: true })
  const listingId = String(item.listing_id)
  const { data: lrows } = await db.from('guesty_listings').select('id,nickname,title,building').eq('id', listingId).limit(1)
  const unit = (lrows && lrows[0] && (lrows[0].nickname || lrows[0].title)) || 'Unit'
  // ROUTING: maintenance findings go to the maintenance dept, cleanliness findings go to the
  // housekeeping team - both overridable per item from the desk.
  const department = DEPTS.includes(String(body.department)) ? String(body.department) : (item.kind === 'maintenance' ? 'maintenance' : item.kind === 'clean' ? 'housekeeping' : 'inspection')
  const priority = PRIOS.includes(String(body.priority)) ? String(body.priority) : (item.severity === 'high' ? 'high' : 'normal')
  const kindLabel = item.kind === 'maintenance' ? 'Fix' : item.kind === 'clean' ? 'Clean' : item.kind === 'add' ? 'Add' : 'Replace'
  const name = (kindLabel + ': ' + (item.title || item.item_type || 'item') + ' \u2014 ' + item.room).slice(0, 120)
  const ai = item.ai_assessment && typeof item.ai_assessment === 'object' ? item.ai_assessment : null
  const descParts = [
    '[' + unit + '] Property audit item \u2014 ' + item.room,
    item.note ? 'Note: ' + item.note : '',
    ai && ai.condition ? 'AI condition: ' + ai.condition : '',
    item.severity ? 'Severity: ' + item.severity : '',
    item.photo_url ? 'Photo: ' + item.photo_url : '',
  ].filter(Boolean)
  const payload: Record<string, any> = { name, type_department: department, type_priority: priority, scheduled_date: String(body.date || '') || todayET(), description: descParts.join(' | ') }
  const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
  const first = (props || [])[0]
  const homeId = Number(first && first.home_id)
  if (Number.isFinite(homeId) && homeId > 0) payload.home_id = homeId
  else payload.reference_property_id = listingId
  const r = await createBreezewayTask(payload)
  if (!r.ok || !(r.data && r.data.id)) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
  const taskId = String(r.data.id)
  const reportUrl = (r.data && r.data.report_url) || null
  const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)).slice(0, 5) : []
  let assigned = false
  if (assigneeIds.length) { try { const u = await updateBreezewayTask(taskId, { assignments: assigneeIds, name }); assigned = !!u.ok } catch { assigned = false } }
  await db.from('audit_items').update({ breezeway_task_id: taskId, report_url: reportUrl, status: 'task_created', updated_at: new Date().toISOString() }).eq('id', itemId)
  return NextResponse.json({ ok: true, taskId, reportUrl, assigned })
}
