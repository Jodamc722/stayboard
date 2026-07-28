// PULL Breezeway task comments back into the app.
// When the field crew replies inside Breezeway, the people talking about that task in StayBoard
// should hear about it. For every task that already has an app thread we fetch the Breezeway
// comments, store any we have not seen as a comment authored by 'breezeway', and notify the
// thread's followers. Runs on the existing 2-hour task-mirror cron — no new infrastructure.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, listBreezewayComments } from '@/lib/breezeway'
import { notify } from '@/lib/notify'

export const BREEZEWAY_AUTHOR = 'breezeway'

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
  const followers: Record<string, Set<string>> = {}
  for (const r of ((rows || []) as any[])) {
    const id = String(r.entity_id || '')
    if (!id || id.startsWith('guesty:')) continue
    if (!followers[id]) { followers[id] = new Set<string>(); seen.push(id) }
    const who = String(r.author_email || '').toLowerCase()
    if (who && who !== BREEZEWAY_AUTHOR) followers[id].add(who)
  }
  const ids = seen.slice(0, maxThreads)
  out.threads = ids.length

  for (const taskId of ids) {
    try {
      const bc = await listBreezewayComments(taskId)
      if (!bc.ok || !bc.comments.length) continue
      const { data: mine } = await db.from('app_comments')
        .select('body').eq('entity_type', 'task').eq('entity_id', taskId).limit(200)
      const have = new Set(((mine || []) as any[]).map(x => String(x.body || '').trim()))
      const fresh = bc.comments.filter(x => {
        const b = x.body.trim()
        if (!b || have.has(b)) return false
        // our own posts land in Breezeway as "name: text" — do not import them back
        return !Array.from(have).some(h => b === h || b.endsWith(': ' + h) || b === 'NOTE: ' + h)
      })
      if (!fresh.length) continue
      const rowsToAdd = fresh.map(x => ({
        entity_type: 'task', entity_id: taskId, author_email: BREEZEWAY_AUTHOR,
        body: x.body.slice(0, 2000), mentions: [],
        created_at: x.at ? new Date(x.at).toISOString() : new Date().toISOString(),
      }))
      const { error } = await db.from('app_comments').insert(rowsToAdd)
      if (error) { out.errors++; continue }
      out.added += rowsToAdd.length
      const to = Array.from(followers[taskId] || [])
      if (to.length) {
        const preview = fresh[0].body.slice(0, 140)
        const r = await notify(to, { kind: 'comment', title: 'Breezeway reply on a task you follow', body: preview, link: '/plan' })
        out.notified += (r && (r as any).sent) || 0
      }
    } catch { out.errors++ }
  }
  return out
}
