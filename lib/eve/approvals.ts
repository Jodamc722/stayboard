// Approvals in Slack — because an approval nobody sees is a blocker, not a safeguard.
//
// The door-code checks were already right, but the release link was buried in an ephemeral slash
// reply that only the REQUESTER could see. So the person who had to approve never got told. That
// turns a two-second decision into a phone call, and a safeguard people route around is worse than
// no safeguard at all.
//
// This posts the request into ONE private channel with the whole picture and a single button.
//
// WHY A URL BUTTON AND NOT AN INTERACTIVE ONE. Slack's interactive buttons need an Interactivity
// Request URL configured in the app and a signed webhook endpoint to receive the click. A `url`
// button needs neither — it works the moment the bot can post. So: tap in Slack, land on the
// release page already signed in, tap once more. Two taps, no extra Slack setup, and the actual
// release still happens behind the app's own admin check rather than on a Slack payload we would
// have to verify. Nothing about the security model moves into Slack.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { postToChannel, postThreadReply, getDirectory } from '@/lib/slack'
import { lc } from './ctx'

export const APPROVALS_CHANNEL_KEY = 'eve_approvals_channel'

export type ApprovalsChannel = { id: string; name: string }

export async function getApprovalsChannel(): Promise<ApprovalsChannel | null> {
  const v = await getSetting<any>(APPROVALS_CHANNEL_KEY, null)
  if (v && typeof v === 'object' && v.id) return { id: String(v.id), name: String(v.name || '') }
  // If nobody has configured one, fall back ONLY to a channel that is unmistakably for this and
  // that the bot is already in. These posts carry a unit, an address and a guest's own words, so
  // guessing at "probably the leadership channel" is not a kindness — it is a leak. Anything less
  // obvious than a channel named for approvals stays unset until a human picks it.
  try {
    const dir: any = await getDirectory()
    const chans: any[] = dir?.channels || []
    const guess = chans.find(c => c?.isMember && /door.?code|approval/i.test(String(c.name)))
    if (guess) return { id: String(guess.id), name: String(guess.name) }
  } catch { /* not configured yet */ }
  return null
}

export async function setApprovalsChannel(nameOrId: string, by: string): Promise<{ ok: boolean; channel?: ApprovalsChannel; error?: string }> {
  const q = String(nameOrId || '').replace(/^#/, '').trim()
  if (!q) return { ok: false, error: 'Give me a channel name.' }
  try {
    const dir: any = await getDirectory()
    const chans: any[] = dir?.channels || []
    const hit = /^C[A-Z0-9]{6,}$/i.test(q)
      ? chans.find(c => String(c.id) === q.toUpperCase())
      : (chans.find(c => lc(c.name) === lc(q)) || chans.find(c => lc(c.name).includes(lc(q))))
    if (!hit) {
      return { ok: false, error: `No channel matching "${nameOrId}". The bot can only see channels it belongs to — for a private one, /invite @Lighthouse first.` }
    }
    if (hit.isMember === false) {
      return { ok: false, error: `Found #${hit.name}, but the bot is not in it. Run "/invite @Lighthouse" in that channel, then set it again.` }
    }
    const ch = { id: String(hit.id), name: String(hit.name) }
    const res = await setSetting(APPROVALS_CHANNEL_KEY, ch, by)
    return res.ok ? { ok: true, channel: ch } : { ok: false, error: res.error }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

export type DoorApprovalPost = {
  unit: string
  building?: string
  address?: string | null
  verdict: string
  headline: string
  occupancy?: string
  note?: string
  quote?: { text: string; at: string } | null
  taskToday?: { name: string; assignees: string[] } | null
  vacancyScan?: { result: string; summary: string; messagesRead: number; threadsRead: number } | null
  calendar?: { ok: boolean; status: string | null; blocked: boolean; error?: string } | null
  confidence?: { level: string; label: string; suspect: boolean; problems: string[]; conflicts: string[]; sharedWith: number; transition?: { expect: string; reason: string; hasPrevious: boolean } | null } | null
  arrivalWarning?: string | null
  requestedBy: string
  reason?: string | null
  link: string
}

/** One message, everything needed to decide, one button. */
export async function postDoorCodeApproval(p: DoorApprovalPost): Promise<{ ok: boolean; channel?: string; channelId?: string; ts?: string; error?: string }> {
  const ch = await getApprovalsChannel()
  if (!ch) {
    return { ok: false, error: 'No approvals channel set. Pick one on /eve, or POST /api/eve/approvals-channel with {"channel":"#your-channel"}.' }
  }

  const occupied = p.verdict === 'permission_found'
  const header = occupied ? '🔓 Door code — OCCUPIED unit, guest appears to have agreed'
    : '🔑 Door code request'

  const lines: string[] = []
  lines.push(`*${p.unit}*${p.building ? ` · ${p.building}` : ''}`)
  if (p.address) lines.push(`📍 ${p.address}`)
  lines.push(p.headline)
  if (p.occupancy) lines.push(`_${p.occupancy}_`)
  lines.push(`Asked for by *${p.requestedBy}*${p.reason ? ` — ${p.reason}` : ''}`)
  if (p.taskToday) lines.push(`Work booked today: ${p.taskToday.name}${p.taskToday.assignees.length ? ` (${p.taskToday.assignees.join(', ')})` : ''}`)

  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: header, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
  ]

  // Check-in time has passed on an arrival day. The unit is legally theirs whether or not anyone
  // watched them walk in, so this sits directly under the headline, not in a footnote.
  if (p.arrivalWarning) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: p.arrivalWarning } })
  }

  // When someone is in house, the guest's own words are the ONLY thing that justifies entry, so
  // they go in the message rather than behind another click. Read it, then decide.
  if (p.quote) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*What the guest actually said* (${String(p.quote.at).slice(0, 10)}):\n>${p.quote.text.slice(0, 280).replace(/\n/g, '\n>')}` },
    })
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '⚠️ That is a pattern match, not a judgement. If it does not clearly mean _yes, come in_ — do not release.' }] })
  }
  // The vacancy double-check. When it comes back clean that is the single most reassuring line in
  // the message — "I read the threads and nobody is coming back" — so it does not get buried.
  if (p.vacancyScan) {
    const icon = p.vacancyScan.result === 'clean' ? '✅' : p.vacancyScan.result === 'nothing_to_read' ? '❔' : '⚠️'
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `${icon} *Message double-check:* ${p.vacancyScan.summary.slice(0, 400)}` }] })
  }
  // The lock may not hold what Guesty holds. Say which code will be handed over first and why —
  // without printing either of them here.
  if (p.confidence?.transition?.hasPrevious) {
    const t = p.confidence.transition
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `🧹 *Code changed recently.* ${t.reason.slice(0, 320)} Both codes go out on release, ${t.expect === 'old' ? 'old one first' : 'new one first'}.` }] })
  }

  // Is the code itself believable. A "reported not working" here is the difference between a wasted
  // trip and a phone call before anyone gets in the van, so it goes above the button, not below it.
  if (p.confidence) {
    const c = p.confidence
    const bits: string[] = []
    if (c.conflicts.length) bits.push(`the field disagrees with ${c.conflicts.join(' and ')}`)
    if (c.sharedWith) bits.push(`shared with ${c.sharedWith} other unit${c.sharedWith === 1 ? '' : 's'}`)
    bits.push(...c.problems)
    const icon = c.suspect || c.conflicts.length ? '🔴' : c.level === 'verified' ? '✅' : '❔'
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} *Is this code right?* ${c.label}${bits.length ? `\n• ${bits.join('\n• ')}` : ''}` },
    })
  }

  // The live calendar line. When it could not be read that is the single most important caveat on
  // the whole message, because an extension entered five minutes ago is invisible without it.
  if (p.calendar) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: p.calendar.ok
        ? `📅 *Live Guesty calendar:* today is "${p.calendar.status || 'available'}" — checked just now, so an extension would have shown.`
        : `❔ *Live Guesty calendar could not be read* (${p.calendar.error || 'no answer'}). An extension made in the last few minutes would NOT show here.` }],
    })
  }
  if (p.note) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: p.note.slice(0, 280) }] })

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'button',
      style: occupied ? 'danger' : 'primary',
      text: { type: 'plain_text', text: occupied ? 'Review the quote, then release' : 'Review & release', emoji: true },
      url: p.link,
    }],
  })
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Opens Lighthouse. The code is only revealed after you tap there — it is not in this message, and the link works once and expires in 4h.' }] })

  const fallback = `${header} — ${p.unit}: ${p.headline} (requested by ${p.requestedBy}). Release: ${p.link}`
  const r = await postToChannel(ch.id, fallback, blocks)
  return r.ok
    ? { ok: true, channel: '#' + ch.name, channelId: ch.id, ts: r.ts }
    : { ok: false, error: r.error, channel: '#' + ch.name }
}

/**
 * Close the loop in the channel. Without this the approval post sits there looking live forever and
 * the second person to see it taps a dead link — which reads as the tool being broken rather than
 * the request being handled.
 */
export async function postApprovalOutcome(channel: string | null | undefined, ts: string | null | undefined, text: string): Promise<void> {
  if (!channel || !ts) return
  try { await postThreadReply(channel, ts, text) } catch { /* never block a release on Slack */ }
}
