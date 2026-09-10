// BILLABLE REVIEW — the two-stage approval desk (Jon, 2026-09-10).
//
// "The goal is to review and approve billables… once it's approved by Ronnie or our ops team, it
//  should go into GM review, where I can then review the final review… make it fast, make it
//  clean, and make it easy."
//
// GET is deliberately LEAN. The old board endpoint (/api/billing) also pulled every Breezeway unit,
// the month's Homebase timecards (a sequential week-by-week walk that alone took seconds) and a
// market split — none of which a person approving line items needs. This returns the tasks, the
// owner summaries computed over the WHOLE window, and who you are. That is the whole page.
//
// POST walks a task's review state and returns exactly the rows that changed, so the client can
// merge them in place. It never triggers a reload of the month; a review must not rebuild the page.
//
// WHO MAY DO WHAT: anyone with billing:edit can ops-approve or send back. gm_approved is the GM's
// signature — admin role only — because it is what lands on an owner's statement.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { billingRange, monthRange, type BillingTask, type ReviewState } from '@/lib/billing'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isYmd = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const todayMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7)

/** The fields the review desk actually renders — roughly a third of the full task record. */
function slim(t: BillingTask) {
  return {
    id: t.id, unit: t.unit, building: t.building, ownerId: t.ownerId, ownerName: t.ownerName,
    department: t.department, name: t.name, description: t.description, status: t.status,
    doer: (t.assignees[0] && t.assignees[0].name) || t.finishedBy || null,
    scheduledDate: t.scheduledDate, finishedAt: t.finishedAt, actualMinutes: t.actualMinutes,
    ratePaid: t.ratePaid, rateType: t.rateType, crew: t.crew,
    items: t.items, hasDetail: t.hasDetail,
    excluded: t.excluded, note: t.note, overrideAmount: t.overrideAmount, billedHours: t.billedHours,
    laborAmount: t.laborAmount, billedAmount: t.billedAmount, reportUrl: t.reportUrl,
    reviewState: t.reviewState, opsBy: t.opsBy, opsAt: t.opsAt, gmBy: t.gmBy, gmAt: t.gmAt,
    flags: t.flags,
  }
}
export type ReviewTask = ReturnType<typeof slim>

export async function GET(req: NextRequest) {
  const gate = await requireLevel('billing', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const month = String(sp.get('month') || '').slice(0, 7)
  const qFrom = String(sp.get('from') || ''), qTo = String(sp.get('to') || '')
  const custom = isYmd(qFrom) && isYmd(qTo) && qFrom <= qTo
  const monthKey = /^\d{4}-\d{2}$/.test(month) ? month : todayMonth()
  const win = custom ? { from: qFrom, to: qTo } : monthRange(monthKey)
  try {
    const data = await billingRange(win.from, win.to)
    // Owners in a FIXED order — by name — so reviewing never moves a group under the cursor.
    const owners = data.owners.slice().sort((a, b) => {
      if (!a.ownerId && b.ownerId) return 1
      if (a.ownerId && !b.ownerId) return -1
      return a.ownerName.localeCompare(b.ownerName)
    })
    return NextResponse.json({
      ok: true, month: monthKey, from: win.from, to: win.to,
      me: { email: gate.access.email || '', isGm: gate.access.role === 'admin' },
      tasks: data.tasks.map(slim),
      owners,
      missingDetail: data.missingDetail,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('billing', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const to = String(body?.to || '') as ReviewState
  if (to !== 'open' && to !== 'ops_approved' && to !== 'gm_approved') {
    return NextResponse.json({ ok: false, error: 'to must be open, ops_approved or gm_approved' }, { status: 400 })
  }
  const isGm = gate.access.role === 'admin'
  if (to === 'gm_approved' && !isGm) return NextResponse.json({ ok: false, error: 'GM approval is for the GM.' }, { status: 403 })
  const ids: string[] = (Array.isArray(body?.taskIds) ? body.taskIds : [body?.taskId])
    .map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 500)
  if (!ids.length) return NextResponse.json({ ok: false, error: 'taskId or taskIds required' }, { status: 400 })

  const who = gate.access.email || 'unknown'
  const now = new Date().toISOString()
  // ONLY the state columns travel. The old adjust path read the whole row and wrote the whole row
  // back, so two people editing one task lost one edit silently; an approval must never be able
  // to do that to somebody's price or note.
  const patch: Record<string, any> = { review_state: to, updated_by: who, updated_at: now }
  if (to === 'ops_approved') { patch.ops_by = who; patch.ops_at = now; patch.gm_by = null; patch.gm_at = null }
  if (to === 'gm_approved') { patch.gm_by = who; patch.gm_at = now }
  if (to === 'open') { patch.ops_by = null; patch.ops_at = null; patch.gm_by = null; patch.gm_at = null }
  // Keep the legacy mark in step so anything still reading reviewed_by agrees with the new state.
  patch.reviewed_by = to === 'open' ? null : who
  patch.reviewed_at = to === 'open' ? null : now

  const db = supabaseAdmin()
  const rows = ids.map(task_id => ({ task_id, ...patch }))
  const { error } = await db.from('billing_adjustments').upsert(rows, { onConflict: 'task_id' })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // Only the keys this transition touched come back, so the client merge leaves the rest alone
  // (a GM approval must not blank the ops signature that put the task in the GM's queue).
  const delta: Record<string, any> = { reviewState: to }
  if ('ops_by' in patch) { delta.opsBy = patch.ops_by; delta.opsAt = patch.ops_at }
  if ('gm_by' in patch) { delta.gmBy = patch.gm_by; delta.gmAt = patch.gm_at }
  return NextResponse.json({ ok: true, to, by: who, at: now, changed: ids.map(id => ({ id, ...delta })) })
}
