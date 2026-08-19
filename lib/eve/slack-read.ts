// Reading Slack — the operational conversation Eve was previously deaf to.
//
// WHY BOT-TOKEN AND NOT PER-USER. Jon's stated rule was "their channels only, NO DMs". Two ways to
// honour that: a policy note, or an architecture that cannot break it. This is the second one. A bot
// token without `im:history` is STRUCTURALLY incapable of reading a direct message — there is no
// prompt to jailbreak and no filter to get wrong.
//
// THE SEARCH TRADE-OFF, stated plainly. Slack only honours `search.messages` on a USER token, and a
// user token searches everything that person can see — DMs included. That is precisely the exposure
// that was ruled out. So `slack_search` here does NOT call Slack's search endpoint. It scans the
// history of the channels the bot belongs to and matches in code. That is slower and bounded to
// recent history, and it will never surprise anyone by surfacing a private message.
//
// COST CONTROL. Channel history is paged and capped, the channel list is cached, and every search
// reports how many channels and messages it actually looked at so a thin answer reads as thin
// rather than as "nothing was said".
import 'server-only'
import { botToken, getDirectory } from '@/lib/slack'
import { lc } from './ctx'

const API = 'https://slack.com/api/'

async function slackGet(method: string, params: Record<string, string>): Promise<any> {
  const token = await botToken()
  if (!token) return { ok: false, error: 'no_bot_token' }
  const qs = new URLSearchParams(params).toString()
  try {
    const r = await fetch(API + method + (qs ? '?' + qs : ''), {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
    })
    const j = await r.json()
    return j && typeof j === 'object' ? j : { ok: false, error: 'bad_response' }
  } catch (e: any) {
    return { ok: false, error: String((e && e.message) || 'fetch_failed') }
  }
}

export type SlackMsg = {
  channel: string; channelId: string; ts: string
  who: string; text: string; at: string
  threadTs?: string | null; replies?: number
  permalink?: string
}

/** Slack renders <@U123> and <#C123|name>; raw ids are unreadable to a model AND to a person. */
function humanise(text: string, users: Record<string, string>, channels: Record<string, string>): string {
  return String(text || '')
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, (_m, id) => '@' + (users[id] || id))
    .replace(/<#([A-Z0-9]+)\|([^>]*)>/g, (_m, _id, nm) => '#' + nm)
    .replace(/<#([A-Z0-9]+)>/g, (_m, id) => '#' + (channels[id] || id))
    .replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, (_m, url, label) => `${label} (${url})`)
    .replace(/<(https?:\/\/[^|>]+)>/g, (_m, url) => url)
    .trim()
}

type Maps = { users: Record<string, string>; channels: Record<string, string>; list: { id: string; name: string; isPrivate: boolean; isMember: boolean }[] }

let _maps: Maps | null = null
let _mapsAt = 0
async function maps(force = false): Promise<Maps> {
  if (!force && _maps && Date.now() - _mapsAt < 10 * 60 * 1000) return _maps
  const users: Record<string, string> = {}
  const channels: Record<string, string> = {}
  const list: Maps['list'] = []
  try {
    const dir: any = await getDirectory()
    for (const u of (dir?.users || [])) if (u?.id) users[u.id] = u.name || u.realName || u.id
    for (const c of (dir?.channels || [])) {
      if (!c?.id) continue
      channels[c.id] = c.name || c.id
      list.push({ id: c.id, name: c.name || c.id, isPrivate: !!c.isPrivate, isMember: c.isMember !== false })
    }
  } catch { /* directory is an optimisation */ }
  _maps = { users, channels, list }
  _mapsAt = Date.now()
  return _maps
}

function resolveChannel(nameOrId: string, m: Maps): { id: string; name: string } | null {
  const q = String(nameOrId || '').replace(/^#/, '').trim()
  if (!q) return null
  if (/^C[A-Z0-9]{6,}$/i.test(q)) {
    const hit = m.list.find(c => c.id === q.toUpperCase())
    return { id: q.toUpperCase(), name: hit?.name || q }
  }
  const exact = m.list.find(c => lc(c.name) === lc(q))
  if (exact) return { id: exact.id, name: exact.name }
  const partial = m.list.find(c => lc(c.name).includes(lc(q)))
  return partial ? { id: partial.id, name: partial.name } : null
}

/** Read recent messages from ONE channel. */
export async function channelHistory(nameOrId: string, opts?: { days?: number; limit?: number }): Promise<any> {
  const m = await maps()
  const ch = resolveChannel(nameOrId, m)
  if (!ch) {
    return { error: `No channel matching "${nameOrId}". Channels the bot can see: ${m.list.slice(0, 25).map(c => '#' + c.name).join(', ')}` }
  }
  const days = Math.min(Math.max(Number(opts?.days) || 7, 1), 90)
  const limit = Math.min(Math.max(Number(opts?.limit) || 60, 1), 200)
  const oldest = String(Math.floor((Date.now() - days * 86400000) / 1000))
  const j = await slackGet('conversations.history', { channel: ch.id, oldest, limit: String(limit) })
  if (!j.ok) {
    const hint = j.error === 'not_in_channel'
      ? ` The bot is not in #${ch.name}. Invite it with "/invite @Lighthouse" in that channel.`
      : j.error === 'missing_scope' ? ' The install predates the read scopes — reconnect Slack from /command.' : ''
    return { error: `Slack: ${j.error}.${hint}`, channel: '#' + ch.name }
  }
  const msgs: SlackMsg[] = (j.messages || [])
    .filter((x: any) => x?.type === 'message' && !x.subtype)
    .map((x: any) => ({
      channel: '#' + ch.name, channelId: ch.id, ts: x.ts,
      who: m.users[x.user] || x.username || x.bot_id || 'unknown',
      text: humanise(x.text, m.users, m.channels).slice(0, 900),
      at: new Date(Number(x.ts) * 1000).toISOString(),
      threadTs: x.thread_ts || null, replies: x.reply_count || 0,
    }))
    .filter((x: SlackMsg) => x.text)
  msgs.reverse()
  return { channel: '#' + ch.name, window_days: days, count: msgs.length, truncated: (j.messages || []).length >= limit, messages: msgs }
}

/** Pull a full thread once something interesting is found. */
export async function threadReplies(nameOrId: string, threadTs: string): Promise<any> {
  const m = await maps()
  const ch = resolveChannel(nameOrId, m)
  if (!ch) return { error: `No channel matching "${nameOrId}".` }
  const j = await slackGet('conversations.replies', { channel: ch.id, ts: String(threadTs), limit: '100' })
  if (!j.ok) return { error: `Slack: ${j.error}`, channel: '#' + ch.name }
  const msgs = (j.messages || []).map((x: any) => ({
    who: m.users[x.user] || x.username || 'unknown',
    text: humanise(x.text, m.users, m.channels).slice(0, 900),
    at: new Date(Number(x.ts) * 1000).toISOString(),
  })).filter((x: any) => x.text)
  return { channel: '#' + ch.name, thread_ts: threadTs, count: msgs.length, messages: msgs }
}

/**
 * Search across the channels the bot is in.
 *
 * NOT Slack's search.messages — see the header. This walks recent history channel by channel and
 * matches locally, so it can only ever see channels the bot belongs to.
 */
export async function searchChannels(query: string, opts?: { days?: number; channel?: string; maxChannels?: number; perChannel?: number }): Promise<any> {
  const q = String(query || '').trim()
  if (!q) return { error: 'Give me something to search for.' }
  const terms = lc(q).split(/\s+/).filter(t => t.length >= 2)
  if (!terms.length) return { error: 'Search terms are too short.' }

  const m = await maps()
  let pool = m.list.filter(c => c.isMember !== false)
  if (opts?.channel) {
    const one = resolveChannel(opts.channel, m)
    pool = one ? pool.filter(c => c.id === one.id) : []
    if (!pool.length) return { error: `No channel matching "${opts.channel}".` }
  }
  // Operational channels first — that is where the answer almost always is.
  pool.sort((a, b) => (lc(b.name).startsWith('vr-') ? 1 : 0) - (lc(a.name).startsWith('vr-') ? 1 : 0))
  const maxChannels = Math.min(Math.max(Number(opts?.maxChannels) || 14, 1), 30)
  const perChannel = Math.min(Math.max(Number(opts?.perChannel) || 120, 20), 200)
  const days = Math.min(Math.max(Number(opts?.days) || 30, 1), 120)
  const oldest = String(Math.floor((Date.now() - days * 86400000) / 1000))

  const scanned: string[] = []
  const skipped: string[] = []
  const hits: SlackMsg[] = []
  let messagesScanned = 0

  for (const c of pool.slice(0, maxChannels)) {
    const j = await slackGet('conversations.history', { channel: c.id, oldest, limit: String(perChannel) })
    if (!j.ok) { skipped.push(`#${c.name} (${j.error})`); continue }
    scanned.push('#' + c.name)
    for (const x of (j.messages || [])) {
      if (x?.type !== 'message' || x.subtype) continue
      messagesScanned++
      const text = humanise(x.text, m.users, m.channels)
      const hay = lc(text)
      // Every term must appear — an OR match on common words returns noise.
      if (!terms.every(t => hay.includes(t))) continue
      hits.push({
        channel: '#' + c.name, channelId: c.id, ts: x.ts,
        who: m.users[x.user] || x.username || 'unknown',
        text: text.slice(0, 700),
        at: new Date(Number(x.ts) * 1000).toISOString(),
        threadTs: x.thread_ts || null, replies: x.reply_count || 0,
      })
    }
  }
  hits.sort((a, b) => Number(b.ts) - Number(a.ts))
  return {
    query: q, window_days: days,
    channels_scanned: scanned.length, channels_searched: scanned,
    channels_skipped: skipped.length ? skipped : undefined,
    messages_scanned: messagesScanned,
    coverage_note: pool.length > maxChannels
      ? `Scanned the ${maxChannels} most relevant of ${pool.length} channels the bot is in — say if you want it widened.`
      : undefined,
    count: hits.length,
    matches: hits.slice(0, 40),
    note: hits.length ? undefined : `Nothing matching "${q}" in the last ${days} days across ${scanned.length} channel(s). That is a real answer — but it only covers channels the bot is in, and never DMs.`,
  }
}

/** Which channels can Eve actually see? The honest answer to "why didn't you find it". */
export async function slackReach(): Promise<any> {
  const m = await maps(true)
  const inCh = m.list.filter(c => c.isMember !== false)
  const outCh = m.list.filter(c => c.isMember === false)
  return {
    can_read: inCh.map(c => ({ channel: '#' + c.name, private: c.isPrivate })),
    cannot_read: outCh.map(c => ({ channel: '#' + c.name, private: c.isPrivate, fix: c.isPrivate ? 'invite the bot: /invite @Lighthouse' : 'the bot can join this one automatically' })),
    never_readable: 'Direct messages and group DMs. The bot has no im:history scope, so this is a hard limit, not a setting.',
  }
}
