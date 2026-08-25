// Slack slash command: /doorcode <unit>
//
// Slack posts form-encoded and expects a reply within 3 seconds, so this answers immediately with
// the VERDICT and — when the checks clear — a one-tap release link. The code itself is never in this
// response: it is only revealed on the release page, after a human taps.
//
// SETUP (one time, in the Slack app config):
//   Slash Commands -> Create New Command -> /doorcode
//   Request URL: https://lighthouse-stay.vercel.app/api/slack/command
//   Then reinstall so the `commands` scope is granted.
//
// SIGNATURE VERIFICATION is mandatory here, not optional: without it anyone who learns this URL can
// ask for door codes. We verify Slack's v0 HMAC over the raw body and reject anything older than
// five minutes (replay protection).
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { runCheck, createRequest, attachSlackPost } from '@/lib/eve/door-code'
import { postDoorCodeApproval } from '@/lib/eve/approvals'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function verify(raw: string, ts: string, sig: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET || ''
  if (!secret || !ts || !sig) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const mine = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')
  const a = Buffer.from(mine), b = Buffer.from(sig)
  return a.length === b.length && timingSafeEqual(a, b)
}

const say = (text: string) => NextResponse.json({ response_type: 'ephemeral', text })

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ts = req.headers.get('x-slack-request-timestamp') || ''
  const sig = req.headers.get('x-slack-signature') || ''
  if (!verify(raw, ts, sig)) {
    return NextResponse.json({ response_type: 'ephemeral', text: 'Could not verify that request came from Slack.' }, { status: 401 })
  }

  const p = new URLSearchParams(raw)
  const unit = String(p.get('text') || '').trim()
  const userId = String(p.get('user_id') || '')
  const userName = String(p.get('user_name') || '')
  if (!unit) return say('Which unit? Try `/doorcode 3707` or `/doorcode Rustic 12`.')

  const check = await runCheck({ unit, requestedBy: userName, requesterSlackId: userId })

  if (!check.canRelease) {
    const extra = check.verdict === 'blocked_occupied'
      ? `\n\n*Do not go to the door.* ${check.occupancy}\nMessage the guest and get a yes first.`
      : check.verdict === 'blocked_inconclusive' ? `\n\n${check.note}` : `\n\n${check.note}`
    return say(`🚫 *${check.headline}*${extra}`)
  }

  const parked = await createRequest(check, { slackUserId: userId, reason: `slash command by @${userName}` })
  if (!parked.ok) return say(`Checks passed for *${check.unit}*, but I could not park the request: ${parked.error}`)

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const link = `${origin}/doorcode/${parked.token}`
  const quote = check.permissionQuotes?.length
    ? `\n\n> _"${check.permissionQuotes[0].text.slice(0, 180)}"_ — the guest, ${String(check.permissionQuotes[0].at).slice(0, 10)}\nRead that before you tap.`
    : ''

  // Also drop it in the approvals channel, so whoever approves sees it without being asked.
  const posted = await postDoorCodeApproval({
    unit: check.unit || unit, building: check.building, address: check.address,
    verdict: check.verdict, headline: check.headline, occupancy: check.occupancy, note: check.note,
    quote: check.permissionQuotes?.[0] || null, taskToday: check.taskToday, vacancyScan: check.vacancyScan, calendar: check.calendar, confidence: check.confidence, arrivalWarning: check.arrivalWarning,
    requestedBy: `@${userName}`, reason: null, link,
  })
  if (posted.ok && posted.channelId && posted.ts && parked.requestId) {
    await attachSlackPost(parked.requestId, posted.channelId, posted.ts)
  }
  const where = posted.ok ? `\n\n_Also posted in ${posted.channel} for approval._` : ''

  const addr = check.address ? `\n📍 ${check.address}` : ''
  return say(`✅ *${check.headline}*${addr}\n${check.note}${quote}\n\nTap to reveal the code (works once, expires in 4h):\n${link}${where}`)
}
