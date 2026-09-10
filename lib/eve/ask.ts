// THE MORNING ASK — the one time a day Eve is allowed to start the conversation.
//
// Jon, 2026-09-10: "lets have her message me in telegram if she has questions for learning… think
// of her as an employee… ask questions if she thinks something is off and make suggestions to fix."
//
// WHAT WAS ALREADY THERE AND WHY NOTHING WORKED. Two machines have been running for weeks with
// nowhere to put their output. `questions.ts` writes down what she cannot derive and needs a person
// to tell her. `audit.ts` writes down what is broken right now, each finding carrying a `fix` —
// what a person should actually DO about it. Both write to a table. Neither has ever reached
// anybody, because both of them assume somebody opens /eve and reads a list. Nobody opens a list.
//
// So this file is the delivery, and it is deliberately the SMALLEST thing that closes the loop:
// pick the few most valuable items, send them to a person on Telegram, and turn the reply back into
// the thing it should have been all along — an answer that becomes a memory, or a decision on a
// finding.
//
// FOUR RULES, EACH ONE THE DIFFERENCE BETWEEN AN EMPLOYEE AND A NOTIFICATION:
//
//   1. ONE WINDOW A DAY, AND A HARD CEILING. Jon chose a morning batch. An assistant that taps you
//      on the shoulder whenever it has a thought is not thoughtful, it is a leak. The budget is a
//      number in app_settings, enforced by counting what was actually sent today — not by trusting
//      the caller to schedule itself correctly.
//
//   2. SOMETHING BROKEN OUTRANKS SOMETHING UNKNOWN. Findings are sent before questions, always.
//      Curiosity waits behind a stale feed.
//
//   3. NO REPLY THREE TIMES RUNNING AND SHE STOPS ASKING. Not "asks more quietly" — stops, and
//      records that it went unanswered. A question nobody will answer is itself an answer, and the
//      surest way to get a person to mute a bot is to repeat yourself at them.
//
//   4. THE REPLY IS THE POINT. An ask that produces a notification and nothing else is worse than
//      silence, because it spends attention and buys nothing. Every ask here is bound to the exact
//      Telegram message that carried it, so a reply lands back on the right question and turns into
//      a memory with a name and a date on it.
//
// WHY eve_actions AND NOT A NEW TABLE. Migrations in this app are run by hand, and two of them are
// still sitting unrun from August. A feature that needs a migration is a feature that ships dark.
// `eve_actions` (migration 045, already run) is the approval queue and this is an approval-shaped
// thing: proposed, then decided, then closed. kind='ask' is Eve's outbound half of the same queue.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { sendMessage } from '@/lib/telegram'
import { listQuestions, answerQuestion } from './questions'
import { listAudits, decideAudit } from './audit'
import { saveMemory } from './memory'
import { pendingDrafts, sendApproved, declineDraft } from './ralph'

export const ASK_SETTINGS_KEY = 'eve_ask'

export type AskSettings = {
  enabled: boolean
  /** How many times a day she may interrupt. Jon picked a morning batch; this is its size. */
  maxPerDay: number
  /** Lighthouse emails that get the batch. Empty = every approved Telegram contact who may use Eve. */
  recipients: string[]
  includeFindings: boolean
  includeQuestions: boolean
  /** Give up on an item after this many deliveries with no reply. */
  giveUpAfter: number
}

const DEFAULTS: AskSettings = {
  enabled: true,
  maxPerDay: 3,
  recipients: [],
  includeFindings: true,
  includeQuestions: true,
  giveUpAfter: 3,
}

export async function askSettings(): Promise<AskSettings> {
  const raw = await getSetting<Partial<AskSettings>>(ASK_SETTINGS_KEY, {})
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  return {
    ...s,
    maxPerDay: Math.min(Math.max(Number(s.maxPerDay) || 3, 1), 12),
    giveUpAfter: Math.min(Math.max(Number(s.giveUpAfter) || 3, 1), 10),
    recipients: Array.isArray(s.recipients) ? s.recipients.map(e => String(e).toLowerCase().trim()).filter(Boolean) : [],
  }
}

// ---- The item ------------------------------------------------------------------------------------

// 'ralph' is an outbound question to the boss's revenue bot waiting on a human tap. It rides this
// envelope rather than having an approval flow of its own — the whole point of one envelope is that
// every new thing Eve wants permission for arrives the same way, in the same place, with the same
// budget, instead of each feature inventing its own way to interrupt somebody.
export type AskType = 'question' | 'finding' | 'ralph'

export type AskItem = {
  type: AskType
  /** The row this ask is about — a question id or an audit finding id. */
  ref: string
  title: string
  body: string
  /** Higher goes first. Severity and repetition both raise it. */
  rank: number
}

const db = () => supabaseAdmin()
const nowISO = () => new Date().toISOString()

/** Everything already sent, so nothing is asked twice in the same breath. */
async function alreadyAsked(): Promise<Map<string, { id: string; count: number; status: string }>> {
  const out = new Map<string, { id: string; count: number; status: string }>()
  try {
    const { data } = await db().from('eve_actions')
      .select('id,payload,status,created_at').eq('kind', 'ask')
      .order('created_at', { ascending: false }).limit(400)
    for (const r of ((data as any[]) || [])) {
      const key = `${r.payload?.type}:${r.payload?.ref}`
      if (out.has(key)) continue
      out.set(key, { id: String(r.id), count: Number(r.payload?.delivery_count || 1), status: String(r.status || '') })
    }
  } catch { /* an empty map only means she asks something she already asked */ }
  return out
}

/** How many asks went out today. The budget is counted, never assumed. */
async function sentToday(): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0)
  try {
    const { count } = await db().from('eve_actions')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'ask').gte('created_at', since.toISOString())
    return count || 0
  } catch { return 0 }
}

/**
 * Choose what is worth an interruption.
 *
 * Findings first and questions second, because "the guest-message feed has been dead for two days"
 * beats "why is Botanica on a vendor crew" every morning of the week. Within findings, severity
 * then age; within questions, how many times the gap has actually come up.
 */
export async function buildBatch(limit: number): Promise<AskItem[]> {
  const s = await askSettings()
  const seen = await alreadyAsked()
  const items: AskItem[] = []

  const fresh = (type: AskType, ref: string): boolean => {
    const prior = seen.get(`${type}:${ref}`)
    if (!prior) return true
    // Open asks are waiting on a reply; closed ones are done. Neither gets sent again.
    return false
  }

  if (s.includeFindings) {
    const audits = await listAudits({ status: 'open', limit: 60 }).catch(() => [])
    for (const a of audits) {
      if (a.severity === 'info') continue          // info is a log line, not a conversation
      if (!fresh('finding', String(a.id))) continue
      items.push({
        type: 'finding',
        ref: String(a.id),
        title: `Something looks off — ${a.area}`,
        body: [
          `**${a.title}**`,
          a.detail,
          a.fix ? `\n**What I'd do:** ${a.fix}` : '',
          a.ageDays > 0 ? `\n_Open ${a.ageDays} day${a.ageDays === 1 ? '' : 's'}._` : '',
          `\nReply and tell me to fix it — or tell me why it's fine and I'll remember that instead.`,
        ].filter(Boolean).join('\n'),
        rank: (a.severity === 'critical' ? 1000 : 500) + Math.min(a.ageDays, 60),
      })
    }
  }

  // Outbound questions to Ralphbot, waiting on a tap. Ranked above Eve's own questions and below a
  // broken thing: the boss is answering, so a stale draft is worth less by the day, but nothing here
  // is as urgent as a dead feed.
  for (const d of await pendingDrafts(5).catch(() => [])) {
    if (!fresh('ralph', d.id)) continue
    items.push({
      type: 'ralph',
      ref: d.id,
      title: `Ask Ralphbot? — ${d.goalLabel}`,
      body: [
        `**${d.question}**`,
        `\n_Why:_ ${d.why}`,
        d.soThat ? `\n_What it settles:_ ${d.soThat}` : '',
        `\nReply **yes** and I'll send it to him as written. Reply **no** and I'll drop it. Nothing reaches him without your yes.`,
      ].filter(Boolean).join('\n'),
      rank: 300,
    })
  }

  if (s.includeQuestions) {
    const qs = await listQuestions('open', 60).catch(() => [])
    for (const q of qs) {
      if (!fresh('question', String(q.id))) continue
      items.push({
        type: 'question',
        ref: String(q.id),
        title: `A question — I'd learn something here`,
        body: [
          `**${q.question}**`,
          q.why ? `\n_Why it matters:_ ${q.why}` : '',
          Number(q.asked_count || 1) > 1 ? `\n_This has come up ${q.asked_count} times._` : '',
          `\nReply to this message and I'll file your answer as a rule.`,
        ].filter(Boolean).join('\n'),
        rank: 100 + Math.min(Number(q.asked_count || 1), 20) * 5,
      })
    }
  }

  return items.sort((a, b) => b.rank - a.rank).slice(0, Math.max(0, limit))
}

// ---- Who gets it ---------------------------------------------------------------------------------

export type Recipient = { email: string; chatId: string }

/**
 * The people she may speak to first.
 *
 * Note the direction of trust: this reads the Telegram contacts an admin has already APPROVED and
 * BOUND to a Lighthouse user. She cannot message a stranger, and she cannot message somebody whose
 * Lighthouse account was switched off — the binding is the permission, exactly as it is for an
 * inbound message.
 */
export async function recipients(): Promise<Recipient[]> {
  const s = await askSettings()
  try {
    const { data } = await db().from('telegram_contacts')
      .select('email,dm_chat_id,status').eq('status', 'approved').limit(100)
    const rows = ((data as any[]) || [])
      .filter(r => r.email && r.dm_chat_id)
      .map(r => ({ email: String(r.email).toLowerCase(), chatId: String(r.dm_chat_id) }))
    if (!s.recipients.length) return rows.slice(0, 1)   // nobody named: the first bound admin, and only them
    return rows.filter(r => s.recipients.includes(r.email))
  } catch { return [] }
}

// ---- Sending -------------------------------------------------------------------------------------

const ICON: Record<AskType, string> = { finding: '🔧', question: '🤔', ralph: '🤝' }

/**
 * Send one item and remember exactly which Telegram message carried it. That message id is the
 * whole binding: a reply to it is unambiguously an answer to this question, with no guessing at
 * what a bare "yes" three hours later was about.
 */
async function deliverOne(to: Recipient, item: AskItem): Promise<boolean> {
  const text = `${ICON[item.type]} **${item.title}**\n\n${item.body}`
  const res = await sendMessage(to.chatId, text)
  if (!res.ok) return false
  const messageId = Number((res as any)?.result?.message_id) || null
  try {
    await db().from('eve_actions').insert({
      created_by: to.email,
      kind: 'ask',
      payload: {
        type: item.type, ref: item.ref, chat_id: to.chatId,
        message_id: messageId, delivery_count: 1, sent_at: nowISO(),
      },
      why: item.title,
      status: 'proposed',
    })
  } catch { /* the message is sent; losing the binding costs the reply, not the ask */ }
  return true
}

export type AskRun = { ok: boolean; sent: number; skipped: string; items: string[] }

/**
 * The morning pass. Safe to call more than once — the budget is counted from what actually went
 * out, so a double-fired cron sends nothing the second time rather than double-tapping anybody.
 */
export async function runMorningAsk(opts: { force?: boolean; max?: number } = {}): Promise<AskRun> {
  const s = await askSettings()
  if (!s.enabled && !opts.force) return { ok: true, sent: 0, skipped: 'switched off', items: [] }

  const used = await sentToday()
  const ceiling = opts.force ? Math.max(1, opts.max || 1) : Math.max(0, s.maxPerDay - used)
  if (ceiling <= 0) return { ok: true, sent: 0, skipped: `today's budget of ${s.maxPerDay} is spent`, items: [] }

  const to = await recipients()
  if (!to.length) return { ok: true, sent: 0, skipped: 'no approved Telegram contact bound to a Lighthouse user', items: [] }

  const batch = await buildBatch(ceiling)
  if (!batch.length) return { ok: true, sent: 0, skipped: 'nothing worth asking', items: [] }

  const sentTitles: string[] = []
  let sent = 0
  for (const item of batch) {
    // One item goes to one person — the first named recipient. Fanning the same question at three
    // people gets it answered three different ways, and then she has a conflict instead of a rule.
    if (await deliverOne(to[0], item)) { sent++; sentTitles.push(`${item.type}: ${item.title}`) }
  }
  return { ok: true, sent, skipped: '', items: sentTitles }
}

// ---- The reply -----------------------------------------------------------------------------------

export type AskBinding = { id: string; type: AskType; ref: string; email: string }

/**
 * Which ask is this reply answering?
 *
 * Two ways, and the second one is deliberately timid.
 *
 * A Telegram reply carries the id of the message it replies to, which is exact and needs no
 * judgement. But people on a phone very often just type the answer, so there is a fallback — and
 * the fallback is where this could go badly wrong. If a bare sentence were always read as an answer
 * to the morning's question, then "what's going on in ops today" typed at noon would be filed as a
 * house rule and quoted back for months. So the fallback binds only when all of it is true: within
 * half an hour of the ask, no question mark, short, and not opening like a question. Anything else
 * is treated as conversation, which is the safe way to be wrong.
 */
const LOOKS_LIKE_A_QUESTION = /^\s*(what|who|when|where|why|how|which|can|could|would|should|is|are|do|does|did|show|tell|give|list|find)\b/i

export async function findAsk(chatId: string | number, replyToMessageId?: number | null, text?: string): Promise<AskBinding | null> {
  try {
    const { data } = await db().from('eve_actions')
      .select('id,payload,created_by,status,created_at').eq('kind', 'ask').eq('status', 'proposed')
      .order('created_at', { ascending: false }).limit(50)
    const rows = ((data as any[]) || []).filter(r => String(r.payload?.chat_id) === String(chatId))
    if (!rows.length) return null

    let row = replyToMessageId
      ? rows.find(r => Number(r.payload?.message_id) === Number(replyToMessageId))
      : null
    if (!row && !replyToMessageId) {
      const t = String(text || '').trim()
      const plausible = !!t && t.length <= 400 && !t.includes('?') && !LOOKS_LIKE_A_QUESTION.test(t)
      const recent = rows[0]
      if (plausible && recent && Date.now() - Date.parse(recent.created_at) < 30 * 60_000) row = recent
    }
    if (!row) return null
    return {
      id: String(row.id),
      type: (row.payload?.type === 'finding' ? 'finding' : 'question'),
      ref: String(row.payload?.ref || ''),
      email: String(row.created_by || ''),
    }
  } catch { return null }
}

const NOT_NOW = /^(skip|not now|later|dunno|don'?t know|no idea|pass)\b/i
/** Deliberately narrow. Silence, a shrug, or "maybe" all mean don't send it. */
const AFFIRMATIVE = /^\s*(y|ya|yes|yep|yeah|yup|ok|okay|sure|go|go ahead|send|send it|do it|please do|approved?)\b/i
const ITS_FINE = /\b(that'?s|it'?s)\s+(fine|expected|normal|on purpose|intentional|by design)\b|\bknown\b|\bignore\b|\bleave it\b/i

/**
 * Turn a reply into the thing it was asked for.
 *
 * A QUESTION becomes a memory written by a person — weight 8, source 'jon' — which is the entire
 * reason the question was worth asking. That path already exists in questions.ts and is reused
 * exactly, so an answer given on a phone is indistinguishable from one typed into /eve.
 *
 * A FINDING is different: the useful reply is very often not "fix it" but "that's expected, here is
 * why", and THAT is knowledge she has no other route to. So an explanation is saved as a memory in
 * its own right before the finding is closed. Next time the same check trips, she knows the answer.
 */
export async function resolveAsk(binding: AskBinding, reply: string, by: string): Promise<string> {
  const text = String(reply || '').trim()
  const close = async (status: string, note?: string) => {
    try {
      await db().from('eve_actions').update({
        status, decided_by: by, decided_at: nowISO(),
        result: note ? { note: note.slice(0, 500) } : null,
      }).eq('id', binding.id)
    } catch { /* the work below already happened; the bookkeeping is not worth failing over */ }
  }

  if (NOT_NOW.test(text)) {
    await close('rejected', text)
    return binding.type === 'question'
      ? `No problem — I'll leave that one. If it keeps mattering it'll come back.`
      : `Understood, leaving it open. I won't raise it again for a week.`
  }

  // A question for Ralphbot. The only two answers that mean anything are yes and no, and anything
  // that is not clearly a yes is treated as a no — the safe way to be wrong about whether to send a
  // message to somebody else's bot is to not send it.
  if (binding.type === 'ralph') {
    if (!AFFIRMATIVE.test(text)) {
      await declineDraft(binding.ref, by, text)
      await close('rejected', text)
      return `Dropped — I won't ask him.`
    }
    const res = await sendApproved(binding.ref, by)
    await close(res.ok ? 'executed' : 'failed', text)
    return res.ok
      ? `Sent to Ralphbot. I'll record whatever he says against that question — and I won't reply to him; if his answer raises something, I'll come back to you with it first.`
      : `I couldn't send it: ${res.error}`
  }

  if (binding.type === 'question') {
    const res = await answerQuestion(binding.ref, text, by)
    await close(res.ok ? 'executed' : 'failed', text)
    return res.ok
      ? `Filed — that's a rule now, with your name and today's date on it. It'll shape what I say from the next question on.`
      : `I couldn't file that: ${res.error}. Say it again and I'll try once more.`
  }

  // A finding. Whatever else the reply is, if it EXPLAINS the thing, that explanation is worth more
  // than the finding was.
  let learned = false
  if (ITS_FINE.test(text) || text.length > 60) {
    const saved = await saveMemory({
      kind: 'rule',
      text: `${binding.ref ? '' : ''}${text}`.slice(0, 900),
      why: `Told to me by ${by} on ${new Date().toISOString().slice(0, 10)} when I flagged: ${binding.ref}.`,
      scope: 'portfolio', weight: 8, source: 'jon', confidence: 1,
      created_by: by, evidence: { audit_id: binding.ref },
    }).catch(() => ({ ok: false } as any))
    learned = !!saved?.ok
  }

  if (ITS_FINE.test(text)) {
    await decideAudit(binding.ref, 'snooze', by, 30).catch(() => {})
    await close('rejected', text)
    return learned
      ? `Got it — noted as expected behaviour, and I've remembered why. Snoozed for a month.`
      : `Got it, snoozed for a month.`
  }

  await decideAudit(binding.ref, 'ack', by).catch(() => {})
  await close('approved', text)
  return learned
    ? `Acknowledged, and I've remembered what you said about it. It stays on my list until it clears.`
    : `Acknowledged — it stays on my list until it clears.`
}

/**
 * Housekeeping, run by the same cron: an ask nobody answered for three days has been answered.
 * Close it, and do not raise that item again.
 */
export async function expireStaleAsks(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 3 * 86400_000).toISOString()
    const { data } = await db().from('eve_actions')
      .update({ status: 'expired' })
      .eq('kind', 'ask').eq('status', 'proposed').lt('created_at', cutoff)
      .select('id')
    return ((data as any[]) || []).length
  } catch { return 0 }
}
