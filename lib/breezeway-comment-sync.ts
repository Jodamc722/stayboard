// PULL Breezeway task comments back into the app.
// When the field crew replies inside Breezeway, the people talking about that task in StayBoard
// should hear about it. For every task that already has an app thread we fetch the Breezeway
// comments, store any we have not seen as a comment authored by 'breezeway', and notify the
// thread's followers. Runs on the existing 2-hour task-mirror cron — no new infrastructure.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, listBreezewayComments } from '@/lib/breezeway'
import { notify } from '@/lib/notify'

export const BREEZEWAY_AUTHOR = 'breezeway'

/**
 * Import one task's Breezeway comments into the app thread, right now.
 *
 * The cron below runs every 15 minutes, which is fine for notifications but far too slow when
 * somebody has the thread OPEN and is waiting on the crew. /api/comments calls this on every read,
 * so opening a task shows the crew's reply the moment it exists. Pass `comments` when the caller
 * has already fetched the thread so this costs no extra Breezeway call.
 */
export async function importTaskComments(
  taskId: string,
  comments?: { id: string; body: string; at: string }[],
): Promise<{ added: number; notified: number }> {
  const out = { added: 0, notified: 0 }
  if (!taskId || taskId.startsWith('guesty:')) return out
  const db = supabaseAdmin()
  let list = comments
  if (!list) {
    if (!breezewayConfigured()) return out
    const bc = await listBreezewayComments(taskId)
    if (!bc.ok) return out
    list = bc.comments
  }
  if (!list.length) return out
  const { data: mine } = await db.from('app_comments')
    .select('body, author_email').eq('entity_type', 'task').eq('entity_id', taskId).limit(200)
  const rows = ((mine || []) as any[])
  if (!rows.length) return out   // nobody in the app is talking about this task yet
  const have = new Set(rows.map(x => String(x.body || '').trim()))
  const fresh = list.filter(x => {
    const b = x.body.trim()
    if (!b || have.has(b)) return false
    // our own posts land in Breezeway as "name: text" — do not import them back
    return !Array.from(have).some(h => b === h || b.endsWith(': ' + h) || b === 'NOTE: ' + h)
  })
  if (!fresh.length) return out
  const { error } = await db.from('app_comments').insert(fresh.map(x => ({
    entity_type: 'task', entity_id: taskId, author_email: BREEZEWAY_AUTHOR,
    body: x.body.slice(0, 2000), mentions: [],
    created_at: x.at ? new Date(x.at).toISOString() : new Date().toISOString(),
  })))
  if (error) return out
  out.added = fresh.length
  const followers = Array.from(new Set(rows.map(x => String(x.author_email || '').toLowerCase())))
    .filter(e => e && e !== BREEZEWAY_AUTHOR)
  if (followers.length) {
    const r = await notify(followers, { kind: 'comment', title: 'Breezeway reply on a task you follow', body: fresh[0].body.slice(0, 140), link: '/plan' })
    out.notified = (r && (r as any).sent) || 0
  }
  return out
}

export async function syncBreezewayComments(maxThreads = 120): Promise<{ threads: number; added: number; notified: number; errors: number }> {
  const out = { threads: 0, added: 0, notified: 0, errors: 0 }
  if (!breezewayConfigured()) return out
  const db = supabaseAdmin()

  // Only threads that exist in the app (someone is actually talking about this task), newest first.
  const { data: rows } = await db.from('app_comments')
    .select('entity_id, created_at, author_email')
    .eq('entity_type', 'task')
    .order('created_at', { ascending: false })
    .limit(1500)
  const seen: string[] = []
  for (const r of ((rows || []) as any[])) {
    const id = String(r.entity_id || '')
    if (!id || id.startsWith('guesty:')) continue
    if (seen.indexOf(id) < 0) seen.push(id)
  }
  const ids = seen.slice(0, maxThreads)
  out.threads = ids.length

  for (const taskId of ids) {
    // ONE importer, shared with /api/comments — the background sweep and the live read can never
    // dedupe differently or notify different people.
    try {
      const r = await importTaskComments(taskId)
      out.added += r.added
      out.notified += r.notified
    } catch { out.errors++ }
  }
  return out
}
