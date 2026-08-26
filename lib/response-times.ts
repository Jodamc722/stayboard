// HOW FAST DID WE ACTUALLY ANSWER THE GUEST.
//
// Jon, 2026-08-26, asked Eve to understand "response time". She could not: the number existed in
// exactly one place — a `computeKpis()` closure inside app/messages/page.tsx, recomputed from the
// last 4,000 messages on every page load, never written down, reachable by no tool and no report.
//
// This is that math, moved somewhere both the page and Eve can reach, and materialised per
// conversation so a question about last month does not mean re-reading the message table.
//
// TWO NUMBERS, AND THE GAP BETWEEN THEM IS THE POINT.
//   first_ms       — guest asks, first host reply lands. What the old page measured.
//   human_first_ms — the same, ignoring replies we can prove were automated.
// Guesty fires template messages AS the host. Counting those as "we answered in 40 seconds" is
// how a team congratulates itself on a robot's reflexes. Where we cannot tell (is_automated is
// null, the common case for old rows), human_first_ms is left NULL rather than assumed human:
// an honest gap beats a flattering guess, and the tools say which is which.
//
// A REPLY THAT NEVER CAME IS NOT A FAST REPLY. If the guest speaks again before we do, the clock
// keeps running on the FIRST question — it does not reset — and a thread whose last word is the
// guest's counts as awaiting, never as answered.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { rollupBuilding } from './optimize-score'

export type ConversationResponse = {
  conversation_id: string
  reservation_id: string | null
  listing_id: string | null
  building: string | null
  channel: string | null
  first_ms: number | null
  human_first_ms: number | null
  replies: number
  guest_msgs: number
  awaiting: boolean
  last_guest_at: string | null
  last_host_at: string | null
  last_responder: string | null
}

type Msg = { conversation_id: string; sender: string; sender_name: string | null; sent_at: string; is_automated: boolean | null }

/**
 * Walk one thread in time order and pull out the response facts.
 * Exported so the messages page and any future report share ONE definition of "first response" —
 * two subtly different definitions of the same KPI is how two dashboards end up disagreeing in a
 * meeting.
 */
export function analyseThread(sorted: Msg[]): Omit<ConversationResponse, 'conversation_id' | 'reservation_id' | 'listing_id' | 'building' | 'channel'> {
  let firstMs: number | null = null
  let humanMs: number | null = null
  let replies = 0
  let guestMsgs = 0
  let lastGuestAt: string | null = null
  let lastHostAt: string | null = null
  let lastResponder: string | null = null

  // The open guest question we are still waiting to answer, if any.
  let openGuestAt: number | null = null
  let openGuestIso: string | null = null

  for (const m of sorted) {
    const t = new Date(m.sent_at).getTime()
    if (!Number.isFinite(t)) continue
    if (m.sender === 'guest') {
      guestMsgs++
      lastGuestAt = m.sent_at
      // Only the FIRST unanswered question starts the clock. A guest who follows up twice while
      // waiting has not reset our stopwatch.
      if (openGuestAt === null) { openGuestAt = t; openGuestIso = m.sent_at }
    } else if (m.sender === 'host') {
      replies++
      lastHostAt = m.sent_at
      lastResponder = m.sender_name || 'Team'
      if (openGuestAt !== null) {
        const gap = t - openGuestAt
        if (gap >= 0) {
          if (firstMs === null || gap < firstMs) firstMs = gap
          if (m.is_automated !== true) {
            // Only claim a human number when this reply is not known-automated.
            if (m.is_automated === false && (humanMs === null || gap < humanMs)) humanMs = gap
          }
        }
        openGuestAt = null
        openGuestIso = null
      }
    }
    // 'system' messages are Guesty's own notices. They are neither a question nor an answer.
  }

  return {
    first_ms: firstMs,
    human_first_ms: humanMs,
    replies,
    guest_msgs: guestMsgs,
    awaiting: openGuestAt !== null,
    last_guest_at: lastGuestAt,
    last_host_at: lastHostAt,
    last_responder: lastResponder,
  }
}

/**
 * Recompute and store response stats for conversations that have moved.
 * Called at the end of the guest-comms sync, so the numbers are never more stale than the
 * messages they are made of.
 */
export async function refreshResponseStats(opts: { sinceHours?: number; limit?: number } = {}): Promise<{ conversations: number; written: number; error?: string }> {
  const db = supabaseAdmin()
  const sinceHours = Math.min(Math.max(opts.sinceHours ?? 48, 1), 24 * 90)
  const limit = Math.min(Math.max(opts.limit ?? 400, 1), 2000)
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString()

  try {
    // RULE 2 (lib/eve/ctx.ts): order before limit, always. Unordered paging on PostgREST silently
    // duplicates and skips rows, and a response-time table built on skipped rows is worse than none.
    const { data: convs } = await db.from('guesty_conversations')
      .select('id,reservation_id,listing_id,channel,last_message_at')
      .gte('last_message_at', since)
      .order('last_message_at', { ascending: false })
      .limit(limit)

    const list = (convs as any[]) || []
    if (!list.length) return { conversations: 0, written: 0 }

    // Name/building resolution, once, for the whole batch.
    const meta: Record<string, { name: string; building: string }> = {}
    try {
      const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').order('id')
      for (const l of ((ls as any[]) || [])) {
        meta[String(l.id)] = { name: l.nickname || l.title || '', building: rollupBuilding(String(l.building || ''), l.nickname || l.title || '') }
      }
    } catch { /* building slicing degrades, the numbers do not */ }

    const rows: any[] = []
    // Chunked .in() — PostgREST chokes on very long id lists.
    for (let i = 0; i < list.length; i += 40) {
      const slice = list.slice(i, i + 40)
      const ids = slice.map(c => String(c.id))
      const { data: msgs } = await db.from('guesty_messages')
        .select('conversation_id,sender,sender_name,sent_at,is_automated')
        .in('conversation_id', ids)
        .order('sent_at', { ascending: true })
        .limit(4000)

      const byConv: Record<string, Msg[]> = {}
      for (const m of ((msgs as any[]) || [])) {
        const cid = String(m.conversation_id)
        ;(byConv[cid] = byConv[cid] || []).push(m as Msg)
      }
      for (const c of slice) {
        const cid = String(c.id)
        const thread = byConv[cid]
        if (!thread || !thread.length) continue
        const a = analyseThread(thread)
        const lm = meta[String(c.listing_id)] || null
        rows.push({
          conversation_id: cid,
          reservation_id: c.reservation_id || null,
          listing_id: c.listing_id || null,
          building: lm?.building || null,
          channel: c.channel || null,
          ...a,
          computed_at: new Date().toISOString(),
        })
      }
    }

    if (!rows.length) return { conversations: list.length, written: 0 }
    // Upsert in batches; one oversized payload is how this kind of job starts timing out at 3am.
    let written = 0
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200)
      const { error } = await db.from('conversation_response').upsert(batch, { onConflict: 'conversation_id' })
      if (!error) written += batch.length
    }
    return { conversations: list.length, written }
  } catch (e: any) {
    return { conversations: 0, written: 0, error: String(e?.message || e) }
  }
}

export function fmtDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null
  const m = ms / 60000
  if (m < 1) return `${Math.round(ms / 1000)}s`
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

export function median(list: number[]): number | null {
  const a = list.filter(n => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2)
}
