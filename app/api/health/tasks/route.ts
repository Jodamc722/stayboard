// Pushed-task tracker: lists tasks pushed from the Action Plan and (on ?refresh=1) re-checks
// each open task's live status in Breezeway, flipping completed/approved ones to "action taken".
// Returns a map keyed by `${listing_id}__${issue_title}` for the UI.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, retrieveBreezewayTask, normalizeTaskStatus } from '@/lib/breezeway'
import { requireVrUser } from '@/lib/vr-gate'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res

  const db = supabaseAdmin()
  // Every pushed task, newest first, paged: the map below answers "is this issue already pushed?" and
  // the summary counts them all — the first 1,000 of a .limit(2000) left older pushes out of both.
  // Bounded at 5 pages (a page load); the query's own error keeps its old answer.
  let error: any = null
  const read = await pageRows<any>((a, b) => db.from('breezeway_tasks')
    .select('id, listing_id, issue_title, department, priority, breezeway_task_id, scheduled_date, status, report_url, action_taken_at, created_at')
    .order('created_at', { ascending: false }).order('id').range(a, b)
    .then((r: any) => { if (r.error) error = r.error; return r }), 5)
  if (error) return NextResponse.json({ error: `breezeway_tasks read: ${error.message}. Run migration 009.`, tasks: {} }, { status: 200 })
  if (read.truncated) console.error('[health/tasks] pushed-task read stopped at 5,000 — the oldest pushes are not shown')

  let list = read.rows

  if (new URL(req.url).searchParams.get('refresh') === '1' && breezewayConfigured()) {
    const open = list.filter((r: any) => r.breezeway_task_id && (r.status === 'created' || r.status === 'in_progress')).slice(0, 40)
    for (const r of open) {
      try {
        const res = await retrieveBreezewayTask(r.breezeway_task_id!)
        if (!res.ok) continue
        const st = normalizeTaskStatus(res.data)
        if (st !== r.status) {
          const patch: any = { status: st, updated_at: new Date().toISOString() }
          if ((st === 'completed' || st === 'approved') && !r.action_taken_at) patch.action_taken_at = new Date().toISOString()
          await db.from('breezeway_tasks').update(patch).eq('id', r.id)
          r.status = st; if (patch.action_taken_at) r.action_taken_at = patch.action_taken_at
        }
      } catch { /* skip */ }
    }
  }

  const tasks: Record<string, any> = {}
  for (const r of list) {
    const key = `${r.listing_id}__${r.issue_title}`
    if (!tasks[key]) tasks[key] = { status: r.status, scheduledDate: r.scheduled_date, department: r.department, priority: r.priority, reportUrl: r.report_url, actionTakenAt: r.action_taken_at, taskId: r.breezeway_task_id }
  }
  const done = list.filter((r: any) => r.status === 'completed' || r.status === 'approved').length
  return NextResponse.json({ ok: true, tasks, summary: { total: list.length, open: list.length - done, actionTaken: done } })
}
