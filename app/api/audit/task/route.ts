// Property Audit: create Breezeway tasks from audit items - desktop only (managed + assigned in
// the app, not the mobile link). Approval-gated by design: a manager clicks. Two modes:
//   POST { itemId }            -> one task for one item
//   POST { auditId, kinds? }   -> BATCH: one task for every open actionable item on the audit
// Every task carries a STANDARDIZED brief (unit / room / task / done-when / photo) so the field
// team gets clear instructions, not one line.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, createBreezewayTask, updateBreezewayTask, listBreezewayPeople } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']
// Only these kinds are field WORK (dispatchable). replace/add are ORDERS - they get a task later,
// once the item has arrived and needs installing, not straight off the audit.
const WORK_KINDS = ['maintenance', 'clean']
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

function kindLabel(kind: string): string { return kind === 'maintenance' ? 'Fix' : kind === 'clean' ? 'Clean' : kind === 'add' ? 'Add' : 'Replace' }
function deptFor(item: any): string { return item.kind === 'maintenance' ? 'maintenance' : item.kind === 'clean' ? 'housekeeping' : 'inspection' }
function prioFor(item: any): string { return item.severity === 'high' ? 'high' : item.severity === 'low' ? 'low' : 'normal' }
function doneWhen(kind: string): string {
  if (kind === 'maintenance') return 'Repaired and fully working; area cleaned up after.'
  if (kind === 'clean') return 'Spotless and guest-ready - no stains, dust or odor.'
  if (kind === 'replace') return 'Old item removed; new item installed and staged.'
  if (kind === 'add') return 'New item installed or placed and guest-ready.'
  return 'Resolved and guest-ready.'
}

// Standardized instruction brief so the field team knows exactly what to do and what good looks like.
function buildBrief(item: any, unit: string): string {
  const ai = item.ai_assessment && typeof item.ai_assessment === 'object' ? item.ai_assessment : null
  const lines = [
    'UNIT: ' + unit,
    'ROOM: ' + (item.room || 'General'),
    'TASK: ' + (item.title || item.item_type || 'See photo'),
  ]
  if (item.note) lines.push('DETAILS: ' + String(item.note))
  if (ai && ai.condition) lines.push('NOTED: ' + String(ai.condition))
  lines.push('DONE WHEN: ' + doneWhen(String(item.kind)))
  if (item.photo_url) lines.push('PHOTO: ' + item.photo_url)
  lines.push('Please photograph the finished work. Logged from the Stay property audit.')
  return lines.join('\n')
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ ok: true, people: [] })
  try { const people = await listBreezewayPeople(); return NextResponse.json({ ok: true, people: people || [] }) } catch { return NextResponse.json({ ok: true, people: [] }) }
}

// Resolve unit name + Breezeway home_id / reference for a listing, cached across a batch.
async function resolveTarget(db: any, listingId: string, cache: Record<string, any>) {
  if (cache[listingId]) return cache[listingId]
  const { data: lrows } = await db.from('guesty_listings').select('id,nickname,title,building').eq('id', listingId).limit(1)
  const unit = (lrows && lrows[0] && (lrows[0].nickname || lrows[0].title)) || 'Unit'
  const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
  const homeId = Number((props || [])[0] && (props || [])[0].home_id)
  const t = { unit, homeId: Number.isFinite(homeId) && homeId > 0 ? homeId : null }
  cache[listingId] = t
  return t
}

// Create ONE Breezeway task for one item + write it back onto the audit item. Returns a result row.
async function createTaskForItem(db: any, item: any, opts: { department?: string; priority?: string; assigneeIds?: number[]; date?: string }, cache: Record<string, any>) {
  if (item.breezeway_task_id) return { itemId: item.id, ok: true, taskId: item.breezeway_task_id, reportUrl: item.report_url || null, existing: true }
  const listingId = String(item.listing_id)
  const tgt = await resolveTarget(db, listingId, cache)
  const department = DEPTS.includes(String(opts.department)) ? String(opts.department) : deptFor(item)
  const priority = PRIOS.includes(String(opts.priority)) ? String(opts.priority) : prioFor(item)
  const name = (kindLabel(String(item.kind)) + ': ' + (item.title || item.item_type || 'item') + ' — ' + (item.room || 'General')).slice(0, 120)
  const payload: Record<string, any> = { name, type_department: department, type_priority: priority, scheduled_date: opts.date || todayET(), description: buildBrief(item, tgt.unit) }
  if (tgt.homeId) payload.home_id = tgt.homeId
  else payload.reference_property_id = listingId
  const r = await createBreezewayTask(payload)
  if (!r.ok || !(r.data && r.data.id)) return { itemId: item.id, ok: false, error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 120) }
  const taskId = String(r.data.id)
  const reportUrl = (r.data && r.data.report_url) || null
  const assigneeIds = Array.isArray(opts.assigneeIds) ? opts.assigneeIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)).slice(0, 5) : []
  let assigned = false
  if (assigneeIds.length) { try { const u = await updateBreezewayTask(taskId, { assignments: assigneeIds, name }); assigned = !!u.ok } catch { assigned = false } }
  await db.from('audit_items').update({ breezeway_task_id: taskId, report_url: reportUrl, status: 'task_created', updated_at: new Date().toISOString() }).eq('id', item.id)
  return { itemId: item.id, ok: true, taskId, reportUrl, assigned }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  const cache: Record<string, any> = {}

  // BATCH: create a task for every open actionable item on an audit (default kinds = maintenance + clean).
  const auditId = String(body.auditId || '')
  if (auditId || Array.isArray(body.itemIds)) {
    let items: any[] = []
    if (Array.isArray(body.itemIds) && body.itemIds.length) {
      const ids = body.itemIds.map((x: any) => String(x)).slice(0, 200)
      const { data } = await db.from('audit_items').select('*').in('id', ids).limit(200)
      items = data || []
    } else {
      const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds.map((k: any) => String(k)).filter((k: string) => WORK_KINDS.includes(k)) : WORK_KINDS
      const { data } = await db.from('audit_items').select('*').eq('audit_id', auditId).in('kind', kinds).eq('status', 'open').limit(200)
      items = data || []
    }
    // Only actionable, not-yet-tasked work items.
    items = items.filter((it: any) => WORK_KINDS.includes(String(it.kind)) && it.status === 'open' && !it.breezeway_task_id)
    if (!items.length) return NextResponse.json({ ok: true, created: 0, results: [], note: 'No open maintenance or clean items to dispatch.' })
    const results: any[] = []
    // Sequential to stay friendly to the Breezeway token bucket; audits rarely have >30 work items.
    for (const it of items) { try { results.push(await createTaskForItem(db, it, {}, cache)) } catch (e: any) { results.push({ itemId: it.id, ok: false, error: String(e && e.message || e).slice(0, 120) }) } }
    const created = results.filter(r => r.ok && !r.existing).length
    const failed = results.filter(r => !r.ok).length
    return NextResponse.json({ ok: true, created, failed, results })
  }

  // SINGLE item.
  const itemId = String(body.itemId || '')
  if (!itemId) return NextResponse.json({ error: 'itemId or auditId required' }, { status: 400 })
  const { data: rows } = await db.from('audit_items').select('*').eq('id', itemId).limit(1)
  const item = rows && rows[0]
  if (!item) return NextResponse.json({ error: 'item not found' }, { status: 404 })
  const res = await createTaskForItem(db, item, { department: body.department, priority: body.priority, assigneeIds: body.assigneeIds, date: body.date }, cache)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Task creation failed' }, { status: 502 })
  return NextResponse.json({ ok: true, taskId: res.taskId, reportUrl: res.reportUrl, assigned: res.assigned, existing: !!res.existing })
}
