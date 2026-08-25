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
// A NOTE ON "GROUP CHAT WITH OTHER REV BOTS" — Telegram does not deliver one bot's messages to
// another bot. Ever. It is a platform rule, not a setting. Several bots can live in one room and
// answer the PEOPLE in it, and that works today. If Eve is ever to react to what another bot says,
// that bot has to call her server-side; there is no Telegram-only version of it.
import { NextRequest, NextResponse } from 'next/server'
import { getMe, sendMessage, sendTyping, displayName, type TgUpdate, type TgMessage } from '@/lib/telegram'
import { webhookSecret, botConfigured } from '@/lib/telegram'
import { claimUpdate, pruneUpdates, decide, seeRoom, recordMessage, threadFor, resetThread, overRate } from '@/lib/eve/telegram'
import { canSeeMoney } from '@/lib/access'
import { runEve } from '@/lib/eve/run'
import { runCheck, createRequest, attachSlackPost } from '@/lib/eve/door-code'
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
/help — this

In a group, @mention me or reply to one of my messages. I don't read anything else in there.`

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
  // Telegram does not deliver bot messages to bots, but if that ever changes, do not start a loop.
  if (!from || from.is_bot) return ok()

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
    const parked = await createRequest(check, { email: contact.email || undefined, reason: `Telegram by ${displayName(from)}` })
    if (!parked.ok) {
      await sendMessage(chat.id, `Checks passed for *${check.unit}*, but I could not park the request: ${parked.error}`)
      return ok()
    }
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
