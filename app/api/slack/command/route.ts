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
//
// WHERE IT WORKS (Jon, 2026-09-29: "Door codes can be requested by any Customer Service team member in
// CCS and Jon Channel, VR Customer Care channel. Never in team channels with field team"). In
// #ccs-and-jon and #vr-customercareteam anyone in the room may ask — a CCS agent with no Lighthouse
// login included, by their Slack identity — and it is parked for an approver unless they are set to
// Direct. In a one-to-one DM the person's own setting stands, as before. Anywhere else it refuses
// before a single check runs. See lib/eve/door-code-rooms.ts.
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { runCheck, requestDoorCode, attachSlackPost } from '@/lib/eve/door-code'
import { resolveLighthouseEmail, identityHint } from '@/lib/slack-identity'
import { accessForEmail, doorCodePolicy } from '@/lib/access'
import { postDoorCodeApproval } from '@/lib/eve/approvals'
import { doorCodeSurface, doorCodeRoomName, slackDoorCodeSetting, NOT_HERE_LINE, DOOR_CODE_ROOM_NAMES } from '@/lib/eve/door-code-rooms'

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
  const channelId = String(p.get('channel_id') || '')
  // The room first, before any check runs: a field-team channel gets the pointer and nothing else.
  const surface = doorCodeSurface(channelId)
  if (surface === 'elsewhere') return say(`🔒 ${NOT_HERE_LINE}`)
  const room = doorCodeRoomName(channelId)
  if (!unit) return say('Which unit? Try `/doorcode 3707` or `/doorcode Rustic 12`.')
  if (!userId) return say('Slack did not say who is asking, so I cannot send anything anywhere.')

  // WHO IS ASKING — decided BEFORE any check runs, so someone who may not ask learns nothing about the
  // unit (who is in it, when they leave). Slack hands us a user id and a display NAME; the name is a
  // nickname anyone can change, so it never decides anything. The id is resolved the same hardened way
  // the @Eve webhook resolves it (lib/slack-identity.ts: profile email, our other domain — so Jon's
  // jon@staysoflo.com is Jon — the admin map, and a fenced name match). Outside the two Customer
  // Service rooms, nobody we cannot place resolves to 'off' — which also closes the old hole where any
  // member of the workspace could run this command. Inside them, the room is the team: anyone there is
  // at least Ask (an approver releases, and the code goes to their Slack id by DM), and Direct stays
  // Direct — unless the match was by name alone, which never skips an approver.
  const who = await resolveLighthouseEmail(userId)
  const requesterAccess = who.email ? await accessForEmail(who.email) : null
  const personal = requesterAccess ? doorCodePolicy(requesterAccess) : 'off'
  const setting = slackDoorCodeSetting(personal, surface)
  let policy: 'off' | 'ask' | 'direct' = setting === 'refused' ? 'off' : setting
  if (policy === 'direct' && who.how === 'name') policy = 'ask'
  if (policy === 'off') {
    return say(requesterAccess
      ? `🔒 You are not set up to receive door codes. Customer Service requests them in ${DOOR_CODE_ROOM_NAMES}.`
      : `🔒 I could not match your Slack account to a Lighthouse user (${identityHint(who, userId)}), so I cannot give you a code here. Customer Service can request one in ${DOOR_CODE_ROOM_NAMES}.`)
  }

  const check = await runCheck({ unit, requestedBy: userName, requesterSlackId: userId })

  if (!check.canRelease) {
    const extra = check.verdict === 'blocked_occupied'
      ? `\n\n*Do not go to the door.* ${check.occupancy}\nMessage the guest and get a yes first.`
      : check.verdict === 'blocked_inconclusive' ? `\n\n${check.note}` : `\n\n${check.note}`
    return say(`🚫 *${check.headline}*${extra}`)
  }

  const outcome = await requestDoorCode(check, {
    // The Lighthouse account when there is one; otherwise what Slack's profile says, for the approver.
    email: who.email || who.profileEmail || undefined, slackUserId: userId, name: userName ? `@${userName}` : undefined,
    reason: `slash command by @${userName}${room ? ` in ${room}` : ''}`, policy,
  })
  if (outcome.kind === 'denied') return say(`🔒 ${outcome.message}`)
  if (outcome.kind === 'error') return say(`Checks passed for *${check.unit}*, but I could not park the request: ${outcome.message}`)
  if (outcome.kind === 'released') {
    // Only they see this reply (ephemeral). Which code first follows the keypad, as on the DM.
    const first = outcome.expect === 'old' && outcome.previousCode ? outcome.previousCode : outcome.code
    const then = outcome.expect === 'old' && outcome.previousCode ? outcome.code : outcome.previousCode
    const both = then ? `\n*If that fails:* \`${then}\`` : ''
    const tn = outcome.transitionNote ? `\n_${outcome.transitionNote}_` : ''
    return say(`✅ *${check.unit}*\n*Try this first:* \`${first}\`${both}${tn}\n\n_Sent straight to you because your access is set to Direct. Only you can see this. It is on the audit trail._`)
  }
  const parked = outcome

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const link = `${origin}/doorcode/${parked.token}`
  const quote = check.permissionQuotes?.length
    ? `\n\n> _"${check.permissionQuotes[0].text.slice(0, 180)}"_ — the guest, ${String(check.permissionQuotes[0].at).slice(0, 10)}`
    : ''

  // Into the approvals channel, where an approver sees it without being asked. The release link is
  // THEIRS: nobody releases their own request (releaseByToken), so it is not handed to the asker —
  // unless the post failed, when forwarding it to an approver is the only way it moves.
  const posted = await postDoorCodeApproval({
    unit: check.unit || unit, building: check.building, address: check.address,
    verdict: check.verdict, headline: check.headline, occupancy: check.occupancy, note: check.note,
    quote: check.permissionQuotes?.[0] || null, taskToday: check.taskToday, vacancyScan: check.vacancyScan, calendar: check.calendar, confidence: check.confidence, arrivalWarning: check.arrivalWarning,
    // The Slack mention (drawn from the id, not a name they typed), marked when there is no Lighthouse login.
    requestedBy: requesterAccess ? `<@${userId}>` : `<@${userId}> — no Lighthouse login`, reason: room ? `asked in ${room}` : null, link,
  })
  if (posted.ok && posted.channelId && posted.ts && parked.requestId) {
    await attachSlackPost(parked.requestId, posted.channelId, posted.ts)
  }
  const next = posted.ok
    ? `Sent for approval in ${posted.channel}. When an approver releases it, the code comes to you by DM — never into a channel. Expires in 4 hours.`
    : `I could not post it for approval (${posted.error}). Send this link to an approver — it works once and expires in 4 hours:\n${link}`

  const addr = check.address ? `\n📍 ${check.address}` : ''
  return say(`✅ *${check.headline}*${addr}\n${check.note}${quote}\n\n${next}`)
}
