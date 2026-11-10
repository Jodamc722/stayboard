// WHICH TASKS ARE LIGHTHOUSE'S OWN — and the one careful way to remove a duplicate of one
// (Jon, 2026-11-09, approving the audit's proposals 2 and 3).
//
// PROOF, NOT A NAME. A task is "ours" only when its id is written down somewhere Lighthouse itself
// wrote it at creation time:
//   pm_schedule.task_id           the preventative ledger (lib/pm-recurrence, Upkeep approve)
//   suggestion_log.accepted[]     a preventative suggestion that was created (lib/suggestions)
//   auto_inspections.task_id      the automatic inspections' exactly-once table
//   task_creations.task_id        the creation log (lib/breezeway recordTaskCreation) — optional,
//                                 the table may not exist yet
// A task a person typed into Breezeway that merely LOOKS like one of ours is never on these lists,
// so it is never cancelled or deleted from a sweep. If the ledgers cannot be read the answer is
// `null` — "unknown" — and every caller treats unknown as "touch nothing".
//
// REMOVING A DUPLICATE. Breezeway accepts a cancel and can leave the task open (verified 2026-11-03),
// so a duplicate Lighthouse made is DELETED — but a delete cannot be taken back, so it asks for more
// than the lists above:
//   • THE CREATION LOG SAYS WE CREATED IT (task_creations, action 'created'). The other ledgers are
//     good enough to scope a cancel but are not strict proof: pm_schedule adopts whatever open task
//     matches a cadence, and auto_inspections keeps "covered by #…" receipts that point at tasks a
//     person filed. Until the task_creations table exists, nothing is ever deleted.
//   • NOBODY HAS TOUCHED IT, on the mirror AND on a fresh read from Breezeway: not started, not
//     finished, no time logged, no assignee progress, no comments.
// Anything else — or a delete that fails — falls back to the existing cancel, which claims nothing
// and can be reopened.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { getSetting } from './app-settings'
import { deleteBreezewayTask, cancelBreezewayTask, retrieveBreezewayTask, listBreezewayComments, recordTaskCreation } from './breezeway'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/**
 * Of `ids`, the ones Lighthouse provably created. `null` = the ledgers could not be read (callers
 * must then do nothing). The optional creation log failing is NOT an error — the table may not exist.
 */
export async function lighthouseCreatedIds(ids: (string | number)[]): Promise<Set<string> | null> {
  const want = Array.from(new Set(ids.map(x => str(x).trim()).filter(Boolean)))
  const ours = new Set<string>()
  if (!want.length) return ours
  const db = supabaseAdmin()
  try {
    for (let i = 0; i < want.length; i += 200) {
      const part = want.slice(i, i + 200)
      const [pm, ai] = await Promise.all([
        db.from('pm_schedule').select('task_id').in('task_id', part),
        db.from('auto_inspections').select('task_id').in('task_id', part),
      ])
      if (pm.error || ai.error) return null
      for (const r of (pm.data || []) as any[]) if (r?.task_id) ours.add(str(r.task_id))
      for (const r of (ai.data || []) as any[]) if (r?.task_id) ours.add(str(r.task_id))
      // Optional: the creation log. Only rows that say WE created it count (a 'reused' row is a task
      // somebody else may have made).
      try {
        const tc = await db.from('task_creations').select('task_id').eq('action', 'created').in('task_id', part)
        if (!tc.error) for (const r of (tc.data || []) as any[]) if (r?.task_id) ours.add(str(r.task_id))
      } catch { /* no table yet */ }
    }
    // The accepted-suggestions log (app_settings). A missing row is an empty log, not an error.
    const log = await getSetting<any>('suggestion_log', null)
    const accepted: any[] = log && Array.isArray(log.accepted) ? log.accepted : []
    const wanted = new Set(want)
    for (const a of accepted) { const id = str(a?.taskId); if (id && wanted.has(id)) ours.add(id) }
  } catch { return null }
  return ours
}

/** Did the creation log record US creating this task? False on any doubt (no table, failed read). */
async function loggedAsCreated(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin().from('task_creations').select('task_id').eq('task_id', id).eq('action', 'created').limit(1)
    return !error && Array.isArray(data) && data.length > 0
  } catch { return false }
}

/** Has anybody touched this task? Read from a Breezeway task object (live) or a mirror row's `raw`. */
function touched(t: any): string | null {
  if (!t || typeof t !== 'object') return 'could not read the task'
  if (t.started_at) return 'it was started'
  if (t.finished_at) return 'it was finished'
  if (t.finished_by && (t.finished_by.id != null || t.finished_by.name)) return 'somebody finished it'
  const tt = str(t.total_time)
  if (tt && /[1-9]/.test(tt)) return 'time is logged on it'
  const st = str(t.type_task_status && typeof t.type_task_status === 'object' ? (t.type_task_status.code || t.type_task_status.name) : (t.type_task_status || t.status)).toLowerCase()
  if (st && !/^(created|scheduled|new|not[_ ]?started|open|assigned)$/.test(st)) return 'its status is "' + st + '"'
  for (const a of (Array.isArray(t.assignments) ? t.assignments : [])) {
    if (!a || typeof a !== 'object') continue
    if (a.started_at || a.finished_at || a.start_time || a.end_time) return 'an assignee has activity on it'
    const us = str(a.type_task_user_status && typeof a.type_task_user_status === 'object' ? (a.type_task_user_status.code || a.type_task_user_status.name) : a.type_task_user_status || a.status).toLowerCase()
    if (us && !/^(created|scheduled|new|not[_ ]?started|open|assigned|pending|invited)$/.test(us)) return 'an assignee has activity on it'
  }
  if (Array.isArray(t.comments) && t.comments.length) return 'it has comments'
  if (Number(t.comment_count) > 0 || Number(t.comments_count) > 0) return 'it has comments'
  return null
}

export type RemoveResult = { ok: boolean; how: 'deleted' | 'cancelled' | 'none'; why: string }

/**
 * Remove ONE duplicate task. `ours` = the caller found the id on Lighthouse's ledgers
 * (lighthouseCreatedIds). Ours AND in the creation log AND untouched → DELETE; anything else, or a
 * failed delete → the existing cancel. Mirrors the result and logs it. Never throws.
 */
export async function removeOwnDuplicate(taskId: string | number, opts: { ours: boolean; source?: string; by?: string } = { ours: false }): Promise<RemoveResult> {
  const id = str(taskId).trim()
  if (!id) return { ok: false, how: 'none', why: 'no task id' }
  const db = supabaseAdmin()
  const cancel = async (why: string): Promise<RemoveResult> => {
    const c = await cancelBreezewayTask(id).catch((e: any) => ({ ok: false, text: str(e?.message || e) } as any))
    if (!c.ok) return { ok: false, how: 'none', why: why + '; cancel failed: ' + str(c.text).slice(0, 120) }
    try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled', synced_at: new Date().toISOString() }).eq('id', id) } catch { /* sync */ }
    await recordTaskCreation({ source: opts.source || 'dedupe', action: 'cancelled', taskId: id, by: opts.by || null })
    return { ok: true, how: 'cancelled', why }
  }
  if (!opts.ours) return cancel('not provably created by Lighthouse')
  try {
    // 0. A delete needs the creation log's word for it (see the header).
    if (!(await loggedAsCreated(id))) return cancel('not in the creation log')
    // 1. What the mirror already shows.
    const { data: row, error } = await db.from('breezeway_tasks_sync').select('id,status,started_at,finished_at,total_time,raw').eq('id', id).maybeSingle()
    if (error) return cancel('the mirror could not be read')
    if (row) {
      const m = touched({ ...(row.raw && typeof row.raw === 'object' ? row.raw : {}), started_at: (row as any).started_at, finished_at: (row as any).finished_at, total_time: (row as any).total_time })
      if (m) return cancel(m)
    }
    // 2. A fresh read from Breezeway — the mirror can be half an hour behind somebody starting it.
    const live = await retrieveBreezewayTask(id)
    const t: any = live.ok && live.data ? (live.data.task || live.data) : null
    if (!t || t.id == null) return cancel('Breezeway did not return the task')
    const l = touched(t)
    if (l) return cancel(l)
    // 3. Comments live on their own endpoint.
    const cm = await listBreezewayComments(id)
    if (!cm.ok) return cancel('its comments could not be read')
    if (cm.comments.length) return cancel('it has comments')
    const d = await deleteBreezewayTask(id)
    if (!d.ok) return cancel('delete refused (' + d.status + ')')
    try { await db.from('breezeway_tasks_sync').delete().eq('id', id) } catch { /* the next sync drops it */ }
    await recordTaskCreation({ source: opts.source || 'dedupe', action: 'cancelled', taskId: id, name: str(t.name), by: opts.by || null })
    return { ok: true, how: 'deleted', why: 'Lighthouse-created duplicate, untouched' }
  } catch (e: any) {
    return cancel('check failed: ' + str(e?.message || e).slice(0, 80))
  }
}
