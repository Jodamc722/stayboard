// THE LIVE INBOX PULL (Jon, 2026-10-06: "revamp our inbox to be more live and more real raw data").
//
// The inbox used to be exactly as fresh as the guest-comms cron, which runs at :10 and :40 — so a
// guest who wrote at :11 sat invisible for half an hour, and a thread showed whatever our copy said
// rather than what Guesty said. This pulls straight from Guesty while someone has the inbox open:
//
//   1. Guesty's own inbox list, newest first (one call) → upserted into guesty_conversations.
//   2. Every thread whose last message is newer than our copy → its posts pulled from Guesty
//      (syncMessages), so the list line, the waiting set and the open thread are Guesty's words.
//   3. The response-time rows for exactly those threads, so "waiting / late" moves with them.
//
// One pull per ~20 seconds across ALL viewers and all server instances: the last pull is stamped
// in guesty_sync_status ('conversations_live'), and a viewer who arrives inside the window simply
// reads what the last pull wrote. Guesty rate-limits per account; four people with the inbox open
// must not be four times the calls.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { pullConversationsLive, syncMessages } from './guesty'

const MIN_GAP_MS = 20_000
const ENTITY = 'conversations_live'

export type LivePull = { pulledAt: string | null; fresh: boolean; changed: string[]; threads: number; error?: string }

export async function pullInboxLive(opts?: { budgetMs?: number; force?: boolean }): Promise<LivePull> {
  const sb = supabaseAdmin()
  const budget = Math.max(3000, opts?.budgetMs ?? 12_000)
  const started = Date.now()
  const { data: st } = await sb.from('guesty_sync_status').select('last_sync_at').eq('entity', ENTITY).maybeSingle()
  const last = st?.last_sync_at ? Date.parse(String(st.last_sync_at)) : 0
  if (!opts?.force && last && Date.now() - last < MIN_GAP_MS) return { pulledAt: String(st!.last_sync_at), fresh: false, changed: [], threads: 0 }
  // Claim the window before calling Guesty, so a second viewer arriving mid-pull does not start another.
  const claimedAt = new Date().toISOString()
  await sb.from('guesty_sync_status').upsert({ entity: ENTITY, last_sync_at: claimedAt, last_error: null, updated_at: claimedAt })

  try {
    const rows = await pullConversationsLive(50)
    if (!rows.length) return { pulledAt: claimedAt, fresh: true, changed: [], threads: 0 }
    // What did our copy think the newest message was, before this pull?
    const ids = rows.map(r => String(r.id))
    const { data: before } = await sb.from('guesty_conversations').select('id,last_message_at').in('id', ids)
    const had: Record<string, string> = {}
    for (const b of (before || []) as any[]) had[String(b.id)] = String(b.last_message_at || '')
    // Guesty's inbox list carries no message body for most threads; keep the preview we derived from
    // the posts rather than overwriting it with an empty one.
    const { error } = await sb.from('guesty_conversations').upsert(rows.map(r => r.last_message_preview ? r : (({ last_message_preview, ...rest }) => rest)(r)), { onConflict: 'id' })
    if (error) throw new Error('upsert conversations: ' + error.message)

    const moved = rows.filter(r => {
      const now = Date.parse(String(r.last_message_at || '')), was = Date.parse(had[String(r.id)] || '')
      return Number.isFinite(now) && (!Number.isFinite(was) || now > was)
    }).map(r => String(r.id))
    const changed: string[] = []
    for (const id of moved) {
      if (Date.now() - started > budget) break
      try { await syncMessages(id); changed.push(id) } catch (e: any) { if (/rate|429/i.test(String(e?.message || e))) break }
    }
    if (changed.length) {
      try {
        const { refreshConversationStats } = await import('./response-times')
        for (const id of changed.slice(0, 15)) await refreshConversationStats(id)
      } catch { /* the waiting set catches up on the next cron */ }
    }
    return { pulledAt: claimedAt, fresh: true, changed, threads: rows.length }
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200)
    await sb.from('guesty_sync_status').upsert({ entity: ENTITY, last_sync_at: claimedAt, last_error: msg, updated_at: new Date().toISOString() })
    return { pulledAt: claimedAt, fresh: false, changed: [], threads: 0, error: msg }
  }
}

/** One thread, straight from Guesty, at most once per 10 seconds per thread. */
const threadPulledAt = new Map<string, number>()
export async function pullThreadLive(conversationId: string, timeoutMs = 8000): Promise<{ pulled: boolean; error?: string }> {
  const lastAt = threadPulledAt.get(conversationId) || 0
  if (Date.now() - lastAt < 10_000) return { pulled: false }
  threadPulledAt.set(conversationId, Date.now())
  try {
    await Promise.race([syncMessages(conversationId), new Promise((_, rej) => setTimeout(() => rej(new Error('Guesty took too long')), timeoutMs))])
    return { pulled: true }
  } catch (e: any) { return { pulled: false, error: String(e?.message || e).slice(0, 200) } }
}
