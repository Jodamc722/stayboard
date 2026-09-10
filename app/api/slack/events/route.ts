// @Eve in Slack — the Events API webhook.
//
// Jon, 2026-09-10: "I would also like to get @EVE added to slack so you can ask her questions there,
// her responses need to be slack focused, not super long to not clog up the page."
//
// She could already READ Slack (lib/eve/slack-read.ts) and POST to it (the 3pm readiness check, the
// hours report). What she could not do is be ADDRESSED. This is that half.
//
// SETUP, one time, in the Slack app config (api.slack.com/apps/A0BMSTT9ZEF):
//   Event Subscriptions -> Request URL: https://lighthouse-stay.vercel.app/api/slack/events
//     (Slack sends a `url_verification` challenge to that URL; this route answers it.)
//   Subscribe to bot events: `app_mention`
//   Scopes: `app_mentions:read` (plus the `chat:write` it already has). Reinstall after adding.
//
// NOTE WHICH EVENT IS **NOT** SUBSCRIBED, and never should be: `message.im`. Reading a DM needs
// `im:history`, and the bot deliberately does not have it — that scope is the only reason it is
// STRUCTURALLY unable to read the team's direct messages rather than merely forbidden to. Answering
// a DM would be a nice convenience and it is not worth trading that for. Telegram is where Eve has a
// private channel with a person; Slack is the team's room.
//
// THREE THINGS THAT WOULD OTHERWISE BITE:
//
//  1. SLACK WANTS AN ANSWER IN 3 SECONDS. Eve takes 15-40. Slack's fix for a slow endpoint is to
//     RETRY, up to three times — which without a guard is one question answered three times in the
//     channel. So a retry is acknowledged and dropped on sight (`x-slack-retry-num`): the original
//     request is still running and will post the answer itself when it is done.
//
//  2. SIGNATURE VERIFICATION IS MANDATORY. This URL can be found. Without the v0 HMAC anyone who
//     learns it can put words in Eve's mouth in front of the whole company, and make her spend the
//     Anthropic bill doing it. Same posture as the /doorcode command.
//
//  3. SHE MUST NOT ANSWER HERSELF. Her own posts and other bots' posts are ignored. In a room that
//     already contains alert bots, an assistant that replies to bots is one badly-worded alert away
//     from a conversation with itself.
//
// EVERY ANSWER GOES IN A THREAD. That is the anti-clog rule and it is structural rather than a
// request in the prompt: the channel shows one line, the detail lives behind it, and a long answer
// costs the room nothing.
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { botToken, emailForSlackUser, getDirectory, slackApi } from '@/lib/slack'
import { accessForEmail } from '@/lib/access'
import { runEve, canUseEve } from '@/lib/eve/run'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ok = () => NextResponse.json({ ok: true })

function verify(raw: string, ts: string, sig: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET || ''
  if (!secret || !ts || !sig) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const mine = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')
  const a = Buffer.from(mine), b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * One event, one answer.
 *
 * Slack's retries are the obvious duplicate, and they are handled by the header check below. This
 * guards the less obvious one: the same event id arriving twice because a deploy rolled while an
 * event was in flight. The primary key is the lock — exactly one caller inserts, everyone else
 * loses and exits. Reuses the Telegram replay table rather than adding one; the ids do not collide
 * and both answer the same question, "have I already handled this?".
 */
async function claim(eventId: string): Promise<boolean> {
  if (!eventId) return true
  try {
    const { error } = await supabaseAdmin().from('telegram_updates')
      .insert({ update_id: hash32(eventId), chat_id: 'slack:' + eventId.slice(0, 40) })
    return !error
  } catch { return true }   // a guard that cannot run must not silence her
}
function hash32(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h % 2147483647
}

/** Strip the @mention itself so she is not answering the question "@Eve". */
function cleanText(text: string, botUserId: string): string {
  return String(text || '')
    .replace(new RegExp(`<@${botUserId}>`, 'g'), ' ')
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, '@$1')
    .replace(/<#([A-Z0-9]+)\|([^>]*)>/g, '#$2')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^|>]+)>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

let _self: string | null = null
async function selfId(): Promise<string> {
  if (_self) return _self
  try {
    const r = await slackApi('auth.test', {})
    _self = String(r?.user_id || '')
  } catch { _self = '' }
  return _self || ''
}

async function channelName(id: string): Promise<string> {
  try {
    const dir = await getDirectory()
    const c = (dir?.channels || []).find((x: any) => String(x.id) === String(id))
    return c?.name ? '#' + c.name : id
  } catch { return id }
}

async function say(channel: string, threadTs: string, text: string): Promise<void> {
  // ALWAYS in a thread, even for a one-liner. Consistency is the point: the team learns that Eve
  // never takes more than one line of channel, so nobody has a reason to stop @-ing her.
  await slackApi('chat.postMessage', {
    channel, thread_ts: threadTs, text,
    unfurl_links: false, unfurl_media: false,
  }).catch(() => {})
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

  // Slack proves it owns the URL by posting a challenge here BEFORE the app is configured, and it
  // signs that request like any other — so verification comes first and the challenge second.
  const ts = req.headers.get('x-slack-request-timestamp') || ''
  const sig = req.headers.get('x-slack-signature') || ''

  // A MISSING SECRET IS NOT AN UNAUTHORIZED REQUEST, and saying so cost an hour once. With
  // SLACK_SIGNING_SECRET unset every Slack call is refused, and the only thing Slack reports back is
  // "your URL didn't respond with the value of the challenge parameter" — which reads like a broken
  // endpoint. Two different problems must not share one error.
  if (!process.env.SLACK_SIGNING_SECRET) {
    return NextResponse.json({
      error: 'SLACK_SIGNING_SECRET is not set',
      detail: 'Set it in Vercel (Slack app → Basic Information → App Credentials → Signing Secret) and redeploy. Until then every request from Slack is refused, including this URL check.',
    }, { status: 503 })
  }

  if (!verify(raw, ts, sig)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: any = null
  try { body = JSON.parse(raw) } catch { return ok() }

  if (body?.type === 'url_verification') {
    return NextResponse.json({ challenge: String(body.challenge || '') })
  }

  // A retry means our first attempt was still thinking. It is not a second question.
  if (req.headers.get('x-slack-retry-num')) return ok()

  const ev = body?.event
  if (!ev || ev.type !== 'app_mention') return ok()
  if (ev.bot_id || ev.subtype === 'bot_message') return ok()

  const me = await selfId()
  if (me && String(ev.user) === me) return ok()

  const channel = String(ev.channel || '')
  const user = String(ev.user || '')
  // Answer in the thread she was mentioned in, or open one on the message itself.
  const threadTs = String(ev.thread_ts || ev.ts || '')
  if (!channel || !user || !threadTs) return ok()

  if (!(await claim(String(body.event_id || ev.ts)))) return ok()
  if (!(await botToken())) return ok()

  const question = cleanText(ev.text, me)
  if (!question) {
    await say(channel, threadTs, 'I am here — what do you need?')
    return ok()
  }

  // ---- Who is asking, and what are they allowed to see? --------------------------------------
  // The Slack user id is resolved to a Lighthouse user and the ANSWER IS SHAPED BY THAT PERSON'S
  // permissions — money redaction included. It deliberately does not matter that the channel is
  // full of other people: the asker's access is what governs, exactly as it does everywhere else.
  const email = await emailForSlackUser(user)
  if (!email) {
    await say(channel, threadTs, `I don't know who you are in Lighthouse — your Slack account isn't matched to a user there, so I can't tell what you're allowed to see. Ask Jon to link it.`)
    return ok()
  }
  const access = await accessForEmail(email)
  if (!access) {
    await say(channel, threadTs, `Your Lighthouse account (${email}) isn't active, so I can't answer.`)
    return ok()
  }
  if (!canUseEve(access)) {
    await say(channel, threadTs, `Your Lighthouse role doesn't have me switched on. Jon can change that at Users & admin → Roles.`)
    return ok()
  }

  const where = await channelName(channel)

  try {
    const out = await runEve({
      access,
      messages: [{ role: 'user', content: question }],
      source: 'slack',
      surfaceNote: `This is ${where}. Whatever that channel is for is the likely subject — if it is a building's channel, assume the question is about that building unless told otherwise.`,
    })
    if (!out.ok) {
      await say(channel, threadTs, `I hit an error: ${out.error}`)
      return ok()
    }
    await say(channel, threadTs, out.reply)
    return ok()
  } catch (e: any) {
    await say(channel, threadTs, `I hit an error before I could answer. ${String(e?.message || e).slice(0, 200)}`)
    return ok()
  }
}

// A GET is how you check the route is deployed. It reports whether the signing secret EXISTS —
// a boolean, never the value — because the alternative is guessing at the cause of a failed URL
// check, and the boolean gives away nothing an attacker could use.
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'slack-events',
    signingSecret: !!process.env.SLACK_SIGNING_SECRET,
    note: process.env.SLACK_SIGNING_SECRET
      ? 'Signing secret is set. A failed Slack URL check now means something else.'
      : 'SLACK_SIGNING_SECRET is NOT set — every request from Slack is refused, including the URL check.',
  })
}
