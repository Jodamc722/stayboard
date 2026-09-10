// The SLACK domain — what the team actually said, as opposed to what the systems recorded.
//
// This is the last big blind spot. Every real operational decision gets discussed in a #vr-* channel
// and none of it was reaching Eve, so she could tell you a clean ran late but never that Roberto had
// already flagged the reason on Tuesday.
//
// HARD BOUNDARY, worth repeating everywhere it applies: these tools use the BOT token. The bot has
// no `im:history` scope, so it CANNOT read direct messages — not "is told not to", cannot. Anything
// Eve reports here came from a channel the bot has been added to.
import 'server-only'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { channelHistory, threadReplies, searchChannels, slackReach } from './slack-read'
import { openItems } from './slack-watch'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const SLACK_TOOLS: EveTool[] = [
  {
    name: 'slack_search',
    description: 'Search what the TEAM said in Slack. Use this whenever the systems show something happened but not why — a clean ran late, a unit went offline, a guest was moved, a decision was made. Params: query (all words must appear), days (default 30), channel (optional, to narrow). IMPORTANT: this scans the channels the Lighthouse bot has been added to and NEVER direct messages, so a "no results" answer means "not in those channels", not "never discussed" — say it that way. If coverage looks thin, call slack_reach to see what the bot can actually read.',
    input_schema: obj({ query: S.str, days: S.num, channel: S.str, maxChannels: S.num }, ['query']),
    run: async (input) => searchChannels(String(input?.query || ''), {
      days: input?.days, channel: input?.channel ? String(input.channel) : undefined, maxChannels: input?.maxChannels,
    }),
  },
  {
    name: 'slack_channel',
    description: 'Read recent messages from ONE Slack channel, e.g. "#vr-botanica" or "vr-miami-hk-maintenance-arya-elser-district225". Params: channel (required), days (default 7), limit (default 60). Use this to catch up on a building\'s chatter, or after slack_search points at a channel worth reading properly.',
    input_schema: obj({ channel: S.str, days: S.num, limit: S.num }, ['channel']),
    run: async (input) => channelHistory(String(input?.channel || ''), { days: input?.days, limit: input?.limit }),
  },
  {
    name: 'slack_thread',
    description: 'Pull a full Slack thread once search or channel history shows a message with replies. Params: channel and thread_ts (the ts value from the message). The replies are usually where the actual decision is.',
    input_schema: obj({ channel: S.str, thread_ts: S.str }, ['channel', 'thread_ts']),
    run: async (input) => threadReplies(String(input?.channel || ''), String(input?.thread_ts || '')),
  },
  {
    name: 'open_items',
    description: 'What you are KEEPING TABS ON from the channels: commitments people made, problems still open, questions nobody answered, decisions made in chat. Twice a day you read the team rooms and track these; they close when a thread reply says done, a Breezeway task finishes, or a glitch is closed. Use this when someone asks what is outstanding, what was promised, whether something got handled, or what is open for a unit or a person. Params: unit, owner, kind — all optional filters.',
    input_schema: obj({ unit: S.str, owner: S.str, kind: S.str }),
    run: async (input) => {
      const all = await openItems(100)
      const u = String(input?.unit || '').toLowerCase(), o = String(input?.owner || '').toLowerCase(), k = String(input?.kind || '').toLowerCase()
      const rows = all.filter(i => (!u || String(i.unit || '').toLowerCase().includes(u)) && (!o || String(i.owner_name || '').toLowerCase().includes(o)) && (!k || i.kind === k))
      return { open: rows.length, items: rows.slice(0, 40).map(i => ({ kind: i.kind, summary: i.summary, owner: i.owner_name, unit: i.unit, building: i.building, since: i.first_seen.slice(0, 10), due: i.due_at ? i.due_at.slice(0, 10) : null, channel: i.channel_name, tracked_in: i.tracked_in, nudged: i.nudge_count > 0 })) }
    },
  },
  {
    name: 'close_item',
    description: 'Mark one of the tracked items as done, because a person in the conversation told you it is handled. Params: summary_contains (a distinctive phrase from the item), reason (who said so and what). Only close what you were TOLD is done — never guess.',
    input_schema: obj({ summary_contains: S.str, reason: S.str }, ['summary_contains', 'reason']),
    run: async (input, ctx) => {
      const q = String(input?.summary_contains || '').toLowerCase()
      if (q.length < 4) return { error: 'Give me a longer phrase from the item.' }
      const hits = (await openItems(200)).filter(i => i.summary.toLowerCase().includes(q))
      if (hits.length !== 1) return { error: hits.length ? `${hits.length} items match — be more specific.` : 'No open item matches that.' }
      const { error } = await supabaseAdmin().from('eve_slack_items').update({ status: 'closed', closed_reason: `${ctx.email || 'someone'}: ${String(input?.reason || '').slice(0, 160)}`, closed_at: new Date().toISOString() }).eq('id', hits[0].id)
      return error ? { error: error.message } : { closed: hits[0].summary }
    },
  },
  {
    name: 'slack_reach',
    description: 'Which Slack channels can you actually read, and which are you locked out of. Call this when a search comes back empty and you want to say honestly WHY — usually the bot has not been invited to a private channel. Never claim something was not discussed without checking your own reach first.',
    input_schema: obj({}),
    run: async () => slackReach(),
  },
]

export const SLACK_DOMAIN: EveDomain = {
  key: 'slack',
  label: 'Slack',
  blurb: 'What the team actually said — search across the #vr-* channels, read one channel, pull a thread, and check which channels you can reach. Channels only; direct messages are structurally out of reach.',
  tools: SLACK_TOOLS,
}
