// Eve on Telegram — the webhook. Telegram POSTs every message here.
//
// Jon, 2026-08-25: "add eve to telegram, so i can ask questions directly there ... it should have an
// approve the contact feature ... I want to be able to have a group chat with other rev bots."
//
// AUTHENTICATION IS THE SECRET HEADER, NOT THE URL. setWebhook registers a `secret_token`; Telegram
// echoes it in X-Telegram-Bot-Api-Secret-Token on every single call. Anything without it is dropped
// before a single row is read. URLs leak — into logs, into browser history, into screenshots — so
// the URL is never allowed to be the credential.
//
// WHY THIS ANSWERS INLINE INSTEAD OF QUEUEING. Eve takes 15-40 seconds to think, which is longer
// than Telegram's patience, so it will redeliver the same update. That is fine and expected: the
// first thing we do is CLAIM the update id in Postgres, and a redelivery loses the race and exits.
// One question, one answer, one Anthropic bill — without a queue table, a worker route and a cron
// to nurse them.
//
// IN A GROUP SHE ONLY SPEAKS WHEN SPOKEN TO. @mention, or a reply to something she said. Two
// reasons: nobody wants a bot narrating their group, and a bot that answers everything in a room
// full of bots is one loop away from an unbounded conversation with itself.
//
// A NOTE ON "GROUP CHAT WITH OTHER REV BOTS" — this used to say Telegram never delivers one bot's
// messages to another. That WAS true and is no longer: Bot-to-Bot Communication Mode, switched on in
// @BotFather for BOTH bots, makes it work (in a group it needs a /command@Bot mention or a reply).
// Telegram's own docs warn in the same breath that this is how you get infinite reply loops, and
// require dedupe, rate limiting and a depth cap from anyone who uses it.
//
// See step 2b below and lib/eve/ralph.ts for how that is handled here, and note the shape of it:
// she can RECEIVE from exactly one known bot and never replies to one, so the loop is closed by
// there being no outbound path at all rather than by a limit that would only slow one down.
import { NextRequest, NextResponse } from 'next/server'
import { getMe, sendMessage, sendTyping, displayName, type TgUpdate, type TgMessage } from '@/lib/telegram'
import { webhookSecret, botConfigured } from '@/lib/telegram'
import { claimUpdate, pruneUpdates, decide, seeRoom, recordMessage, threadFor, resetThread, overRate } from '@/lib/eve/telegram'
import { findAsk, resolveAsk, runMorningAsk } from '@/lib/eve/ask'
import { acceptsFrom, recordReply } from '@/lib/eve/ralph'
import { canSeeMoney, doorCodePolicy } from '@/lib/access'
import { runEve } from '@/lib/eve/run'
import { runCheck, requestDoorCode, attachSlackPost } from '@/lib/eve/door-code'
import { postDoorCodeApproval, getApprovalsChannel } from '@/lib/eve/approvals'
import { postToChannel } from '@/lib/slack'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Telegram is told to send us only these; anything else is ignored defensively anyway.
const ok = () => NextResponse.json({ ok: true })

// The bot's own @handle, needed to spot a mention. Cached per instance — it changes about never.
let _me: { id: number; username: string } | null = null
async function me(): Promise<{ id: number; username: string } | null> {
  if (_me) return _me
  const r = await getMe()
  if (!r.ok || !r.result) return null
  _me = { id: r.result.id, username: String(r.result.username || '') }
  return _me
}

/** Tell the app (and Slack, as a notice only) that someone is waiting to be let in. */
async function notify(text: string): Promise<void> {
  try {
    const ch = await getApprovalsChannel()
    if (!ch) return
    // A NOTICE, not a control. There is no approve button here and there never will be: approving
    // a Telegram contact grants a person live access to operational data, and that decision belongs
    // behind a Lighthouse login where it can be attributed. Same rule as guest orders.
    await postToChannel(ch.id, text)
  } catch { /* Slack being down must never block Telegram */ }
}

const HELP = `I'm Eve — the operating brain for Stay Hospitality. Ask me anything you'd ask me in Lighthouse: what's going wrong in ops today, how a building is doing, whether a unit is vacant, why a review went bad, what a guest is allowed to do.

Commands
/doorcode <unit> — run the door-code checks and, if they pass, get a one-tap release link
/new — start a fresh conversation (I forget the last few messages, not what I've learned)
/whoami — who I think you are and what you're allowed to see
/ask — I'll bring you the next thing I'd most like answered
/help — this

Each morning I'll send you the few things most worth your answer — anything that looks broken first, then whatever I can't work out for myself. Reply to one of those messages and I'll file what you say as a rule.

In a group, @mention me or reply to one of my messages. I don't read anything else in there.`

const chatIdOf = (m: TgMessage) => String(m?.chat?.id || '')

export async function POST(req: NextRequest) {
  // ---- 1. Is this actually Telegram? --------------------------------------------------------
  const secret = webhookSecret()
  if (!secret) return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET is not set' }, { status: 503 })
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!botConfigured()) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, { status: 503 })

  const update = (await req.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update.update_id !== 'number') return ok()

  // ---- 2. The bot was added to (or removed from) a group. ------------------------------------
  if (update.my_chat_member) {
    const ev = update.my_chat_member
    const status = String(ev.new_chat_member?.status || '')
    const chat = ev.chat
    if ((chat?.type === 'group' || chat?.type === 'supergroup') && (status === 'member' || status === 'administrator')) {
      if (!(await claimUpdate(update.update_id, chat.id))) return ok()
      const room = await seeRoom(chat, ev.from)
      if (room && room.status === 'pending') {
        await sendMessage(chat.id, `Hi — I'm Eve. I'm not switched on for this group yet.\n\nSomeone with Lighthouse access has to approve this room under **Users & admin → Settings → Eve → Telegram**. I'll stay quiet until then.`)
        await notify(`📲 *Telegram:* Eve was added to the group *${chat.title || chat.id}* by ${displayName(ev.from)}.\nThe room is PENDING — approve it in Lighthouse at Users & admin → Settings → Eve → Telegram. (Nothing in Slack can approve it.)`)
      }
    }
    return ok()
  }

  const msg: TgMessage | undefined = update.message
  if (!msg || !msg.chat) return ok()
  const from = msg.from
  if (!from) return ok()

  // ---- 2b. A message from another BOT. -------------------------------------------------------
  // Telegram now delivers these when Bot-to-Bot Communication Mode is on for both bots, and its own
  // documentation warns that this is how you get infinite reply loops. So there is exactly one bot
  // whose messages are accepted (Ralphbot, by user id, in the one agreed chat, and only when we
  // have an unanswered question outstanding), and accepting one does NOT produce an answer — his
  // reply is recorded against the question that asked for it and that is the end of the turn.
  //
  // That absence is the loop protection. Not a rate limit, which only makes a loop slow: there is
  // no code path from an inbound bot message to an outbound one, so two bots cannot talk each other
  // into a corner however either of them behaves.
  if (from.is_bot) {
    const text = String(msg.text || msg.caption || '').trim()
    if (!text) return ok()
    if (!(await acceptsFrom(from.id, chatIdOf(msg)))) return ok()
    if (!(await claimUpdate(update.update_id, msg.chat.id))) return ok()
    await recordReply(text, msg.reply_to_message?.message_id || null)
    return ok()                                   // deliberately silent. She never replies to a bot.
  }

  const text = String(msg.text || msg.caption || '').trim()
  if (!text) return ok()

  const chat = msg.chat
  const isGroup = chat.type === 'group' || chat.type === 'supergroup'
  if (chat.type === 'channel') return ok()

  // ---- 3. In a group: was she spoken to? ----------------------------------------------------
  const bot = await me()
  const handle = bot?.username ? '@' + bot.username : ''
  let question = text
  if (isGroup) {
    const mentioned = !!handle && text.toLowerCase().includes(handle.toLowerCase())
    const repliedToHer = !!bot && msg.reply_to_message?.from?.id === bot.id
    if (!mentioned && !repliedToHer) return ok()               // not for her — say nothing, spend nothing
    if (mentioned) question = text.split(new RegExp(handle, 'ig')).join(' ').replace(/\s+/g, ' ').trim()
  }
  // "/doorcode@evebot 3707" -> "/doorcode 3707"
  question = question.replace(/^\/([a-z_]+)@[\w]+/i, '/$1').trim()
  if (!question) question = 'hi'

  // ---- 4. One update, one answer. -----------------------------------------------------------
  if (!(await claimUpdate(update.update_id, chat.id))) return ok()
  pruneUpdates().catch(() => {})

  // ---- 5. May they talk to her? -------------------------------------------------------------
  const verdict = await decide(from, chat, question)
  if (!verdict.allow) {
    // A stranger gets told once, and once more only if they come back another day. Repeating the
    // refusal on every message is how a bot gets muted — and how a bored stranger gets a toy.
    const c = verdict.contact
    const firstTime = !c || (c.msg_count || 0) <= 1
    const quietFor = c?.last_seen_at ? Date.now() - new Date(c.last_seen_at).getTime() : Infinity
    const roomFirstTime = verdict.reason === 'room_pending' && (verdict.room?.msg_count || 0) <= 1
    if (verdict.reason !== 'blocked' && verdict.reason !== 'room_blocked' && (firstTime || roomFirstTime || quietFor > 12 * 3600_000)) {
      await sendMessage(chat.id, verdict.message, { replyTo: msg.message_id })
    }
    if (verdict.reason === 'pending' && firstTime) {
      await notify(`📲 *Telegram:* new contact *${displayName(from)}*${from.username ? ` (@${from.username})` : ''} asked Eve:\n> ${question.slice(0, 200)}\n\nThey are PENDING and got no answer. Approve them — and pick which Lighthouse user they speak as — at Users & admin → Settings → Eve → Telegram. (Nothing in Slack can approve them.)`)
    }
    return ok()
  }

  const { access, contact } = verdict
  const cmd = /^\/([a-z_]+)\s*(.*)$/i.exec(question)
  const command = cmd ? cmd[1].toLowerCase() : ''
  const arg = cmd ? cmd[2].trim() : ''

  // ---- 5b. Is this the answer to something SHE asked? ----------------------------------------
  // This has to come before the Eve loop, because it is not a question for her to think about — it
  // is the reply half of a conversation she started, and it belongs to the question it answers.
  // Only for a real person's plain text: a slash command is always a command.
  if (!command && !isGroup) {
    const binding = await findAsk(chat.id, msg.reply_to_message?.message_id || null, question)
    if (binding) {
      await recordMessage(chat.id, String(from.id), 'user', question)
      const said = await resolveAsk(binding, question, contact.email || String(from.id))
      await recordMessage(chat.id, null, 'assistant', said)
      await sendMessage(chat.id, said, { replyTo: msg.message_id })
      return ok()
    }
  }

  // ---- 6. Commands ---------------------------------------------------------------------------
  if (command === 'start' || command === 'help') {
    await sendMessage(chat.id, `${command === 'start' ? `You're approved, ${displayName(from)} — speaking as ${contact.email}.\n\n` : ''}${HELP}`)
    return ok()
  }
  if (command === 'new') {
    await resetThread(chat.id)
    await sendMessage(chat.id, 'Fresh start. What do you need?')
    return ok()
  }
  if (command === 'whoami') {
    // Money is the per-user toggle at /users, never the role — say it the honest way.
    const lines = [
      `You're ${displayName(from)}, speaking as *${contact.email}*.`,
      `Role: ${access.role === 'admin' ? 'admin' : (access.accessRole || 'member')}.`,
      `Dollar amounts: ${canSeeMoney(access) ? 'visible' : 'hidden — I answer in ratios and percentages'}.`,
    ]
    if (verdict.room) lines.push(`This room: ${verdict.room.title || chat.id} (approved).`)
    await sendMessage(chat.id, lines.join('\n'))
    return ok()
  }

  // /ask — she normally waits for the morning. This is asking her to go early, so it deliberately
  // ignores the daily budget: a person who typed /ask is not being interrupted.
  if (command === 'ask') {
    await sendTyping(chat.id)
    const run = await runMorningAsk({ force: true, max: 1 })
    if (!run.sent) {
      await sendMessage(chat.id, run.skipped === 'nothing worth asking'
        ? `Nothing worth asking right now — nothing looks broken and I can work out everything else myself. I'll come back when that changes.`
        : `I couldn't ask anything: ${run.skipped}.`)
    }
    return ok()
  }

  // ---- 7. /doorcode <unit> — the checks run here, the code is still only revealed on the page.
  if (command === 'doorcode') {
    if (!arg) { await sendMessage(chat.id, 'Which unit? Try `/doorcode 3707` or `/doorcode Rustic 12`.'); return ok() }
    await sendTyping(chat.id)
    const check = await runCheck({ unit: arg, requestedBy: contact.email || displayName(from), reason: `Telegram by ${displayName(from)}` })
    if (!check.canRelease) {
      const extra = check.verdict === 'blocked_occupied'
        ? `\n\n*Do not go to the door.* ${check.occupancy}\nMessage the guest and get a yes first.`
        : `\n\n${check.note}`
      await sendMessage(chat.id, `🚫 *${check.headline}*${extra}`, { replyTo: msg.message_id })
      return ok()
    }
    // Same three-way decision as everywhere else, from the same function. `access` here is the
    // approved Telegram contact resolved to a real app user, so the setting that applies is theirs.
    const outcome = await requestDoorCode(check, {
      email: contact.email || undefined, reason: `Telegram by ${displayName(from)}`,
      policy: doorCodePolicy(access),
    })
    if (outcome.kind === 'denied') { await sendMessage(chat.id, `🔒 ${outcome.message}`, { replyTo: msg.message_id }); return ok() }
    if (outcome.kind === 'error') {
      await sendMessage(chat.id, `Checks passed for *${check.unit}*, but I could not park the request: ${outcome.message}`)
      return ok()
    }
    if (outcome.kind === 'released') {
      const both = outcome.previousCode ? `\n*If that fails:* \`${outcome.previousCode}\`` : ''
      const tn = outcome.transitionNote ? `\n_${outcome.transitionNote}_` : ''
      await sendMessage(chat.id, `✅ *${check.unit}*\n*Try this first:* \`${outcome.code}\`${both}${tn}\n\n_Sent straight to you because your access is set to Direct. It is on the audit trail._`, { replyTo: msg.message_id })
      return ok()
    }
    const parked = outcome
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const link = `${origin}/doorcode/${parked.token}`
    const quote = check.permissionQuotes?.length
      ? `\n\n_"${check.permissionQuotes[0].text.slice(0, 180)}"_ — the guest, ${String(check.permissionQuotes[0].at).slice(0, 10)}\nRead that before you tap.`
      : ''
    const posted = await postDoorCodeApproval({
      unit: check.unit || arg, building: check.building, address: check.address,
      verdict: check.verdict, headline: check.headline, occupancy: check.occupancy, note: check.note,
      quote: check.permissionQuotes?.[0] || null, taskToday: check.taskToday, vacancyScan: check.vacancyScan,
      calendar: check.calendar, confidence: check.confidence, arrivalWarning: check.arrivalWarning,
      requestedBy: `${displayName(from)} (Telegram)`, reason: null, link,
    })
    if (posted.ok && posted.channelId && posted.ts && parked.requestId) await attachSlackPost(parked.requestId, posted.channelId, posted.ts)
    const addr = check.address ? `\n📍 ${check.address}` : ''
    const where = posted.ok ? `\n\n_Also posted in ${posted.channel} for approval._` : ''
    await sendMessage(chat.id, `✅ *${check.headline}*${addr}\n${check.note}${quote}\n\nTap to reveal the code (works once, expires in 4h):\n${link}${where}`, { preview: false })
    return ok()
  }

  if (command) {
    await sendMessage(chat.id, `I don't know /${command}. ${HELP}`)
    return ok()
  }

  // ---- 8. A real question. -------------------------------------------------------------------
  if (await overRate(chat.id)) {
    await sendMessage(chat.id, `That's a lot of questions in an hour — I'm pausing this chat for a bit so we don't run up a bill. Try again shortly, or use Lighthouse.`)
    return ok()
  }

  await sendTyping(chat.id)
  const keepTyping = setInterval(() => { sendTyping(chat.id).catch(() => {}) }, 4500)
  try {
    const history = await threadFor(chat.id)
    // In a group, the question carries who asked — several people share one thread in there.
    const asked = isGroup ? `[${displayName(from)}] ${question}` : question
    await recordMessage(chat.id, String(from.id), 'user', asked)

    const out = await runEve({
      access,
      messages: [...history, { role: 'user', content: asked }],
      source: 'telegram',
      surfaceNote: isGroup
        ? `You are in a Telegram GROUP called "${verdict.room?.title || 'a group'}". Several people are in it and each message is prefixed with who said it. Answer the person who asked. Never repeat something one person is allowed to see to a room where others may not be — if an answer needs dollar amounts and the asker is not cleared for them, say so instead.`
        : undefined,
    })

    if (!out.ok) {
      await sendMessage(chat.id, `I hit an error: ${out.error}`, { replyTo: msg.message_id })
      return ok()
    }
    await recordMessage(chat.id, null, 'assistant', out.reply, out.chatId)
    await sendMessage(chat.id, out.reply, { replyTo: isGroup ? msg.message_id : null })
    return ok()
  } catch (e: any) {
    await sendMessage(chat.id, `I hit an error before I could answer. ${String(e?.message || e).slice(0, 200)}`)
    return ok()
  } finally {
    clearInterval(keepTyping)
  }
}

// A GET is how you check the route is deployed without a token. It deliberately says nothing about
// whether the bot is configured — that is behind the admin route.
export async function GET() {
  return NextResponse.json({ ok: true, service: 'telegram-webhook' })
}
