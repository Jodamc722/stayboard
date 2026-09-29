// DRAFT A GUEST REPLY ON DEMAND (2026-09-28 audit, D1 — the Messages reply box's "Draft with Eve").
//
// The same drafting Eve's guest_unanswered_1h watch does (lib/eve/watches.ts): the thread without
// Guesty's internal entries, the booking's facts and the house voice, on the 'guest-reply' model
// tier (lib/ai-models) and billed to that task in the usage ledger. NOTHING IS SENT HERE: the text
// lands in the reply box, a person reads it, edits it and presses Send.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'

// Word for word with GUEST_REPLY_SYSTEM in lib/eve/watches.ts, so a draft reads the same whether
// the watch or a person asked for it.
export const GUEST_REPLY_SYSTEM = `You write short replies to guests of "Stay Hospitality", a short-term-rental manager in South Florida. You are the team ("we"), never "the host". Always English. Two to four sentences, warm and plain, no filler ("we value your feedback", "rest assured"), no emojis. Answer what the guest actually asked from the facts given; if a fact is missing, say a teammate will confirm shortly rather than inventing it. Never promise refunds or discounts. Never include door codes, phone numbers or addresses. Output only the reply text.`

// Guesty files activity logs and internal notes into the same thread. They are not the
// conversation: a note like "owner says no refund" must never be paraphrased to the guest.
const INTERNAL_MODULES = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function draftGuestReply(conversationId: string): Promise<{ ok: boolean; draft?: string; error?: string }> {
  const id = str(conversationId).trim()
  if (!id) return { ok: false, error: 'Which conversation?' }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'AI is not configured.' }
  const db = supabaseAdmin()
  const [{ data: conv }, { data: msgs, error: mErr }] = await Promise.all([
    db.from('guesty_conversations').select('id,reservation_id,channel,guest_name').eq('id', id).maybeSingle(),
    // Read deeper than we show, so a run of internal notes cannot empty the window.
    db.from('guesty_messages').select('sender,body,sent_at,module').eq('conversation_id', id).order('sent_at', { ascending: false }).limit(40),
  ])
  if (mErr) return { ok: false, error: 'Could not read the thread: ' + mErr.message }
  const real = ((msgs as any[]) || [])
    .filter(m => !INTERNAL_MODULES.has(str(m.module).toLowerCase()) && (m.sender === 'guest' || m.sender === 'host') && str(m.body).trim())
    .slice(0, 12).reverse()
  if (!real.length) return { ok: false, error: 'There is nothing in this thread to answer yet.' }

  let res: any = null
  if (conv?.reservation_id) {
    const { data } = await db.from('guesty_reservations').select('guest_name,listing_name,check_in,check_out,nights').eq('id', conv.reservation_id).maybeSingle()
    res = data || null
  }
  const channel = str(conv?.channel)
  const guest = str(res?.guest_name) || str(conv?.guest_name) || 'the guest'
  const facts = res
    ? `Guest: ${guest}. Unit: ${str(res.listing_name)}. Stay: ${str(res.check_in).slice(0, 10)} to ${str(res.check_out).slice(0, 10)} (${res.nights || '?'} nights). Channel: ${channel}.`
    : `Guest: ${guest}. Channel: ${channel}.`
  const thread = real.map(m => `${m.sender === 'guest' ? 'GUEST' : 'US'}: ${str(m.body).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')
  const ask = real[real.length - 1].sender === 'guest'
    ? "Write our reply to the guest's last message."
    : 'We spoke last. Write a short, useful follow-up to the guest only if the thread calls for one.'

  const { modelPairFor } = await import('./ai-models')
  const { anthropicMessages, textOf } = await import('./anthropic-call')
  const { model, fallback } = await modelPairFor('guest-reply')
  const r = await anthropicMessages(key, { model, max_tokens: 400, system: GUEST_REPLY_SYSTEM, messages: [{ role: 'user', content: `${facts}\n\nTHREAD (oldest first):\n${thread}\n\n${ask}` }] }, fallback, 'guest-reply')
  if (!r.ok) {
    console.error('[guest-reply-draft] model call failed', r.status, JSON.stringify(r.data).slice(0, 300))
    return { ok: false, error: `Eve could not draft this just now (${r.status}). Try again, or write it yourself.` }
  }
  const draft = str(textOf(r.data)).trim()
  return draft ? { ok: true, draft } : { ok: false, error: 'Eve came back with nothing to say.' }
}
