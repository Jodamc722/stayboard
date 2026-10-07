// TASKS ADDED FROM BILLABLE HOURS, AND WHAT RIDES ALONG WITH ANY TASK (Jon, 2026-10-07: "add task,
// date them, assign them and add photo directly from here, push to Breezeway and if can't, that's ok
// … I should still be able to create a task, and I should generate an owner-viewable link to the
// task with photos and a description … and I can add a value to it as well").
//
//   LOCAL TASKS  a task Breezeway would not take still exists: it lives here (app_settings
//                'lh_tasks') with an 'lh-' id, is merged into the billing window by lib/billing
//                rangeTasks in the same shape as a mirror row, bills through billing_adjustments
//                like any task, and can be pushed to Breezeway later (its money and photos move
//                to the new Breezeway id).
//   EXTRAS       per task, whatever its source: photos, an owner-facing description, and the
//                owner-link token (app_settings 'task_extras'). The link is /job/<token>.
import 'server-only'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from './supabase-admin'
import { setSetting } from './app-settings'

export type LocalTask = {
  id: string                       // 'lh-…'
  listingId: string; unit: string | null
  name: string; description: string
  department: string
  date: string | null              // YYYY-MM-DD
  assigneeId: number | null; assigneeName: string | null
  createdBy: string; createdAt: string
  pushError: string | null         // why Breezeway said no, last time it was asked
  /** Work that had already happened when it was filed (Jon, 2026-10-07: "it needs to be a
   *  completed task"). A job logged after the fact is finished the moment it is written down —
   *  leaving it 'created' makes the billing desk flag it as unfinished and hold back the money. */
  done?: boolean
  finishedAt?: string | null       // ISO; set when done
}
export type TaskExtra = { photos: string[]; ownerNote?: string | null; token?: string | null; title?: string | null }

async function readKey<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', key).limit(1)
    const raw = (data as any)?.[0]?.value
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    return (j ?? fallback) as T
  } catch { return fallback }
}

export async function readLocalTasks(): Promise<LocalTask[]> {
  const j = await readKey<{ tasks?: LocalTask[] }>('lh_tasks', { tasks: [] })
  return Array.isArray(j?.tasks) ? j.tasks : []
}
export async function writeLocalTasks(tasks: LocalTask[], by: string | null) {
  return setSetting('lh_tasks', { tasks: tasks.slice(-2000) }, by)
}

export async function readExtras(): Promise<Record<string, TaskExtra>> {
  const j = await readKey<{ byTask?: Record<string, TaskExtra> }>('task_extras', { byTask: {} })
  return (j && j.byTask && typeof j.byTask === 'object') ? j.byTask : {}
}
export async function writeExtras(byTask: Record<string, TaskExtra>, by: string | null) {
  return setSetting('task_extras', { byTask }, by)
}
export const newToken = () => randomBytes(9).toString('base64url')

/** The local tasks in a date window, shaped like breezeway_tasks_sync rows (lib/billing MIRROR_COLS). */
export function localAsMirrorRows(tasks: LocalTask[], from: string, to: string): any[] {
  return tasks.filter(t => t.date && t.date >= from && t.date <= to).map(t => ({
    id: t.id, home_id: null, reference_property_id: t.listingId, type_department: t.department,
    name: t.name, status: t.done ? 'finished' : 'created',
    assignees: t.assigneeName ? [{ id: t.assigneeId, name: t.assigneeName }] : [],
    assignee_name: t.assigneeName, finished_by_name: t.done ? t.assigneeName : null,
    finished_at: t.done ? (t.finishedAt || (t.date ? t.date + 'T12:00:00Z' : t.createdAt)) : null, total_minutes: null,
    rate_paid: null, scheduled_date: t.date, report_url: null, descr: t.description,
  }))
}
