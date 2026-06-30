// Unit-level Breezeway task tracking. Fetches ONE unit's tasks live (by Guesty listing id =
// reference_property_id) and summarizes: last inspected / last PM / last clean, open/pending
// tasks (with assignees + scheduled day), and recent completed history. Guest/review-driven
// tasks are flagged. Logged-in users only. (No big portfolio sync — one unit, one call.)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { breezewayConfigured, bzApi } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function asArray(d: any): any[] {
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.data)) return d.data
  return []
}
function dep(t: any) { return String(t?.type_department || '').toLowerCase() }
function stage(t: any) { const s = t?.type_task_status || {}; return String(s.stage || s.code || '').toLowerCase() }
function isCanceled(t: any) { const s = t?.type_task_status || {}; return /cancel|declin/i.test(String(s.code || s.name || s.stage || '')) }
function isDone(t: any) { const st = stage(t); return !!t?.finished_at || st === 'finished' || st === 'done' || st.includes('clos') || st.includes('complet') || st.includes('approv') }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ error: 'Breezeway not configured.' }, { status: 503 })

  const listingId = String(new URL(req.url).searchParams.get('listingId') || '').trim()
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  // List tasks for this unit. NOTE: our Breezeway instance rejects sort_by=created_at, so we
  // omit sort and order client-side.
  const r = await bzApi(`/task/?reference_property_id=${encodeURIComponent(listingId)}&limit=300`)
  if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })

  const tasks = asArray(r.data).map((t: any) => ({
    id: String(t?.id ?? ''),
    name: t?.name || 'Task',
    department: dep(t),
    statusName: (t?.type_task_status || {})?.name || '',
    done: isDone(t),
    canceled: isCanceled(t),
    priority: String(t?.type_priority || '').toLowerCase() || null,
    scheduled_date: t?.scheduled_date || null,
    started_at: t?.started_at || null,
    finished_at: t?.finished_at || null,
    finished_by: t?.finished_by?.name || null,
    assignees: (Array.isArray(t?.assignments) ? t.assignments : []).map((a: any) => a?.name).filter(Boolean),
    total_time: t?.total_time || null,
    report_url: t?.report_url || null,
    guestDriven: /review|guest/.test(String(t?.requested_by || '').toLowerCase()),
  }))

  const latestFinished = (pred: (t: any) => boolean) =>
    tasks.filter(t => t.done && !t.canceled && t.finished_at && pred(t))
      .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))[0] || null

  // AUDIT = an inspection completed by a supervisor (per Jon: Roberto, Guillermo, Yoslenis, Ernesto, Jon).
  const SUPERVISORS = ['roberto', 'guillermo', 'yoslenis', 'ernesto', 'jon']
  const bySupervisor = (t: any) => {
    const who = [t.finished_by, ...(t.assignees || [])].filter(Boolean).join(' ').toLowerCase()
    return SUPERVISORS.some(su => who.includes(su))
  }
  const lastInspected = latestFinished(t => t.department === 'inspection' && bySupervisor(t))
    || latestFinished(t => t.department === 'inspection')
  const lastPM = latestFinished(t => t.department === 'maintenance' || t.department === 'safety')
  // CLEAN = the turnover "Departure Clean" (per Jon). Fall back to any completed housekeeping task.
  const lastClean = latestFinished(t => /departure/i.test(t.name) && /clean/i.test(t.name))
    || latestFinished(t => t.department === 'housekeeping')

  const open = tasks.filter(t => !t.done && !t.canceled)
    .sort((a, b) => String(a.scheduled_date || '9999-99-99').localeCompare(String(b.scheduled_date || '9999-99-99')))
  const completed = tasks.filter(t => t.done && !t.canceled && t.finished_at)
    .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at))).slice(0, 15)

  return NextResponse.json({
    ok: true,
    total: tasks.length,
    summary: {
      lastInspected: lastInspected?.finished_at?.slice(0, 10) || null,
      lastPM: lastPM?.finished_at?.slice(0, 10) || null,
      lastClean: lastClean?.finished_at?.slice(0, 10) || null,
      openCount: open.length,
      guestDrivenOpen: open.filter(t => t.guestDriven).length,
    },
    open,
    completed,
  })
}
