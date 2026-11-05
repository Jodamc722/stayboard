// EVE'S CONVERSATIONS, KEPT ON THE SERVER (Jon, 2026-11-05: "EVE chat needs to be a learning chat,
// where we can teach Eve"). A thread used to live only in the browser tab's sessionStorage, so a
// lesson taught on the phone could not be found again on the desk. Now every web turn belongs to an
// eve_conversations row (migration 171) and the chat on /eve lists, resumes and starts them.
//
// FAIL OPEN: before migration 171 runs every function here returns null / [] and the chat works
// exactly as before, just without a history list.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isSuperadmin } from '@/lib/access'
import { scrubStoredText } from './redact'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ConversationRow = { id: string; user_email: string | null; title: string | null; created_at: string; updated_at: string }

function titleOf(q: string): string {
  const t = scrubStoredText(String(q || '')).replace(/\s+/g, ' ').trim()
  return t.length > 80 ? t.slice(0, 77) + '…' : t || 'New conversation'
}

/** May this person read this conversation? Its owner, or Jon. */
export async function conversationFor(id: string, email: string | null | undefined): Promise<ConversationRow | null> {
  if (!UUID.test(String(id || ''))) return null
  try {
    const { data, error } = await supabaseAdmin().from('eve_conversations').select('id,user_email,title,created_at,updated_at').eq('id', id).maybeSingle()
    if (error || !data) return null
    const row = data as ConversationRow
    if (isSuperadmin(email) || String(row.user_email || '').toLowerCase() === String(email || '').toLowerCase()) return row
    return null
  } catch { return null }
}

/**
 * The conversation this turn belongs to: the one asked for if it is the person's own, else a new one
 * titled with the first question. null when the table is not there yet.
 */
export async function ensureConversation(email: string | null | undefined, firstQuestion: string, id?: string | null): Promise<string | null> {
  if (id) {
    const own = await conversationFor(String(id), email)
    if (own) return own.id
  }
  try {
    const { data, error } = await supabaseAdmin().from('eve_conversations')
      .insert({ user_email: email ? String(email).toLowerCase() : null, title: titleOf(firstQuestion) })
      .select('id').maybeSingle()
    if (error || !data) return null
    return String((data as any).id)
  } catch { return null }
}

export async function listConversations(email: string | null | undefined, limit = 50): Promise<{ ok: boolean; conversations: ConversationRow[]; needsMigration?: boolean }> {
  try {
    const { data, error } = await supabaseAdmin().from('eve_conversations').select('id,user_email,title,created_at,updated_at')
      .eq('user_email', String(email || '').toLowerCase()).order('updated_at', { ascending: false }).limit(Math.min(200, Math.max(1, limit)))
    if (error) return { ok: true, conversations: [], needsMigration: true }
    return { ok: true, conversations: (data as ConversationRow[]) || [] }
  } catch { return { ok: true, conversations: [], needsMigration: true } }
}

export type ConversationTurn = { chatId: string; question: string; answer: string; rating: number | null; at: string; tools: string[]; memoryHits: any }

export async function conversationTurns(id: string): Promise<ConversationTurn[]> {
  try {
    const { data, error } = await supabaseAdmin().from('eve_chats').select('id,question,answer,rating,created_at,tools_used,memory_hits')
      .eq('conversation_id', id).order('created_at', { ascending: true }).limit(200)
    if (error) return []
    return ((data as any[]) || []).map(r => ({ chatId: String(r.id), question: String(r.question || ''), answer: String(r.answer || ''), rating: r.rating == null ? null : Number(r.rating), at: String(r.created_at), tools: Array.isArray(r.tools_used) ? r.tools_used : [], memoryHits: r.memory_hits || null }))
  } catch { return [] }
}
