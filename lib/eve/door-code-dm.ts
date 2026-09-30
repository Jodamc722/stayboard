// A RELEASED DOOR CODE GOES TO THE PERSON WHO ASKED, BY SLACK DM — the only way a code reaches Slack.
//
// Two places release a code to a Slack user: the release page, when an approver taps (app/doorcode/
// [token]), and door_code_check, when someone set to Direct asks in one of the two Customer Service
// rooms (lib/eve/door-code-rooms.ts, Jon 2026-09-29: never into a channel). One message builder, so the
// two cannot drift: both codes in the order to try them (housekeeping changes the keypad at the END of
// the clean, so until then the old code is the one that opens the door), the arrival warning, and the
// "which one opened it?" buttons — the only real evidence we ever get that a code is right.
import 'server-only'
import { slackApi, postToChannel } from '@/lib/slack'
import { isSlackUserId } from './door-code-rooms'

/**
 * Open the one-to-one DM with ONE Slack person. Anything that is not exactly one user id is refused —
 * `conversations.open` given "U1,U2" opens a group DM, and a code must never land in one. Called
 * BEFORE a Direct release in a Customer Service room, so a DM that cannot open parks the request
 * instead of burning a release nobody receives.
 */
export async function openDm(slackUserId: string): Promise<{ ok: boolean; channel?: string; error?: string }> {
  const id = String(slackUserId || '').trim()
  if (!isSlackUserId(id)) return { ok: false, error: 'not a single Slack user' }
  try {
    const open = await slackApi('conversations.open', { users: id })
    const ch = open && open.channel && open.channel.id ? String(open.channel.id) : ''
    // A one-to-one DM's id starts with D; anything else is not the private place a code goes.
    if (!/^D[A-Z0-9]+$/.test(ch)) return { ok: false, error: String((open && open.error) || 'cannot_open_dm') }
    return { ok: true, channel: ch }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 120) } }
}

export type ReleasedCodeDm = {
  slackUserId: string
  /** The DM already opened with openDm, if the caller opened it first. */
  channel?: string
  unit: string
  code: string
  previousCode?: string | null
  /** From transitionFor: 'old' means the keypad still holds the previous code — try that first. */
  expect?: string | null
  transitionNote?: string | null
  arrivalWarning?: string | null
  /** Rides the "which one opened it?" buttons (lib/eve/door-code.ts confirmByToken). */
  confirmToken?: string | null
  /** Who released it: the approver's email, or a line saying it was the person's own Direct setting. */
  releasedBy: string
}

export async function dmReleasedCode(p: ReleasedCodeDm): Promise<{ ok: boolean; error?: string }> {
  if (!isSlackUserId(p.slackUserId)) return { ok: false, error: 'no single Slack user to send it to' }
  const dm = p.channel && /^D[A-Z0-9]+$/.test(p.channel) ? { ok: true, channel: p.channel } : await openDm(p.slackUserId)
  if (!dm.ok || !dm.channel) return { ok: false, error: dm.error || 'the direct message could not be opened' }
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  const confirmUrl = p.confirmToken ? `${base}/doorcode/worked/${p.confirmToken}` : null
  const tryFirst = p.expect === 'old' && p.previousCode ? p.previousCode : p.code
  const thenTry = p.expect === 'old' && p.previousCode ? p.code : p.previousCode
  const lines = [`🔑 *${p.unit}*`, `*Try this first:* \`${tryFirst}\``]
  if (thenTry) lines.push(`*If that fails:* \`${thenTry}\``)
  if (p.transitionNote) lines.push(`_${p.transitionNote}_`)
  lines.push(`Released by ${p.releasedBy}. Please do not paste this into a channel.`)
  const blocks: any[] = [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }]
  if (p.arrivalWarning) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: p.arrivalWarning } })
  }
  if (confirmUrl) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Which one opened it?* One tap — it is how we find out whether the lock has actually been changed yet.' } })
    blocks.push({ type: 'actions', elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'The new code' }, url: `${confirmUrl}?ok=new` },
      { type: 'button', text: { type: 'plain_text', text: 'The old one' }, url: `${confirmUrl}?ok=old` },
      { type: 'button', text: { type: 'plain_text', text: 'Neither' }, url: `${confirmUrl}?ok=neither` },
    ] })
  }
  const r = await postToChannel(dm.channel, `Door code for ${p.unit} released by ${p.releasedBy}.`, blocks, { raw: true })
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'the direct message did not go through' }
}
