// A RELEASED DOOR CODE GOES TO THE PERSON WHO ASKED, BY SLACK DM — the only way a code reaches Slack.
//
// Two places release a code to a Slack user: the release page, when an approver taps (app/doorcode/
// [token]), and door_code_check, when someone set to Direct asks in one of the two Customer Service
// rooms (lib/eve/door-code-rooms.ts, Jon 2026-09-29: never into a channel). One message builder, so the
// two cannot drift: both codes in the order to try them (housekeeping changes the keypad at the END of
// the clean, so until then the old code is the one that opens the door), the arrival warning, and the
// "which one opened it?" buttons — the only real evidence we ever get that a code is right.
import 'server-only'
import { dmUser } from '@/lib/slack'

export type ReleasedCodeDm = {
  slackUserId: string
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
  if (!p.slackUserId) return { ok: false, error: 'no Slack user to send it to' }
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
  const r = await dmUser(p.slackUserId, `Door code for ${p.unit} released by ${p.releasedBy}.`, blocks)
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'the direct message did not go through' }
}
