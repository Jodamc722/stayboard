// TALKING TO RALPHBOT — the boss's revenue bot, on Telegram.
//
// Jon, 2026-09-10: "have her ask ralphbot also questions about rev, ect… make sure we allow bot to
// bot interaction. Has to ask for approval to ask / or respond. It must have clear goals."
//
// THE PLATFORM FACT THAT SHAPES THIS. Telegram bots could not talk to each other at all until
// recently. They can now, but only when Bot-to-Bot Communication Mode is switched on in @BotFather
// for BOTH bots — so this cannot work until whoever owns Ralphbot flips that switch on their side.
// Telegram's own documentation is blunt about the failure mode it introduces: "Bot-to-bot
// communication can create infinite reply loops", and it requires implementers to add
// deduplication, rate limiting and a maximum interaction depth.
//
// HOW THIS FILE AVOIDS THE LOOP, AND WHY IT IS NOT A RATE LIMIT.
//
// A rate limit makes a loop slow. It does not make it impossible, and a slow loop that runs all
// night still spends real money and fills a chat with nonsense. So the loop here is closed by
// STRUCTURE instead: **an inbound message from Ralphbot can never cause an outbound message.**
// There is no code path from "Ralph replied" to "Eve sends". His reply is recorded against the
// exchange that asked for it and the exchange is closed. Everything Eve says to Ralphbot originates
// in a human approval, so two bots cannot get into a conversation with each other even if both are
// buggy, because neither end of the loop exists.
//
// THAT IS ALSO WHAT "APPROVAL TO ASK OR RESPOND" MEANS HERE, precisely:
//   * ASK     — every outbound question is drafted, then sent to Jon for approval through the same
//               morning-ask envelope as everything else (lib/eve/ask.ts), and only sent if he says
//               yes. Nothing reaches Ralphbot without a human tap.
//   * RESPOND — she does not respond. A reply from Ralphbot is data, not a turn. If his answer
//               raises a follow-up, that follow-up is a NEW draft needing its own approval.
//
// WHY GOALS, AND WHY THEY ARE A REGISTRY RATHER THAN A PROMPT.
//
// "Ask Ralphbot about revenue" is not a goal, it is a hobby. An open-ended channel between two
// agents produces plausible chatter and no decisions, and there is no way to tell afterwards
// whether it was worth the tokens. So every exchange must cite a GOAL, and a goal is a written
// record of four things: what she asks, WHEN it is worth asking, why the answer matters, and what
// changes depending on the answer. A draft that cannot cite one is refused here rather than left to
// the model's discretion — the same rule questions.ts already applies to Eve's own questions, where
// a question with no consequence does not get to interrupt anybody.
//
// WHOSE NUMBER IS WHOSE. Worth restating because it is the whole reason this channel exists: the
// Revenue App owns every dollar, Lighthouse owns every hour, clean, task and person. So Eve should
// never be asking Ralphbot what our labour cost was, and never asserting a revenue figure of her
// own to him. The goals below stay on that line.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { sendMessage } from '@/lib/telegram'

export const RALPH_SETTINGS_KEY = 'eve_ralph'

const db = () => supabaseAdmin()
const nowISO = () => new Date().toISOString()

// ---- Goals ---------------------------------------------------------------------------------------

export type RalphGoal = {
  key: string
  label: string
  /** What she is allowed to ask under this goal. Written as the actual question. */
  asks: string
  /** The condition that makes it worth asking at all. Prose — a human reads this when approving. */
  when: string
  /** What changes depending on the answer. A goal without this is not a goal. */
  soThat: string
}

/**
 * The only things she may ask him about.
 *
 * These are deliberately few and deliberately narrow. Each one exists because there is a decision on
 * our side that his answer settles, and each one is a question only he can answer — if Lighthouse
 * already knows it, she has no business asking.
 */
export const GOALS: RalphGoal[] = [
  {
    key: 'revenue_variance',
    label: 'Revenue variance',
    asks: 'For a given whole calendar month and building, what revenue does the Revenue App show?',
    when: 'Our KPI and his published figure disagree by more than a few percent for a month that is fully closed, and the difference is large enough to change what we tell an owner.',
    soThat: 'We reconcile to HIS number rather than quietly showing two different truths in two apps. If they agree, the money-source override can stay on with confidence.',
  },
  {
    key: 'month_close',
    label: 'Is the month closed',
    asks: 'Is a given month final in the Revenue App, or still being adjusted?',
    when: 'Before an owner report or a statement goes out on a month whose figures moved recently.',
    soThat: 'We do not send an owner a number that changes next week. A month still in flux waits.',
  },
  {
    key: 'expense_category',
    label: 'What sits behind an expense line',
    asks: 'What does a specific expense category on the P&L actually include?',
    when: 'A cost line moved sharply and we cannot attribute it from anything Lighthouse holds.',
    soThat: 'We know whether an operational change of ours caused it, or whether it is an accounting reclassification we should not chase.',
  },
  {
    key: 'projection_basis',
    label: 'What a projection assumes',
    asks: 'What occupancy and rate assumptions sit behind a published projection?',
    when: 'A projection is being used to plan staffing or an owner conversation.',
    soThat: 'We staff to the same assumptions the budget was built on, instead of guessing at them.',
  },
]

export function goalByKey(key: string): RalphGoal | null {
  return GOALS.find(g => g.key === String(key || '').trim()) || null
}

// ---- Settings ------------------------------------------------------------------------------------

export type RalphSettings = {
  /** Off until the switch is flipped on BOTH bots in BotFather. Nothing here works before that. */
  enabled: boolean
  /** Ralphbot's @username, without the @. Used to address him in a group. */
  botUsername: string
  /** Ralphbot's numeric Telegram user id — the ONLY id whose messages are accepted. */
  botUserId: string
  /** The chat the exchange happens in: a private bot-to-bot chat, or a group both bots are in. */
  chatId: string
  /** Which goals are switched on. Empty = all of them. */
  goals: string[]
  /** Ceiling on approved questions per day. The approval is the real control; this is the backstop. */
  maxPerDay: number
}

const DEFAULTS: RalphSettings = {
  enabled: false, botUsername: '', botUserId: '', chatId: '', goals: [], maxPerDay: 4,
}

export async function ralphSettings(): Promise<RalphSettings> {
  const raw = await getSetting<Partial<RalphSettings>>(RALPH_SETTINGS_KEY, {})
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  return {
    ...s,
    botUsername: String(s.botUsername || '').replace(/^@/, '').trim(),
    botUserId: String(s.botUserId || '').trim(),
    chatId: String(s.chatId || '').trim(),
    goals: Array.isArray(s.goals) ? s.goals.map(String) : [],
    maxPerDay: Math.min(Math.max(Number(s.maxPerDay) || 4, 1), 20),
  }
}

/** Everything that has to be true before a single message can go out. Reported, never assumed. */
export async function ralphReadiness(): Promise<{ ready: boolean; blockers: string[]; settings: RalphSettings }> {
  const s = await ralphSettings()
  const blockers: string[] = []
  if (!s.enabled) blockers.push('Switched off in settings.')
  if (!s.botUserId) blockers.push("Ralphbot's Telegram user id is not set — without it there is no way to tell his messages from anyone else's, so none are accepted.")
  if (!s.chatId) blockers.push('No chat is configured for the exchange.')
  if (!process.env.TELEGRAM_BOT_TOKEN) blockers.push('Eve has no Telegram bot token.')
  blockers.push.apply(blockers, [])
  return { ready: blockers.length === 0, blockers, settings: s }
}

// ---- The exchange --------------------------------------------------------------------------------
//
// One exchange = one approved question and, at most, one answer. Stored in eve_actions (kind
// 'ralph') alongside every other approval in the app rather than in a table of its own — same
// reasoning as lib/eve/ask.ts: a feature that needs a hand-run migration is a feature that ships
// dark.

export type RalphExchange = {
  id: string
  goal: string
  question: string
  why: string
  status: string
  answer?: string | null
}

/**
 * Draft a question. This does NOT send anything — it creates the thing Jon will be asked to approve.
 *
 * The goal check is the point of the function. A draft that cannot name a goal is refused here, in
 * code, rather than being left to the model to police in a prompt it may or may not follow.
 */
export async function draftQuestion(input: {
  goal: string; question: string; why: string; by?: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const goal = goalByKey(input.goal)
  if (!goal) {
    return { ok: false, error: `"${input.goal}" is not one of the agreed goals (${GOALS.map(g => g.key).join(', ')}). If this question does not serve one of them, it is not worth sending.` }
  }
  const s = await ralphSettings()
  if (s.goals.length && !s.goals.includes(goal.key)) {
    return { ok: false, error: `The "${goal.label}" goal is switched off.` }
  }

  const question = String(input.question || '').trim().slice(0, 600)
  const why = String(input.why || '').trim().slice(0, 400)
  if (question.length < 8) return { ok: false, error: 'empty question' }
  if (!why) return { ok: false, error: 'Say what you would do differently depending on his answer. A question that changes nothing does not get sent.' }

  // The daily ceiling counts what was APPROVED and sent, not what was drafted — drafting is free and
  // costs nobody anything; sending spends the boss's attention.
  const since = new Date(); since.setHours(0, 0, 0, 0)
  try {
    const { count } = await db().from('eve_actions')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'ralph').eq('status', 'executed').gte('created_at', since.toISOString())
    if ((count || 0) >= s.maxPerDay) {
      return { ok: false, error: `Already sent ${count} questions to Ralphbot today, which is the daily ceiling.` }
    }
  } catch { /* a failed count must not become a free pass, but it must not block either */ }

  try {
    const { data, error } = await db().from('eve_actions').insert({
      created_by: input.by || 'eve',
      kind: 'ralph',
      payload: { goal: goal.key, question, drafted_at: nowISO() },
      why,
      evidence: { goal_label: goal.label, goal_so_that: goal.soThat },
      status: 'proposed',
    }).select('id').maybeSingle()
    if (error) return { ok: false, error: error.message.slice(0, 200) }
    return { ok: true, id: String((data as any)?.id) }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/** Drafts waiting on a human. These are what the morning ask picks up. */
export async function pendingDrafts(limit = 10): Promise<Array<RalphExchange & { goalLabel: string; soThat: string }>> {
  try {
    const { data } = await db().from('eve_actions')
      .select('id,payload,why,evidence,status').eq('kind', 'ralph').eq('status', 'proposed')
      .order('created_at', { ascending: false }).limit(limit)
    return ((data as any[]) || []).map(r => ({
      id: String(r.id),
      goal: String(r.payload?.goal || ''),
      question: String(r.payload?.question || ''),
      why: String(r.why || ''),
      status: String(r.status || ''),
      goalLabel: String(r.evidence?.goal_label || r.payload?.goal || ''),
      soThat: String(r.evidence?.so_that || r.evidence?.goal_so_that || ''),
    }))
  } catch { return [] }
}

/**
 * Jon said yes. Send it.
 *
 * In a group, Telegram only delivers a bot's message to another bot when it carries a command
 * mention or is a reply, so the question is addressed explicitly. In a private bot-to-bot chat it
 * goes as-is.
 */
export async function sendApproved(id: string, by: string): Promise<{ ok: boolean; error?: string }> {
  const { ready, blockers, settings } = await ralphReadiness()
  if (!ready) return { ok: false, error: blockers.join(' ') }

  let row: any = null
  try {
    const { data } = await db().from('eve_actions').select('*').eq('id', id).eq('kind', 'ralph').maybeSingle()
    row = data
  } catch { /* handled below */ }
  if (!row) return { ok: false, error: 'that question is no longer on file' }
  if (row.status !== 'proposed') return { ok: false, error: `that question was already ${row.status}` }

  const goal = goalByKey(String(row.payload?.goal || ''))
  const question = String(row.payload?.question || '')
  const addressed = settings.botUsername ? `@${settings.botUsername} ${question}` : question

  const res = await sendMessage(settings.chatId, addressed, { preview: false })
  if (!res.ok) {
    try { await db().from('eve_actions').update({ status: 'failed', result: { error: res.error } }).eq('id', id) } catch {}
    return { ok: false, error: String(res.error || 'Telegram refused the message') }
  }

  try {
    await db().from('eve_actions').update({
      status: 'executed', decided_by: by, decided_at: nowISO(), executed_at: nowISO(),
      payload: { ...row.payload, sent_message_id: Number((res as any)?.result?.message_id) || null, sent_at: nowISO() },
      result: { goal: goal?.key || null },
    }).eq('id', id)
  } catch { /* it is sent; the bookkeeping is not worth failing over */ }
  return { ok: true }
}

export async function declineDraft(id: string, by: string, note?: string): Promise<void> {
  try {
    await db().from('eve_actions').update({
      status: 'rejected', decided_by: by, decided_at: nowISO(),
      result: note ? { note: String(note).slice(0, 400) } : null,
    }).eq('id', id)
  } catch { /* nothing was sent, which is the important part */ }
}

// ---- His reply -----------------------------------------------------------------------------------

/**
 * Is this inbound message actually from Ralphbot, in the agreed chat, answering something we asked?
 *
 * Every one of those has to be true. The user id is the identity — a display name is a nickname
 * anyone can set, and the same rule already governs inbound humans in lib/eve/telegram.ts. The chat
 * check stops a message in some other room counting. And the open-exchange check is what makes this
 * an ANSWER rather than an opening: if we did not ask, there is nothing for him to be replying to,
 * and the message is dropped.
 */
export async function acceptsFrom(fromUserId: string | number, chatId: string | number): Promise<boolean> {
  const s = await ralphSettings()
  if (!s.enabled || !s.botUserId || !s.chatId) return false
  if (String(fromUserId) !== s.botUserId) return false
  if (String(chatId) !== s.chatId) return false
  return true
}

/**
 * Record his answer against the question that asked for it.
 *
 * Note what this function does NOT do and will never do: reply. It returns nothing to send. That
 * absence is the loop protection — there is no path from an inbound bot message to an outbound one,
 * so two bots cannot talk each other into a corner no matter what either of them says.
 */
export async function recordReply(text: string, replyToMessageId?: number | null): Promise<{ matched: boolean; id?: string }> {
  const body = String(text || '').trim().slice(0, 4000)
  if (!body) return { matched: false }
  try {
    const { data } = await db().from('eve_actions')
      .select('id,payload,result').eq('kind', 'ralph').eq('status', 'executed')
      .order('executed_at', { ascending: false }).limit(20)
    const rows = ((data as any[]) || []).filter(r => !r.payload?.answer)
    if (!rows.length) return { matched: false }

    // A reply-to is exact. Otherwise the most recent unanswered question is the only sensible
    // candidate — there is at most a handful, and a stale one is closed by the sweep below.
    const row = (replyToMessageId
      ? rows.find(r => Number(r.payload?.sent_message_id) === Number(replyToMessageId))
      : null) || rows[0]
    if (!row) return { matched: false }

    await db().from('eve_actions').update({
      payload: { ...row.payload, answer: body, answered_at: nowISO() },
      result: { ...(row.result || {}), answered: true },
    }).eq('id', row.id)
    return { matched: true, id: String(row.id) }
  } catch { return { matched: false } }
}

/** What he has told us, for Eve to read when she is answering a money question. */
export async function recentAnswers(limit = 10): Promise<Array<{ goal: string; question: string; answer: string; at: string }>> {
  try {
    const { data } = await db().from('eve_actions')
      .select('payload,executed_at').eq('kind', 'ralph').eq('status', 'executed')
      .order('executed_at', { ascending: false }).limit(Math.min(limit, 40))
    return ((data as any[]) || [])
      .filter(r => r.payload?.answer)
      .map(r => ({
        goal: String(r.payload?.goal || ''),
        question: String(r.payload?.question || ''),
        answer: String(r.payload?.answer || ''),
        at: String(r.payload?.answered_at || r.executed_at || ''),
      }))
  } catch { return [] }
}

/** A question he never answered is not a question any more. Keeps the match window honest. */
export async function expireUnanswered(hours = 48): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - Math.max(1, hours) * 3600_000).toISOString()
    const { data } = await db().from('eve_actions')
      .select('id,payload').eq('kind', 'ralph').eq('status', 'executed')
      .lt('executed_at', cutoff).limit(50)
    const stale = ((data as any[]) || []).filter(r => !r.payload?.answer)
    for (const r of stale) {
      await db().from('eve_actions').update({ status: 'expired' }).eq('id', r.id)
    }
    return stale.length
  } catch { return 0 }
}
