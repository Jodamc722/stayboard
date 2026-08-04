// Add a task to a unit from Today in Ops. EXPLICIT button click only — never automatic.
// Deliberately does NOT write to qc_tasks: that table drives the 'needs attention' panel, so
// filing routine work there would turn every added task into a false QC alert.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createBreezewayTask, updateBreezewayTask } from '@/lib/breezeway'
import { buildIntel, intelKindFor } from '@/lib/listingIntel'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']
function todayET(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

// THE ANNUAL AUDIT CARRIES ITS LINK — and only that one.
//
// The Annual Quality Audit is the audit that has a form in the web app, so its Breezeway task used
// to be a paragraph of instructions with nowhere to put the findings: the inspector walked the unit
// and then went hunting for the audit link. It now gets (or reuses) that unit's open audit and puts
// the mobile capture link straight in the Breezeway description, so the walk and the logging are
// one job.
//
// Every OTHER kind of inspection — unit checks, guest-feedback inspections, PM passes — is ordinary
// field work with no audit form behind it, so it must NOT get a link. Attaching one there would
// open an audit nobody is going to fill in and pollute the audit history the annual cadence is
// measured against. Hence the narrow match, not a loose /audit/.
//
// Reuses the open audit when there is one, so re-filing never orphans work already captured.
// Best-effort: if this fails the task is still created, just without a link.
async function auditLinkFor(db: any, listingId: string, origin: string, createdBy: string | null): Promise<string> {
  if (!listingId || listingId.indexOf(':') >= 0) return ''
  let audit: any = null
  const { data: open } = await db.from('property_audits').select('*').eq('listing_id', listingId).eq('status', 'open').limit(1)
  audit = open && open[0]
  if (!audit) {
    const uuid = (globalThis as any).crypto && (globalThis as any).crypto.randomUUID ? (globalThis as any).crypto.randomUUID() : String(Math.random()).slice(2) + String(Math.random()).slice(2)
    const shareCode = String(uuid).replace(/-/g, '').slice(0, 14)
    const ins = await db.from('property_audits').insert({ listing_id: listingId, share_code: shareCode, status: 'open', audit_type: 'quality', created_by: createdBy }).select('*').limit(1)
    if (ins.error) return ''
    audit = ins.data && ins.data[0]
  }
  if (!audit || !audit.share_code) return ''
  return origin + '/audit/' + audit.share_code
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'plan' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('plan', 'edit')
  if (!__gate.ok) return __gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const listingId = String(body?.listingId || '').trim()
    const title = String(body?.title || '').trim().slice(0, 120)
    if (!listingId || !title) return NextResponse.json({ ok: false, error: 'listingId and title are required' }, { status: 400 })
    const department = DEPTS.indexOf(String(body?.department)) >= 0 ? String(body.department) : 'maintenance'
    const priority = PRIOS.indexOf(String(body?.priority)) >= 0 ? String(body.priority) : 'normal'
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? String(body.date) : todayET()
    const db = supabaseAdmin()
    // ONLY the annual quality audit. Callers can force it with auditLink:true; otherwise the title
    // has to actually name the annual audit — "Unit Check" and "Guest-feedback inspection" must not
    // mint an audit link.
    const wantsLink = body?.auditLink === true || (body?.auditLink !== false && /\bannual\b/i.test(title) && /\baudit\b/i.test(title))
    let link = ''
    if (wantsLink) { try { link = await auditLinkFor(db, listingId, req.nextUrl.origin, user.email || null) } catch { link = '' } }
    // WHOEVER OPENS THIS TASK GETS THE BRIEF FOR THEIR JOB. An inspector needs the review that
    // triggered the visit and the unit's weak category; a maintenance tech needs whether this fault
    // has happened here before, whether anyone is inside right now, and whether the part is already
    // on order. Best-effort: a failure here must never stop the task being created.
    let intel: string | null = null
    try { intel = await buildIntel(listingId, { kind: intelKindFor(title, department), date, taskName: title }) } catch (e) { console.error('add-task: intel failed', e) }
    const description = String(body?.description || '').slice(0, 1000)
      + (link ? '\n\nAUDIT LINK (open on your phone): ' + link + '\nLog every finding in that link as you walk — fixes and cleans become team tasks, and anything below par becomes an order automatically. Photograph anything below standard.' : '')
      + (intel ? '\n\n' + intel : '')
      + (user.email ? '\n\nAdded from Today in Ops by ' + user.email : '')
    const { data: props } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', listingId).limit(1)
    const homeId = Number(((props || [])[0] || {}).home_id)
    const payload: Record<string, any> = { name: title, type_department: department, type_priority: priority, scheduled_date: date, description }
    if (Number.isFinite(homeId)) payload.home_id = homeId
    else payload.reference_property_id = listingId
    const r = await createBreezewayTask(payload)
    if (!r.ok || !r.data || !r.data.id) return NextResponse.json({ ok: false, error: 'Breezeway ' + r.status + ': ' + String(r.text || '').slice(0, 160) }, { status: 502 })
    // Optional: assign it in the same click (the board sends the person picked in the panel).
    let assigned: boolean | undefined = undefined
    const ids = (Array.isArray(body?.assigneeIds) ? body.assigneeIds : []).map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
    if (ids.length) {
      assigned = false
      try { const a = await updateBreezewayTask(String(r.data.id), { assignments: ids }); assigned = !!a.ok } catch { assigned = false }
    }
    // WRITE THROUGH to the mirror: the board reads breezeway_tasks_sync, which refreshes every
    // 15 minutes — without this a task you just created was invisible until the next sync.
    try {
      await db.from('breezeway_tasks_sync').upsert({
        id: String(r.data.id), reference_property_id: listingId, name: title,
        status: 'created', scheduled_date: date, type_department: department,
        assignees: [], report_url: r.data.report_url || null,
        raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    } catch { /* the sync catches up */ }
    return NextResponse.json({ ok: true, taskId: String(r.data.id), reportUrl: r.data.report_url || null, department, priority, date, assigned })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
