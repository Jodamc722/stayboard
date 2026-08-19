// Slack BOT client — the thing that can actually talk to people.
//
// WHY THIS EXISTS. `postSlack()` in lib/integrations.ts posts a plain string to ONE incoming
// webhook. That was enough when Slack meant "shout into a channel when a sync dies". It cannot do
// any of what Jon asked for on 2026-08-19: post to the right building's channel, @-mention the
// cleaner who is on the job, DM a supervisor, or carry an approve button. All of those need a BOT
// TOKEN (xoxb-), which arrives from the OAuth install once the app requests bot scopes.
//
// SCOPES this file assumes: chat:write, chat:write.public (post to a public channel without being
// invited), users:read + users:read.email (build the directory so we can mention the right human),
// im:write (open a DM), channels:read + groups:read (list channels for the admin picker).
// PRIVATE channels still need the bot /invite'd — chat:write.public does not cover them.
//
// NEVER THROWS. Every function returns a status instead. An alert that fails must never take down
// the sync, the cron, or the page that was trying to alert. Same law as postSlack().
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { getConnections } from './integrations'

const API = 'https://slack.com/api/'

export type SlackResult = { ok: boolean; error?: string; ts?: string; channel?: string }

/** A Slack human, trimmed to what we actually use. */
export type SlackUser = {
  id: string
  name: string          // real name, or display name if that is all there is
  email: string | null
  title: string | null
  bot: boolean
  deleted: boolean
}

/** A channel the bot could post to. */
export type SlackChannel = {
  id: string
  name: string
  isPrivate: boolean
  isMember: boolean     // the bot is in it — required for private channels
}

export const DIRECTORY_KEY = 'slack_directory'
const DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000   // 6h — people and channels move slowly

/**
 * The bot token. Prefers the OAuth install; falls back to an env var so a deployment can be wired
 * by hand without clicking through Slack. Empty string means "not connected" — every caller treats
 * that as a soft no-op rather than an error.
 */
export async function botToken(): Promise<string> {
  try {
    const c = await getConnections()
    const t = (c.slack && (c.slack as any).botToken) || ''
    if (t) return String(t)
  } catch { /* fall through to env */ }
  return process.env.SLACK_BOT_TOKEN || ''
}

export async function botConnected(): Promise<boolean> {
  return !!(await botToken())
}

/** Raw Slack Web API call. Returns the parsed body; `ok:false` on any transport or API error. */
export async function slackApi(method: string, body: Record<string, any>): Promise<any> {
  const token = await botToken()
  if (!token) return { ok: false, error: 'no_bot_token' }
  try {
    const r = await fetch(API + method, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const j = await r.json()
    return j && typeof j === 'object' ? j : { ok: false, error: 'bad_response' }
  } catch (e: any) {
    return { ok: false, error: String((e && e.message) || 'fetch_failed') }
  }
}

/** GET-style Slack call for the list endpoints, which want query params and a cursor. */
async function slackGet(method: string, params: Record<string, string>): Promise<any> {
  const token = await botToken()
  if (!token) return { ok: false, error: 'no_bot_token' }
  const qs = new URLSearchParams(params).toString()
  try {
    const r = await fetch(API + method + (qs ? '?' + qs : ''), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
    })
    const j = await r.json()
    return j && typeof j === 'object' ? j : { ok: false, error: 'bad_response' }
  } catch (e: any) {
    return { ok: false, error: String((e && e.message) || 'fetch_failed') }
  }
}

// ── Posting ────────────────────────────────────────────────────────────────────────────────────

/**
 * Post to a channel id. `text` is always sent even when blocks are present — it is what shows in
 * the notification and in accessibility contexts, and Slack warns when it is missing.
 */
export async function postToChannel(channel: string, text: string, blocks?: any[]): Promise<SlackResult> {
  if (!channel) return { ok: false, error: 'no_channel' }
  const payload: Record<string, any> = { channel, text, unfurl_links: false, unfurl_media: false }
  if (blocks && blocks.length) payload.blocks = blocks
  const j = await slackApi('chat.postMessage', payload)
  return { ok: !!j.ok, error: j.ok ? undefined : String(j.error || 'failed'), ts: j.ts, channel: j.channel }
}

/** Open (or reuse) the DM with one person and post into it. */
export async function dmUser(userId: string, text: string, blocks?: any[]): Promise<SlackResult> {
  if (!userId) return { ok: false, error: 'no_user' }
  const open = await slackApi('conversations.open', { users: userId })
  const ch = open && open.channel && open.channel.id ? String(open.channel.id) : ''
  if (!ch) return { ok: false, error: String((open && open.error) || 'cannot_open_dm') }
  return postToChannel(ch, text, blocks)
}

/** `<@U123>` — the only form Slack turns into a real, notifying mention. */
export function mention(userId: string | null | undefined): string {
  const id = String(userId || '').trim()
  return id ? '<@' + id + '>' : ''
}

/** Mention a list of people, skipping blanks and duplicates, in the order given. */
export function mentionAll(ids: (string | null | undefined)[]): string {
  const seen: Record<string, boolean> = {}
  const out: string[] = []
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id || seen[id]) continue
    seen[id] = true
    out.push(mention(id))
  }
  return out.join(' ')
}

// ── Directory (people + channels), cached ──────────────────────────────────────────────────────

export type Directory = { users: SlackUser[]; channels: SlackChannel[]; fetchedAt: string }

const EMPTY_DIRECTORY: Directory = { users: [], channels: [], fetchedAt: '' }

function mapUser(m: any): SlackUser {
  const p = (m && m.profile) || {}
  return {
    id: String(m.id || ''),
    name: String(p.real_name || m.real_name || p.display_name || m.name || '').trim(),
    email: p.email ? String(p.email) : null,
    title: p.title ? String(p.title) : null,
    bot: !!(m.is_bot || m.id === 'USLACKBOT'),
    deleted: !!m.deleted,
  }
}

/** Every human in the workspace. Paginates; bots and deactivated accounts are dropped. */
export async function fetchUsers(): Promise<SlackUser[]> {
  const out: SlackUser[] = []
  let cursor = ''
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = { limit: '200' }
    if (cursor) params.cursor = cursor
    const j = await slackGet('users.list', params)
    if (!j.ok || !Array.isArray(j.members)) break
    for (const m of j.members) {
      const u = mapUser(m)
      if (!u.id || u.bot || u.deleted || !u.name) continue
      out.push(u)
    }
    cursor = (j.response_metadata && j.response_metadata.next_cursor) || ''
    if (!cursor) break
  }
  return out
}

/** Every channel the bot could target. Private ones are only usable when `isMember`. */
export async function fetchChannels(): Promise<SlackChannel[]> {
  const out: SlackChannel[] = []
  let cursor = ''
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = {
      limit: '200',
      exclude_archived: 'true',
      types: 'public_channel,private_channel',
    }
    if (cursor) params.cursor = cursor
    const j = await slackGet('conversations.list', params)
    if (!j.ok || !Array.isArray(j.channels)) break
    for (const c of j.channels) {
      if (!c || !c.id) continue
      out.push({
        id: String(c.id),
        name: String(c.name || ''),
        isPrivate: !!c.is_private,
        isMember: !!c.is_member,
      })
    }
    cursor = (j.response_metadata && j.response_metadata.next_cursor) || ''
    if (!cursor) break
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * The cached directory. Slack rate-limits users.list hard (tier 2), and the admin screen and every
 * alert both want it, so it lives in app_settings for 6 hours. `force` refetches.
 */
export async function getDirectory(force?: boolean): Promise<Directory> {
  if (!force) {
    const cached = await getSetting<Directory>(DIRECTORY_KEY, EMPTY_DIRECTORY)
    const at = cached && cached.fetchedAt ? Date.parse(cached.fetchedAt) : 0
    if (at && Date.now() - at < DIRECTORY_TTL_MS && Array.isArray(cached.users) && cached.users.length) {
      return cached
    }
  }
  if (!(await botConnected())) return EMPTY_DIRECTORY
  const users = await fetchUsers()
  const channels = await fetchChannels()
  // A failed fetch must not wipe a good cache — only write when we actually got people back.
  if (!users.length && !channels.length) {
    return await getSetting<Directory>(DIRECTORY_KEY, EMPTY_DIRECTORY)
  }
  const dir: Directory = { users, channels, fetchedAt: new Date().toISOString() }
  try { await setSetting(DIRECTORY_KEY, dir, 'slack-directory') } catch { /* cache is best-effort */ }
  return dir
}

/** Who the bot is posting as — used by the admin screen to prove the install worked. */
export async function whoAmI(): Promise<{ ok: boolean; team?: string; user?: string; userId?: string; error?: string }> {
  const j = await slackApi('auth.test', {})
  if (!j.ok) return { ok: false, error: String(j.error || 'failed') }
  return { ok: true, team: String(j.team || ''), user: String(j.user || ''), userId: String(j.user_id || '') }
}
