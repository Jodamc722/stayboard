// Guest sentiment -> targeted QC task in Breezeway. EXPLICIT approval only (button click) - never
// automatic (Jon's rule). Resolves the unit from the conversation, creates a specific inspection/
// maintenance/housekeeping task with guest context, logs to qc_tasks (idempotent per conversation).
// GET ?conversationIds=a,b,c returns existing QC tasks so the board can show created-state.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, createBreezewayTask } from '@/lib/breezeway'
import { buildIntel, intelKindFor, INTEL_STRIP_RE } from '@/lib/listingIntel'
import { requireLevel, requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']

function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res
  const user = gate.access.user
  const ids = String(new URL(req.url).searchParams.get('conversationIds') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
  if (!ids.length) return NextResponse.json({ ok: true, tasks: [] })
  try {
    const { data } = await supabaseAdmin().from('qc_tasks').select('conversation_id,breezeway_task_id,report_url,issue_type,department,status,created_at').in('conversation_id', ids).order('created_at', { ascending: false })
    return NextResponse.json({ ok: true, tasks: data || [] })
  } catch { return NextResponse.json({ ok: true, tasks: [] }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('messages', 'edit')
  if (!gate.ok) return gate.res
  const user = gate.access.user
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })
  const body = await req.json().catch(() => ({} as any))
  const conversationId = String(body?.conversationId || '').trim()
  const directListingId = String(body?.listingId || '').trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? String(body.date) : null
  if (!conversationId && !directListingId) return NextResponse.json({ error: 'conversationId or listingId required' }, { status: 400 })
  const department = DEPTS.includes(String(body?.department)) ? String(body.department) : 'inspection'
  const priority = PRIOS.includes(String(body?.priority)) ? String(body.priority) : 'high'
  const title = String(body?.title || 'QC - guest-reported issue').slice(0, 120)
  const description = String(body?.description || '').slice(0, 1500)
  const issueType = String(body?.issueType || 'upset-guest').slice(0, 40)
  const db = supabaseAdmin()
  let listingId = directListingId
  let guestName: string | null = null
  if (conversationId) {
    const { data: existing } = await db.from('qc_tasks').select('breezeway_task_id,report_url').eq('conversation_id', conversationId).limit(1)
    if (existing && existing[0] && existing[0].breezeway_task_id) return NextResponse.json({ ok: true, taskId: existing[0].breezeway_task_id, reportUrl: existing[0].report_url || null, existing: true })
    const { data: convs } = await db.from('guesty_conversations').select('listing_id,guest_name').eq('id', conversationId).limit(1)
    const conv: any = (convs || [])[0]
    if (!conv || !conv.listing_id) return NextResponse.json({ error: 'This conversation is not linked to a unit in Guesty, so a task cannot be attached. Create it in Breezeway directly.' }, { status: 400 })
    listingId = String(conv.listing_id)
    guestName = conv.guest_name || null
  } else {
    // listing-based (review audit): one OPEN task per listing+issueType, never duplicate
    const { data: existing } = await db.from('qc_tasks').select('breezeway_task_id,report_url').eq('listing_id', listingId).eq('issue_type', issueType).eq('status', 'open').limit(1)
    if (existing && existing[0] && existing[0].breezeway_task_id) return NextResponse.json({ ok: true, taskId: existing[0].breezeway_task_id, reportUrl: existing[0].report_url || null, existing: true })
  }
  // ── THE UNIT BRIEF IS THE SERVER'S JOB (2026-09-14) ──────────────────────────────────────────
  // /api/ops-today/add-task has attached lib/listingIntel to every task it creates since August:
  // the review that triggered the visit, the unit's weak category against the portfolio, open
  // glitches, overdue upkeep, the last inspection score, access — role-shaped and bilingual. This
  // route never did, so its callers each grew their OWN version in the browser, which is how the
  // scheduler's unit panel ended up shipping "Why: a; b | Last feedback (2/5): <300 chars> |
  // Check: a; b; c; d" while the same facts sat one function call away, better written.
  //
  // Now it does. Callers send the REASON — one line about why this task exists — and the evidence
  // about the unit is attached here, once, in the same format the rest of the app uses.
  //
  // INTEL_STRIP_RE first: a caller that still composes its own block would otherwise print the
  // same guest quote twice, which is the exact noise this is meant to remove.
  const reason = description.replace(INTEL_STRIP_RE, '').trim()
  let intel: string | null = null
  try { intel = await buildIntel(listingId, { kind: intelKindFor(title, department), date: date || todayET(), taskName: title }) } catch (e) { console.error('create-qc: intel failed', e) }
  const fullDescription = [reason, intel].filter(Boolean).join('\n\n').slice(0, 3500)

  const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
  const homeId = Number((props || [])[0]?.home_id)
  const payload: Record<string, any> = { name: title, type_department: department, type_priority: priority, scheduled_date: date || todayET(), description: fullDescription }
  if (Number.isFinite(homeId)) payload.home_id = homeId
  else payload.reference_property_id = listingId
  const r = await createBreezewayTask(payload)
  if (!r.ok || !r.data?.id) return NextResponse.json({ error: 'Breezeway ' + r.status + ': ' + r.text.slice(0, 160) }, { status: 502 })
  const taskId = String(r.data.id)
  const reportUrl = r.data?.report_url || null
  try { await db.from('qc_tasks').insert({ breezeway_task_id: taskId, listing_id: listingId, conversation_id: conversationId || null, issue_type: issueType, guest_name: guestName, title, description: reason, department, report_url: reportUrl, status: 'open', created_by: user.email || null }) } catch { /* log optional */ }
  return NextResponse.json({ ok: true, taskId, reportUrl })
}
