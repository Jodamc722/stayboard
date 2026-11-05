// ONE GATE FOR THE POSTS THAT USED TO GO STRAIGHT OUT (Jon, 2026-11-05: "more effective, more clear
// and useful").
//
// Three systems posted to Slack and did not share a cap: the rules outbox, the Eve agent gate
// (agent-mode stepDown) and a handful of direct posts — the approvals digest, the Salato watch, the
// guest-issue alerts. #vr-customercareteam got ~22 Eve posts in 46 hours, half the channel. The
// direct posts now pass the SAME checks stepDown makes for a slack_post, so they count against the
// same per-room cap and the same said-registry:
//   · THE POSTING WINDOW — nothing from these paths between 8pm and 7am ET (Jon, 2026-11-05). This is
//     on top of the agent's own quiet hours, which still apply (an urgent post skips those, as in
//     stepDown, but never the 8pm–7am window).
//   · SAID ONCE — lib/eve/said.ts: the same words in the same thread within a week, or the same
//     subject in the same room within six hours, is not posted again.
//   · THE ROOM CAP — app_settings eve_room_caps, unchanged (Jon, 2026-11-05: do not change the caps).
//     Top-level cron posts only; thread replies and urgent posts are never capped, as in stepDown.
// What is held is logged as observe with the reason, so the Thinking tab shows it.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const POST_WINDOW_ET = { start: 7, end: 20 }

export function etHour(now = new Date()): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now))
  return h === 24 ? 0 : h
}
export function etDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}

/** 7am–8pm ET (Jon, 2026-11-05: "nothing posts between 8pm and 7am ET"). */
export function inPostWindow(now = new Date(), win: { start: number; end: number } = POST_WINDOW_ET): boolean {
  const h = etHour(now)
  return h >= win.start && h < win.end
}

export type GateInput = { channel: string; threadTs?: string | null; text: string; subject?: string | null; by: string; urgent?: boolean; summary?: string; now?: Date }

/** May this post go out now? Never throws; a check that cannot be read never blocks (as in stepDown). */
export async function roomGate(p: GateInput): Promise<{ ok: true } | { ok: false; why: string }> {
  const now = p.now || new Date()
  if (!inPostWindow(now)) return held(p, `outside ${POST_WINDOW_ET.start}am–${POST_WINDOW_ET.end - 12}pm ET`)
  try {
    const { getAgentSettings, inQuietHours } = await import('./agent-mode')
    const s = await getAgentSettings()
    if (!p.urgent && inQuietHours(s, now)) return held(p, `quiet hours ${s.quietHours.start}–${s.quietHours.end} ${s.quietHours.tz}`)
  } catch { /* settings unreadable: the window above still held */ }
  const channel = String(p.channel || '').trim()
  if (!channel) return { ok: true }
  try {
    const { alreadySaid } = await import('./said')
    const dup = await alreadySaid({ channel, threadTs: p.threadTs || null, text: p.text, subject: p.subject || null })
    if (dup.dup) return held(p, `already said — ${dup.why}`)
  } catch { /* the registry never blocks a post */ }
  if (!p.threadTs && String(p.by || '').startsWith('cron:') && !p.urgent) {
    try {
      const { getSetting } = await import('@/lib/app-settings')
      const caps = (await getSetting<Record<string, number>>('eve_room_caps', {})) || {}
      const cap = Number(caps[channel] ?? caps.default ?? 6)
      if (cap >= 0) {
        const dayStart = new Date(etDate(now) + 'T04:00:00Z').toISOString()
        const { count } = await supabaseAdmin().from('eve_said').select('key', { count: 'exact', head: true }).eq('channel', channel).eq('thread_ts', '').gte('last_at', dayStart)
        if ((count || 0) >= cap) return held(p, `room cap — ${count} posts here today already (cap ${cap})`)
      }
    } catch { /* a cap that cannot be read never blocks a post */ }
  }
  return { ok: true }
}

async function held(p: GateInput, why: string): Promise<{ ok: false; why: string }> {
  try {
    const { recordAgentAction } = await import('./agent-mode')
    await recordAgentAction('slack_post', { rung: 0, allowed: false, mode: 'observe', reason: why, summary: (p.summary || p.text).slice(0, 300), by: p.by, countAs: 'none' })
  } catch { /* the log is best effort */ }
  return { ok: false, why }
}

/** Record a post that went out, so the registry and the room cap count it. */
export async function noteSaid(p: GateInput & { ts?: string | null }): Promise<void> {
  try {
    const { markSaid } = await import('./said')
    await markSaid({ channel: p.channel, threadTs: p.threadTs || null, text: p.text, subject: p.subject || null, by: p.by, ts: p.ts || null })
  } catch { /* best effort */ }
  try {
    const { recordAgentAction } = await import('./agent-mode')
    await recordAgentAction('slack_post', { rung: 4, allowed: true, mode: 'act', reason: 'passed the room gate', summary: (p.summary || p.text).slice(0, 300), ref: p.ts || null, by: p.by, countAs: 'none' })
  } catch { /* best effort */ }
}

/** Gate, post (channel or thread), record. `held` is set when the gate said no. */
export async function gatedPost(p: GateInput & { blocks?: any[] }): Promise<{ ok: boolean; ts?: string | null; held?: string; error?: string }> {
  const g = await roomGate(p)
  if (!g.ok) return { ok: false, held: g.why }
  const { postToChannel, postThreadReply } = await import('@/lib/slack')
  const r = p.threadTs ? await postThreadReply(p.channel, p.threadTs, p.text) : await postToChannel(p.channel, p.text, p.blocks)
  if (!r.ok) return { ok: false, error: r.error || 'refused' }
  await noteSaid({ ...p, ts: r.ts || null })
  return { ok: true, ts: r.ts || null }
}
