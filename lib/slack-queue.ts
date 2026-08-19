// THE OUTBOX — draft, approve, send. No alert in this app posts to Slack directly any more.
//
// Jon's rule, 2026-08-19: nothing staff-facing goes out until a human approves it, and it can be
// approved either from the Command Center or straight from a Slack DM. Anything nobody acts on
// inside the window expires instead of firing late.
//
// GROUPING. Callers pass a `groupKey` — 'late_cleans:17WEST:2026-08-19'. Re-drafting the same key
// UPDATES the pending row instead of adding another, so a cron that runs every 30 minutes while
// four cleans are still open produces exactly one message, with current numbers. A partial unique
// index in migration 044 makes the duplicate physically impossible even if two crons race.
//
// COOLDOWN. Once a group has actually been SENT, the same group stays quiet for `cooldownMin`.
// That is what stops the team being pinged about the same four cleans every half hour.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { postToChannel, postThreadReply, dmUser, mention } from './slack'
import { getSlackRules, withinWindow, type EventKey, type SlackRules } from './slack-rules'

export type OutboxStatus = 'pending' | 'approved' | 'sent' | 'skipped' | 'expired' | 'failed'

export type OutboxRow = {
  id: string
  event_key: string
  group_key: string
  building: string | null
  channel_id: string | null
  dm_user_ids: string[] | null
  body: string
  summary: string | null
  audience: string[] | null
  item_count: number
  status: OutboxStatus
  needs_approval: boolean
  token: string | null
  created_at: string
  expires_at: string | null
  decided_by: string | null
  decided_at: string | null
  sent_at: string | null
  error: string | null
}

export type DraftInput = {
  eventKey: EventKey
  groupKey: string
  building?: string | null
  channelId?: string | null
  dmUserIds?: string[]
  body: string
  /** Posted as a threaded reply under the main message — the Spanish half lives here. */
  threadBody?: string | null
  summary?: string
  audience?: string[]
  itemCount?: number
}

export type DraftResult =
  | { ok: true; action: 'queued' | 'updated' | 'sent'; id: string }
  | { ok: false; reason: string }

const TABLE = 'slack_outbox'

/**
 * The thread reply travels inside `body` behind a sentinel rather than in its own column, so this
 * works on the outbox table Jon has already migrated. Nothing a human writes contains this string.
 */
export const THREAD_SEP = '\n\u241Fthread\u241F\n'

export function splitThread(stored: string): { body: string; thread: string | null } {
  const raw = String(stored || '')
  const i = raw.indexOf(THREAD_SEP)
  if (i < 0) return { body: raw, thread: null }
  return { body: raw.slice(0, i), thread: raw.slice(i + THREAD_SEP.length) || null }
}

const nowIso = () => new Date().toISOString()
const minutesAgoIso = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

/** ET minutes-of-day, matching how lib/ops-behind.ts thinks about the working day. */
export function nowMinutesET(): number {
  const s = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
  const m = /(\d{1,2}):(\d{2})/.exec(s)
  if (!m) return 0
  return Number(m[1]) % 24 * 60 + Number(m[2])
}

/**
 * Draft a message. Depending on the rules this either lands in the queue awaiting approval, or
 * sends immediately (sync failures, the digest). Returns why it did nothing when it does nothing.
 */
export async function draft(input: DraftInput, rulesIn?: SlackRules): Promise<DraftResult> {
  const rules = rulesIn || (await getSlackRules())
  const rule = rules.events[input.eventKey]
  if (!rule || !rule.enabled) return { ok: false, reason: 'event disabled' }
  if (!withinWindow(rule, nowMinutesET())) return { ok: false, reason: 'outside the sending window' }

  const db = supabaseAdmin()
  const groupKey = String(input.groupKey || '').slice(0, 200)
  if (!groupKey) return { ok: false, reason: 'no group key' }

  // Already sent recently? Stay quiet. This is the real anti-spam gate.
  if (rule.cooldownMin > 0) {
    try {
      const { data } = await db.from(TABLE).select('id')
        .eq('group_key', groupKey).eq('status', 'sent')
        .gte('sent_at', minutesAgoIso(rule.cooldownMin)).limit(1)
      if (Array.isArray(data) && data.length) return { ok: false, reason: 'already sent recently' }
    } catch { /* fail-open: better a duplicate than silence */ }
  }

  const row = {
    event_key: input.eventKey,
    group_key: groupKey,
    building: input.building || null,
    channel_id: input.channelId || null,
    dm_user_ids: input.dmUserIds && input.dmUserIds.length ? input.dmUserIds : [],
    body: String(input.body || '').slice(0, 3500) +
      (input.threadBody ? THREAD_SEP + String(input.threadBody).slice(0, 3500) : ''),
    summary: (input.summary || '').slice(0, 300) || null,
    audience: input.audience && input.audience.length ? input.audience : [],
    item_count: Math.max(1, Math.round(Number(input.itemCount) || 1)),
    needs_approval: !!rule.approval,
    updated_at: nowIso(),
  }

  if (!rule.approval) {
    // Straight out, but still recorded so the Command Center and the firehose see it.
    const ins = await db.from(TABLE).insert({ ...row, status: 'approved', expires_at: null }).select('id').single()
    const id = ins.data && (ins.data as any).id ? String((ins.data as any).id) : ''
    if (!id) return { ok: false, reason: 'could not record message' }
    await sendOne(id, rules)
    return { ok: true, action: 'sent', id }
  }

  // Re-draft an existing pending message for this group rather than stacking a second one.
  try {
    const { data } = await db.from(TABLE).select('id').eq('group_key', groupKey).eq('status', 'pending').limit(1)
    if (Array.isArray(data) && data[0]) {
      const id = String((data[0] as any).id)
      await db.from(TABLE).update({
        ...row,
        expires_at: new Date(Date.now() + rules.approvalExpiryMin * 60_000).toISOString(),
      }).eq('id', id)
      return { ok: true, action: 'updated', id }
    }
  } catch { /* fall through to insert */ }

  const token = randomBytes(24).toString('hex')
  const ins = await db.from(TABLE).insert({
    ...row,
    status: 'pending',
    token,
    expires_at: new Date(Date.now() + rules.approvalExpiryMin * 60_000).toISOString(),
  }).select('id').single()
  if (ins.error || !ins.data) return { ok: false, reason: ins.error ? ins.error.message : 'insert failed' }
  const id = String((ins.data as any).id)
  await notifyApprovers(id, rules).catch(() => {})
  return { ok: true, action: 'queued', id }
}

/** The DM Jon gets: what it would say, and one tap to let it go or drop it. */
async function notifyApprovers(id: string, rules: SlackRules): Promise<void> {
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('*').eq('id', id).single()
  const row = data as OutboxRow | null
  if (!row || !rules.approvers.length) return
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  const yes = base + '/approve/slack/' + row.token + '?go=1'
  const no = base + '/approve/slack/' + row.token + '?go=0'
  const where = row.building ? row.building : 'Lighthouse'
  const preview = splitThread(row.body)
  const text = [
    '*Ready to send — ' + where + '*',
    '',
    preview.body + (preview.thread ? '\n\n_(a Spanish copy goes in the thread)_' : ''),
    '',
    '<' + yes + '|✅ Send it>   ·   <' + no + '|🚫 Skip>   ·   <' + base + '/command|Open Command Center>',
    '_Expires in ' + Math.round(rules.approvalExpiryMin / 60) + 'h if nobody acts._',
  ].join('\n')
  for (const approver of rules.approvers) await dmUser(approver, text)
}

/** Approve or skip. The decider is stamped here, server-side, never taken from a client. */
export async function decide(id: string, approve: boolean, actor: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin()
  const { data, error } = await db.from(TABLE)
    .update({
      status: approve ? 'approved' : 'skipped',
      decided_by: String(actor || '').slice(0, 120),
      decided_at: nowIso(),
      updated_at: nowIso(),
      token: null,                     // one-time: the link cannot be replayed
    })
    .eq('id', id).eq('status', 'pending')
    .select('id').maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'That one was already handled or has expired.' }
  if (approve) await sendOne(id)
  return { ok: true }
}

/** Approve straight from the Slack DM link. The token IS the authorisation, and it burns on use. */
export async function decideByToken(token: string, approve: boolean): Promise<{ ok: boolean; error?: string; row?: OutboxRow }> {
  const t = String(token || '').trim()
  if (!t || t.length < 20) return { ok: false, error: 'That link is not valid.' }
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('*').eq('token', t).eq('status', 'pending').maybeSingle()
  const row = data as OutboxRow | null
  if (!row) return { ok: false, error: 'That one was already handled, or it expired.' }
  const res = await decide(row.id, approve, 'slack-link')
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, row }
}

/** Actually post. Channel first, then any DMs, then a copy to the firehose. */
export async function sendOne(id: string, rulesIn?: SlackRules): Promise<{ ok: boolean; error?: string }> {
  const rules = rulesIn || (await getSlackRules())
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('*').eq('id', id).single()
  const row = data as OutboxRow | null
  if (!row) return { ok: false, error: 'not found' }
  if (row.status !== 'approved') return { ok: false, error: 'not approved' }

  const problems: string[] = []
  let delivered = 0

  const { body: mainBody, thread: threadBody } = splitThread(row.body)

  if (row.channel_id) {
    const r = await postToChannel(row.channel_id, mainBody)
    if (r.ok) {
      delivered++
      // The reply is a nice-to-have: if it fails the main message still stands, so it is recorded
      // as a problem but never flips the row to 'failed'.
      if (threadBody && r.ts) {
        const t = await postThreadReply(row.channel_id, String(r.ts), threadBody)
        if (!t.ok) problems.push('thread: ' + (t.error || 'failed'))
      }
    } else problems.push('channel: ' + (r.error || 'failed'))
  }
  for (const u of row.dm_user_ids || []) {
    const r = await dmUser(u, mainBody)
    if (r.ok) {
      delivered++
      if (threadBody && r.ts && r.channel) {
        const t = await postThreadReply(String(r.channel), String(r.ts), threadBody)
        if (!t.ok) problems.push('thread dm ' + u + ': ' + (t.error || 'failed'))
      }
    } else problems.push('dm ' + u + ': ' + (r.error || 'failed'))
  }
  // Jon's copy of everything — but never twice into the same channel.
  if (rules.firehose && rules.firehose !== row.channel_id) {
    const tag = row.building ? '[' + row.building + '] ' : ''
    await postToChannel(rules.firehose, tag + mainBody)
  }

  const ok = delivered > 0
  await db.from(TABLE).update({
    status: ok ? 'sent' : 'failed',
    sent_at: ok ? nowIso() : null,
    error: problems.length ? problems.join('; ').slice(0, 500) : null,
    updated_at: nowIso(),
  }).eq('id', id)
  return { ok, error: problems.length ? problems.join('; ') : undefined }
}

/** Send everything approved but not yet delivered — the retry path when Slack was down. */
export async function dispatchApproved(limit = 25): Promise<{ sent: number; failed: number }> {
  const rules = await getSlackRules()
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('id').eq('status', 'approved').order('created_at').limit(limit)
  let sent = 0
  let failed = 0
  for (const r of (data || []) as any[]) {
    const res = await sendOne(String(r.id), rules)
    if (res.ok) sent++
    else failed++
  }
  return { sent, failed }
}

/** Drop anything nobody acted on in time. A stale nudge is worse than no nudge. */
export async function expireStale(): Promise<number> {
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE)
    .update({ status: 'expired', updated_at: nowIso(), token: null })
    .eq('status', 'pending').lt('expires_at', nowIso())
    .select('id')
  return Array.isArray(data) ? data.length : 0
}

/** What the Command Center card shows. */
export async function pendingItems(limit = 20): Promise<OutboxRow[]> {
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('*')
    .eq('status', 'pending').order('created_at', { ascending: false }).limit(limit)
  return (data || []) as OutboxRow[]
}

/** Recent history, so the admin screen can show what actually went out. */
export async function recentItems(limit = 30): Promise<OutboxRow[]> {
  const db = supabaseAdmin()
  const { data } = await db.from(TABLE).select('*')
    .neq('status', 'pending').order('created_at', { ascending: false }).limit(limit)
  return (data || []) as OutboxRow[]
}

/** Render the tag line every grouped message ends with. */
export function ccLine(audience: string[]): string {
  const tags = audience.map(mention).filter(Boolean)
  return tags.length ? tags.join(' ') : ''
}
