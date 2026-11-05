import 'server-only'
// APPROVE ANY EVE ASK — AND ANY SPEND — FROM SLACK (Jon, 2026-10-01: "I should be able to approve any
// Eve ask via Slack, even more spends").
//
// Two kinds of ask land in the approvals room (#vr-eve) as a post whose THREAD is the answer slot:
//   • an agent-mode PROPOSAL ("Eve wants to: …") — eve_actions, status 'proposed'; the post's ts is
//     kept on the row (payload.slack_ts / slack_channel) so a reply finds it.
//   • a SPEND waiting on approval (field_requests.approval_required, approval_status 'pending'), posted
//     when the request is filed; its post is remembered in app_settings (slack_spend_posts), pruned
//     after 14 days, because the table has no column for it and a migration is not worth one map.
//
// A reply in that thread from an APPROVER (Settings → Eve → Agent mode, or the owner) that reads as a
// yes executes the proposal / approves the spend; a no drops / rejects it. Anybody else gets told who
// can. The decision is recorded exactly as the Lighthouse buttons record it (same executors, same
// columns), and the outcome is posted back into the thread so the room sees it was decided.
//
// Nothing about the security model moves into Slack: the Slack user is resolved to their email through
// the workspace directory (lib/slack emailForSlackUser) and checked against the approver list every
// time; the ts match only finds the ask, it never authorises anything.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { postToChannel, postThreadReply, emailForSlackUser } from '@/lib/slack'
import { isSuperadmin } from '@/lib/access'
import { bustDay } from '@/lib/bust'
import { getAgentSettings, executeProposal, rejectProposal, tierOf } from './agent-mode'
import { getApprovalsChannel } from './approvals'
import { EVE_CHANNELS } from '@/lib/slack-rules'

const SPEND_POSTS_KEY = 'slack_spend_posts'
type SpendPost = { id: string; channel: string; at: string; title?: string }

export const YES = /^\s*(y|ya|yes|yep|yeah|yup|ok|okay|sure|go|go ahead|do it|please do|approved?|approve it|send( it)?|✅|👍)\b/i
export const NO = /^\s*(n|no|nope|nah|reject(ed)?|deny|denied|decline[d]?|drop( it)?|don'?t|do not|stop|❌|👎)\b/i

const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })

async function isApprover(email: string | null): Promise<boolean> {
  const e = String(email || '').toLowerCase().trim()
  if (!e) return false
  if (isSuperadmin(e)) return true
  try { const s = await getAgentSettings(); return s.approvers.map(x => String(x).toLowerCase()).indexOf(e) >= 0 } catch { return false }
}

/**
 * WHO MAY ANSWER (Eve audit 2026-10-10). An approver answers anything. A DESK ask — a task, a guest
 * draft or send, no money (agent-mode tierOf) — takes a yes from any team member whose Slack account
 * resolves to a Lighthouse login, while Settings → Eve → Agent mode → deskApprovals is on.
 */
async function canDecide(email: string | null, rows: any[]): Promise<{ ok: boolean; why: string }> {
  const e = String(email || '').toLowerCase().trim()
  if (await isApprover(e)) return { ok: true, why: 'approver' }
  if (!e) return { ok: false, why: 'I could not match your Slack account to a Lighthouse login' }
  let desk = false
  try { desk = (await getAgentSettings()).deskApprovals } catch { desk = false }
  if (!desk) return { ok: false, why: 'Only an approver can decide this (Settings → Eve → Agent mode)' }
  const allDesk = rows.length > 0 && rows.every(r => r.kind === 'guest_draft' || tierOf(String(r.payload?.action || ''), r.payload) === 'desk')
  return allDesk ? { ok: true, why: 'desk' } : { ok: false, why: 'Only an approver can decide this one — it is money, a cancellation or outside the desk' }
}

// ── posting ─────────────────────────────────────────────────────────────────────────────────────

/** A proposal into the approvals room, with the thread as the answer slot. Remembers the post on the row. */
export async function postProposalToSlack(id: string, p: { summary: string; why?: string; usd?: number }): Promise<{ ok: boolean; error?: string; ts?: string; channel?: string }> {
  const ch = await getApprovalsChannel()
  if (!ch) return { ok: false, error: 'no Slack approvals channel' }
  const text = `🤖 *Eve wants to:* ${p.summary.slice(0, 300)}${p.why ? `\n_Why:_ ${p.why.slice(0, 240)}` : ''}${p.usd ? `\n_Money:_ ${money(p.usd)}` : ''}\n\nReply *yes* in this thread and I'll do it · *no* and I'll drop it. (Also in Lighthouse → Eve → Agent mode.)`
  const r = await postToChannel(ch.id, text)
  if (!r.ok || !r.ts) return { ok: false, error: r.error || 'refused' }
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('payload').eq('id', id).maybeSingle()
    const pl = (data as any)?.payload || {}
    await supabaseAdmin().from('eve_actions').update({ payload: { ...pl, slack_channel: ch.id, slack_ts: String(r.ts), slack_sent_at: new Date().toISOString() } }).eq('id', id)
  } catch { /* the post is up; a reply will still be read by ts below if the row kept it */ }
  return { ok: true, ts: String(r.ts), channel: ch.id }
}

/**
 * THE APPROVALS DIGEST (Eve audit 2026-10-07). Proposals are queued (payload.slack_pending) by
 * agent-mode notifyProposal and go out here: ONE post, numbered, answered in its thread with
 * "1 yes", "2 no", "1 3 yes", "all yes" (or a bare yes/no when there is only one). Each row keeps the
 * post's ts and its number, so the reply finds it exactly as before. Upkeep proposals are not listed —
 * only counted, with the link to where they wait. Called from the hourly slack-watch cron. Returns how
 * many it listed.
 *
 * TWICE A DAY, THROUGH THE GATE (Jon, 2026-11-05: "more effective, more clear and useful"). It used to
 * flush every hour and could make three posts a pass. Now:
 *   · it flushes at most at the slots in app_settings `eve_approvals_digest` (default 9am and 3pm ET),
 *     and only between 8am and 7pm ET — a slot missed by a pass is caught by the next hourly pass;
 *   · ONE post per room per flush: the desk's asks and the drafts ready to send are one numbered list
 *     in #vr-customercareteam (they were two posts); owner asks stay in the approvals room, because
 *     money and door codes never go to the desk room;
 *   · every post passes lib/eve/room-gate (the 8pm–7am window, quiet hours, the said-registry and the
 *     unchanged per-room cap). A held list waits for the next slot; nothing is stamped as sent.
 * `force` (a person pressing run) skips the slot check, never the gate.
 */
export const DIGEST_MAX = 10
export const DIGEST_KEY = 'eve_approvals_digest'
const DIGEST_STATE_KEY = 'eve_approvals_digest_state'
export type DigestCfg = { slotsET: number[]; startET: number; endET: number }
export const DIGEST_DEFAULTS: DigestCfg = { slotsET: [9, 15], startET: 8, endET: 19 }
export async function getDigestCfg(): Promise<DigestCfg> {
  const v = await getSetting<any>(DIGEST_KEY, null)
  const d = DIGEST_DEFAULTS
  if (!v || typeof v !== 'object') return d
  const hr = (x: any, dd: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 23 ? Number(x) : dd)
  const slots = Array.isArray(v.slotsET) ? v.slotsET.map(Number).filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 23) : d.slotsET
  return { slotsET: slots.length ? slots.sort((a: number, b: number) => a - b) : d.slotsET, startET: hr(v.startET, d.startET), endET: hr(v.endET, d.endET) }
}

export async function flushApprovalDigest(opts: { preview?: boolean; force?: boolean } = {}): Promise<{ posted: number; waiting: number; upkeep: number; text?: string; error?: string; desk?: number; drafts?: number; skipped?: string; held?: string[] }> {
  // THE SLOT (Jon, 2026-11-05): 8am–7pm ET only, at most at each configured slot once a day.
  const { etHour, etDate, gatedPost } = await import('./room-gate')
  const cfg = await getDigestCfg()
  const h = etHour(), today = etDate()
  let slotKey = ''
  if (!opts.preview) {
    if (h < cfg.startET || h >= cfg.endET) return { posted: 0, waiting: 0, upkeep: 0, skipped: `outside ${cfg.startET}:00–${cfg.endET}:00 ET` }
    const slot = cfg.slotsET.filter(s => s <= h).pop()
    if (slot === undefined && !opts.force) return { posted: 0, waiting: 0, upkeep: 0, skipped: 'before the first slot' }
    slotKey = `${today}@${slot ?? h}`
    const st = (await getSetting<any>(DIGEST_STATE_KEY, null)) || {}
    if (!opts.force && st.last === slotKey) return { posted: 0, waiting: 0, upkeep: 0, skipped: `slot ${slotKey} already flushed` }
  }
  const db = supabaseAdmin()
  const since = new Date(Date.now() - 3 * 86400_000).toISOString()
  const { data } = await db.from('eve_actions').select('id,kind,payload,status,created_at').in('kind', ['ask', 'guest_draft']).eq('status', 'proposed').gte('created_at', since).order('created_at', { ascending: true }).limit(300)
  const all = ((data as any[]) || [])
  const rows = all.filter(r => r.kind === 'ask' && r.payload?.type === 'action')
  // Panel-only watches never reach Slack, including any queued before they were made panel-only.
  const { PANEL_ONLY_WATCHES } = await import('./agent-mode')
  const pending = rows.filter(r => r.payload?.slack_pending === true && !r.payload?.slack_ts && !PANEL_ONLY_WATCHES.has(String(r.payload?.watchKey || '')))
  const upkeep = rows.filter(r => r.payload?.slack_skip === 'upkeep').length
  // DRAFTS READY (Eve audit 2026-10-10): a reply Eve already wrote for a guest past the reply-by time,
  // waiting for a person to send it. It used to wait silently on /messages; the desk never knew.
  const drafts = all.filter(r => r.kind === 'guest_draft' && r.payload?.slack_pending === true && !r.payload?.slack_ts && r.payload?.conversationId)
  // THE DESK'S OWN WORK GOES TO THE DESK (Eve audit 2026-10-10). Tasks, guest drafts and sends — no
  // money — are listed in #vr-customercareteam, where the people who can say yes are; everything else
  // goes to the approvals channel for the approver list, as before.
  const deskRows = pending.filter(r => tierOf(String(r.payload?.action || ''), r.payload) === 'desk')
  const ownerRows = pending.filter(r => !deskRows.includes(r))
  const markSlot = async () => { if (slotKey) { try { await setSetting(DIGEST_STATE_KEY, { last: slotKey, at: new Date().toISOString() }, 'slack-approvals') } catch { /* next pass may try again */ } } }
  if (!pending.length && !drafts.length) { if (!opts.preview) await markSlot(); return { posted: 0, waiting: 0, upkeep, desk: 0, drafts: 0 } }
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
  const line = (r: any, i: number) => {
    const pl = r.payload || {}
    const why = String(pl.why || '').replace(/\s+/g, ' ').slice(0, 140)
    const usd = Number(pl.usd) || 0
    return `*${i + 1}.* ${String(pl.summary || '').replace(/\s+/g, ' ').slice(0, 220)}${usd ? ` · ${money(usd)}` : ''}${why ? `\n      _${why}_` : ''}`
  }
  const previews: string[] = []
  const held: string[] = []
  let posted = 0, error: string | undefined
  const stamp = async (list: any[], chId: string, ts: string, offset = 0) => {
    for (let i = 0; i < list.length; i++) {
      const pl = list[i].payload || {}
      try { await db.from('eve_actions').update({ payload: { ...pl, slack_pending: false, slack_channel: chId, slack_ts: ts, slack_index: offset + i + 1, slack_sent_at: new Date().toISOString() } }).eq('id', list[i].id) } catch { /* the reply will miss this one; it still waits in Lighthouse */ }
    }
  }

  // 1. Owner-tier asks → the approvals channel.
  if (ownerRows.length) {
    const ch = await getApprovalsChannel()
    if (!ch) error = 'no Slack approvals channel'
    else {
      const list = ownerRows.slice(0, DIGEST_MAX)
      const one = list.length === 1
      const text = [
        `🤖 *Eve wants to (${list.length})* — ${one ? 'reply *yes* or *no* in this thread.' : 'reply in this thread: \`1 yes\` · \`2 no\` · \`1 3 yes\` · \`all yes\`.'}`,
        list.map(line).join('\n'),
        ownerRows.length > list.length ? `_…${ownerRows.length - list.length} more in the next list._` : '',
        upkeep ? `_${upkeep} preventative upkeep task${upkeep === 1 ? '' : 's'} waiting on <${base}/upkeep|the Upkeep page> — not listed here._` : '',
      ].filter(Boolean).join('\n')
      if (opts.preview) previews.push(text)
      else {
        const r = await gatedPost({ channel: ch.id, text, by: 'cron:approvals-digest', summary: `approvals digest in the approvals room (${list.length})` })
        if (r.held) held.push(`approvals room: ${r.held}`)
        else if (!r.ok || !r.ts) error = r.error || 'refused'
        else { await stamp(list, ch.id, String(r.ts)); posted += list.length }
      }
    }
  }
  // 2. The desk's asks AND the drafts ready to send → ONE numbered list in the customer care room,
  // answerable by the team: "1 yes" does an ask, "3 send" sends a draft as the person who said so.
  if (deskRows.length || drafts.length) {
    const asks = deskRows.slice(0, DIGEST_MAX)
    const dList = drafts.slice(0, DIGEST_MAX)
    const dline = (r: any, i: number) => {
      const pl = r.payload || {}
      const who = `${String(pl.guest || 'the guest')}${pl.unit ? ` (${String(pl.unit)})` : ''}`
      const why = String(r.why || '').replace(/\s+/g, ' ').slice(0, 100)
      return `*${i + 1}.* ${who}${why ? ` — _${why}_` : ''}\n      “${String(pl.draft || '').replace(/\s+/g, ' ').slice(0, 320)}${String(pl.draft || '').length > 320 ? '…' : ''}”\n      <${base}/messages/${encodeURIComponent(String(pl.conversationId))}|open the thread to edit>`
    }
    const total = asks.length + dList.length
    const one = total === 1
    const text = [
      `🛎️ *For the desk (${total})* — anyone on the team: ${one ? (asks.length ? 'reply *yes* or *no* in this thread.' : 'reply *send* here and it goes to the guest as you; *no* drops it.') : 'reply in this thread with \`1 yes\` · \`2 no\` · \`3 send\` · \`all yes\`; a draft goes to the guest as you.'}`,
      asks.length ? `*Eve can do these (${asks.length})*\n${asks.map(line).join('\n')}` : '',
      deskRows.length > asks.length ? `_…${deskRows.length - asks.length} more in the next list._` : '',
      dList.length ? `*Replies drafted, waiting to be sent (${dList.length})* — to change the wording, open the thread.\n${dList.map((r, i) => dline(r, asks.length + i)).join('\n')}` : '',
      drafts.length > dList.length ? `_…${drafts.length - dList.length} more waiting on /messages._` : '',
      asks.length ? `_No money and no door codes here — those still go to Jon._` : '',
    ].filter(Boolean).join('\n')
    if (opts.preview) previews.push(text)
    else {
      const r = await gatedPost({ channel: EVE_CHANNELS.ccsJon, text, by: 'cron:approvals-digest', summary: `desk list in #vr-customercareteam (${asks.length} asks, ${dList.length} drafts)` })
      if (r.held) held.push(`customer care room: ${r.held}`)
      else if (!r.ok || !r.ts) error = error || r.error || 'refused'
      else { await stamp(asks, EVE_CHANNELS.ccsJon, String(r.ts)); await stamp(dList, EVE_CHANNELS.ccsJon, String(r.ts), asks.length); posted += total }
    }
  }
  if (opts.preview) return { posted: 0, waiting: pending.length, upkeep, text: previews.join('\n\n— — —\n\n'), desk: deskRows.length, drafts: drafts.length }
  // The slot is spent once it was tried: a held list waits for the next slot, not the next hour.
  await markSlot()
  return { posted, waiting: Math.max(0, pending.length + drafts.length - posted), upkeep, error, desk: deskRows.length, drafts: drafts.length, held: held.length ? held : undefined }
}

/** Which numbers a reply decides, and how. "1 yes 2 no", "1,3 yes", "yes 2", "all yes". */
export function parseDigestReply(text: string, n: number): { idx: number; yes: boolean }[] {
  const t = String(text || '').toLowerCase().replace(/<@[a-z0-9]+>/g, ' ')
  const out: Record<number, boolean> = {}
  const verdict = (w: string) => (YES.test(w) ? true : NO.test(w) ? false : null)
  const nums = (s: string): number[] => /all|every|both/.test(s) ? Array.from({ length: n }, (_, i) => i + 1) : (s.match(/\d+/g) || []).map(Number).filter(x => x >= 1 && x <= n)
  const W = '(yes|y|yep|yeah|ok|okay|approve[d]?|go|do it|send(?: it)?|no|n|nope|nah|reject(?:ed)?|drop|skip|deny)'
  const L = '((?:all|every|both)|\\d+(?:\\s*(?:,|&|and|\\s)\\s*\\d+)*)'
  // "1 3 yes", "all yes", "2: no"
  for (const m of Array.from(t.matchAll(new RegExp(L + '\\s*[:.\\-–—=]?\\s*' + W + '\\b', 'g')))) { const v = verdict(m[2]); if (v != null) for (const i of nums(m[1])) out[i] = v }
  // "yes 1 3", "no to 2"
  for (const m of Array.from(t.matchAll(new RegExp('\\b' + W + '\\s*(?:to|for|on)?\\s*' + L, 'g')))) { const v = verdict(m[1]); if (v != null) for (const i of nums(m[2])) if (!(i in out)) out[i] = v }
  if (!Object.keys(out).length && n === 1) { const v = verdict(t.trim()); if (v != null) out[1] = v }
  return Object.keys(out).map(k => ({ idx: Number(k), yes: out[Number(k)] }))
}

/** A spend waiting on approval, into the approvals room. Called when the request is filed. */
export async function postSpendToSlack(req: { id: string | number; title?: string | null; amount_usd?: number | null; unit?: string | null; building?: string | null; vendor?: string | null; created_by_email?: string | null; description?: string | null; type?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const ch = await getApprovalsChannel()
  if (!ch) return { ok: false, error: 'no Slack approvals channel' }
  const where = [req.building, req.unit].filter(Boolean).join(' · ')
  const who = String(req.created_by_email || '').split('@')[0]
  const amt = Number(req.amount_usd) > 0 ? money(Number(req.amount_usd)) : 'amount not set'
  const text = `💵 *Spend to approve — ${amt}:* ${String(req.title || req.type || 'request').slice(0, 200)}${where ? `\n_Where:_ ${where}` : ''}${req.vendor ? `\n_Vendor:_ ${req.vendor}` : ''}${who ? `\n_Asked by:_ ${who}` : ''}${req.description ? `\n_Note:_ ${String(req.description).slice(0, 240)}` : ''}\n\nReply *yes* in this thread to approve · *no* to reject.`
  const r = await postToChannel(ch.id, text)
  if (!r.ok || !r.ts) return { ok: false, error: r.error || 'refused' }
  try {
    const cur = (await getSetting<Record<string, SpendPost>>(SPEND_POSTS_KEY, {})) || {}
    const keep: Record<string, SpendPost> = {}
    const cutoff = Date.now() - 14 * 86400000
    for (const k of Object.keys(cur)) if (Date.parse(cur[k]?.at || '') > cutoff) keep[k] = cur[k]
    keep[String(r.ts)] = { id: String(req.id), channel: ch.id, at: new Date().toISOString(), title: String(req.title || '').slice(0, 120) }
    await setSetting(SPEND_POSTS_KEY, keep, 'slack-approvals')
  } catch { /* the post is up; without the map a reply cannot find it — the Lighthouse buttons still work */ }
  return { ok: true }
}

// ── replies ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A thread reply that may be an answer to an ask. Returns true when it was one (handled, answered in
 * the thread), false when the thread is not an ask — the caller carries on as before.
 */
export async function handleApprovalReply(ev: { channel?: string; thread_ts?: string; ts?: string; user?: string; text?: string }): Promise<boolean> {
  const channel = String(ev.channel || ''), root = String(ev.thread_ts || '')
  if (!channel || !root || root === String(ev.ts || '') || !ev.user) return false
  const text = String(ev.text || '').replace(/<@[A-Z0-9]+>/g, '').trim()   // '@Eve yes' is a yes
  const yes = YES.test(text), no = !yes && NO.test(text)

  // Which ask is this thread? A proposal first (its row carries the ts), then a spend (the map).
  let proposal: any = null
  let digest: any[] = []
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,kind,status,payload,why').eq('payload->>slack_ts', root).limit(DIGEST_MAX + 5)
    const found = (data || []) as any[]
    if (found.length > 1 || (found[0] && found[0].payload?.slack_index)) digest = found.sort((a, b) => Number(a.payload?.slack_index || 0) - Number(b.payload?.slack_index || 0))
    else proposal = found[0] || null
  } catch { proposal = null }
  if (digest.length && digest.every(r => r.kind === 'guest_draft')) return await decideDraftDigest(channel, root, String(ev.user), text, digest)
  // ONE DESK LIST (Jon, 2026-11-05): asks and drafts share a numbered list now — each number goes to its own path.
  if (digest.length && digest.some(r => r.kind === 'guest_draft')) return await decideMixedDigest(channel, root, String(ev.user), text, digest)
  if (digest.length) return await decideDigest(channel, root, String(ev.user), text, digest)
  if (proposal && proposal.kind === 'guest_draft') return await decideDraftDigest(channel, root, String(ev.user), text, [proposal])
  let spend: SpendPost | null = null
  if (!proposal) {
    try { const m = (await getSetting<Record<string, SpendPost>>(SPEND_POSTS_KEY, {})) || {}; spend = m[root] || null } catch { spend = null }
  }
  if (!proposal && !spend) return false

  const reply = (t: string) => postThreadReply(channel, root, t).catch(() => null)
  if (!yes && !no) { await reply(`Reply *yes* to approve or *no* to drop it.`); return true }

  const email = await emailForSlackUser(String(ev.user)).catch(() => null)
  const may = proposal ? await canDecide(email, [proposal]) : { ok: await isApprover(email), why: 'Only an approver can decide a spend (Settings → Eve → Agent mode)' + (email ? '' : ' — and I could not match your Slack account to a Lighthouse login') }
  if (!may.ok) { await reply(may.why + '.'); return true }
  const by = String(email)

  if (proposal) {
    if (proposal.status !== 'proposed') { await reply(`Already ${proposal.status}.`); return true }
    if (no) { await rejectProposal(String(proposal.id), by, text); await reply(`Dropped — I won't do that. (${by.split('@')[0]})`); return true }
    const res = await executeProposal(String(proposal.id), by)
    await reply(res.ok ? `Done — ${res.done}. It's on my log.${res.undo ? ' Reply *undo* in Lighthouse within 24h to put it back.' : ''} (${by.split('@')[0]})` : `I couldn't: ${res.error}`)
    return true
  }

  // A spend: the same columns the Decide buttons write (app/api/requests/update, action 'decide').
  try {
    const db = supabaseAdmin()
    const { data: cur } = await db.from('field_requests').select('id,approval_status,title,amount_usd').eq('id', spend!.id).maybeSingle()
    if (!cur) { await reply(`That request is gone.`); return true }
    if ((cur as any).approval_status && (cur as any).approval_status !== 'pending') { await reply(`Already ${(cur as any).approval_status}.`); return true }
    const approved = yes
    const { error } = await db.from('field_requests').update({
      approval_status: approved ? 'approved' : 'rejected',
      status: approved ? 'open' : 'rejected',
      approver_email: by, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', spend!.id)
    if (error) throw error
    bustDay()
    const amt = Number((cur as any).amount_usd) > 0 ? ' ' + money(Number((cur as any).amount_usd)) : ''
    await reply(approved ? `✅ Approved${amt} — ${String((cur as any).title || '').slice(0, 120)}. (${by.split('@')[0]})` : `❌ Rejected — ${String((cur as any).title || '').slice(0, 120)}. (${by.split('@')[0]})`)
  } catch (e: any) { await reply(`I couldn't record that: ${String(e?.message || e).slice(0, 120)}`) }
  return true
}

/** A reply under an approvals digest: decide each number it names. */
async function decideDigest(channel: string, root: string, user: string, text: string, rows: any[]): Promise<boolean> {
  const reply = (t: string) => postThreadReply(channel, root, t).catch(() => null)
  const n = rows.length
  const picks = parseDigestReply(text, n)
  if (!picks.length) {
    // Not an answer (a question, a comment): say how to answer once, briefly.
    await reply(n === 1 ? 'Reply *yes* or *no*.' : 'Reply with the numbers, like `1 yes`, `2 no` or `all yes`.')
    return true
  }
  const email = await emailForSlackUser(user).catch(() => null)
  const chosen = picks.map(pk => rows.find(r => Number(r.payload?.slack_index) === pk.idx) || rows[pk.idx - 1]).filter(Boolean)
  const may = await canDecide(email, chosen.length ? chosen : rows)
  if (!may.ok) { await reply(may.why + '.'); return true }
  const by = String(email)
  const lines: string[] = []
  for (const pk of picks.sort((a, b) => a.idx - b.idx)) {
    const row = rows.find(r => Number(r.payload?.slack_index) === pk.idx) || rows[pk.idx - 1]
    if (!row) continue
    if (row.status !== 'proposed') { lines.push(`${pk.idx}. already ${row.status}`); continue }
    if (!pk.yes) { await rejectProposal(String(row.id), by, text); lines.push(`${pk.idx}. dropped`); continue }
    const res = await executeProposal(String(row.id), by)
    lines.push(res.ok ? `${pk.idx}. done — ${String(res.done || '').slice(0, 120)}` : `${pk.idx}. couldn't: ${String(res.error || '').slice(0, 120)}`)
  }
  await reply(`${lines.join('\n')}\n(${by.split('@')[0]})`)
  return true
}

/**
 * A reply under the drafts list: "1 send" sends draft 1 to the guest AS THE PERSON WHO SAID SO — the
 * same path as the Send button on /inbox (guest_reply_send, human:true), so the thread shows their
 * name and the response clock counts them. "2 no" discards. Any team member with a Lighthouse login.
 */
async function decideDraftDigest(channel: string, root: string, user: string, text: string, rows: any[]): Promise<boolean> {
  const reply = (t: string) => postThreadReply(channel, root, t).catch(() => null)
  // Numbers can run past the row count (Jon, 2026-11-05): the daily "Fixed" post adds items in its thread, numbered on.
  const n = Math.max(rows.length, ...rows.map(r => Number(r.payload?.slack_index) || 0))
  const picks = parseDigestReply(text, n)
  if (!picks.length) { await reply(n === 1 ? 'Reply *send* to send it to the guest, or *no* to drop the draft.' : 'Reply with the numbers, like `1 send`, `2 no` or `all send`.'); return true }
  const email = await emailForSlackUser(user).catch(() => null)
  const may = await canDecide(email, rows)
  if (!may.ok) { await reply(may.why + '.'); return true }
  const by = String(email)
  const lines = await sendDraftPicks(rows, picks, by)
  await reply(`${lines.join('\n')}\n(${by.split('@')[0]})`)
  return true
}

/**
 * A reply under the ONE DESK LIST (Jon, 2026-11-05): numbered asks and drafts together. An ask's number
 * runs the ask path; a draft's number runs the send path — and a draft goes to a guest only when the
 * reply says "send", so "all yes" never messages a guest by accident.
 */
async function decideMixedDigest(channel: string, root: string, user: string, text: string, rows: any[]): Promise<boolean> {
  const reply = (t: string) => postThreadReply(channel, root, t).catch(() => null)
  const n = Math.max(rows.length, ...rows.map(r => Number(r.payload?.slack_index) || 0))
  const picks = parseDigestReply(text, n)
  if (!picks.length) { await reply('Reply with the numbers, like `1 yes`, `2 no` or `3 send`.'); return true }
  const rowAt = (i: number) => rows.find(r => Number(r.payload?.slack_index) === i) || null
  const email = await emailForSlackUser(user).catch(() => null)
  const chosen = picks.map(pk => rowAt(pk.idx)).filter(Boolean)
  const may = await canDecide(email, chosen.length ? chosen : rows)
  if (!may.ok) { await reply(may.why + '.'); return true }
  const by = String(email)
  const saysSend = /\bsend\b/i.test(text)
  const lines: string[] = []
  for (const pk of picks.sort((a, b) => a.idx - b.idx)) {
    const row = rowAt(pk.idx)
    if (!row) continue
    if (row.kind === 'guest_draft') {
      if (pk.yes && !saysSend) { lines.push(`${pk.idx}. a draft to a guest — reply \`${pk.idx} send\` to send it`); continue }
      lines.push(...(await sendDraftPicks([row], [{ idx: pk.idx, yes: pk.yes }], by)))
    } else {
      if (row.status !== 'proposed') { lines.push(`${pk.idx}. already ${row.status}`); continue }
      if (!pk.yes) { await rejectProposal(String(row.id), by, text); lines.push(`${pk.idx}. dropped`); continue }
      const res = await executeProposal(String(row.id), by)
      lines.push(res.ok ? `${pk.idx}. done — ${String(res.done || '').slice(0, 120)}` : `${pk.idx}. couldn't: ${String(res.error || '').slice(0, 120)}`)
    }
  }
  await reply(`${lines.join('\n')}\n(${by.split('@')[0]})`)
  return true
}

/** Send (or drop) the picked drafts as `by`. Returns one line per pick. */
async function sendDraftPicks(rows: any[], picks: { idx: number; yes: boolean }[], by: string): Promise<string[]> {
  const db = supabaseAdmin()
  const nowISO = new Date().toISOString()
  const lines: string[] = []
  // By its number only; the position fallback is for rows posted before numbers were kept — a number
  // that names a line with no draft must never send a different guest's draft.
  const numbered = rows.some(r => Number(r.payload?.slack_index) > 0)
  for (const pk of picks.sort((a, b) => a.idx - b.idx)) {
    const row = rows.find(r => Number(r.payload?.slack_index) === pk.idx) || (numbered ? null : rows[pk.idx - 1])
    if (!row) { lines.push(`${pk.idx}. no draft on that line`); continue }
    const pl = row.payload || {}
    // Claim it first — the Lighthouse Send button and this reply must never both send.
    const { data: claim } = await db.from('eve_actions').update({ status: pk.yes ? 'approved' : 'rejected', decided_by: by, decided_at: nowISO }).eq('id', row.id).eq('status', 'proposed').select('id')
    if (!((claim as any[]) || []).length) { lines.push(`${pk.idx}. already handled in Lighthouse`); continue }
    if (!pk.yes) {
      await db.from('eve_actions').update({ status: 'rejected', result: { note: 'dropped from Slack by ' + by } }).eq('id', row.id)
      lines.push(`${pk.idx}. dropped`); continue
    }
    try {
      const { runExecutor } = await import('./executors')
      const r = await runExecutor('guest_reply_send', { conversationId: String(pl.conversationId), body: String(pl.draft || '') }, { by: 'chat', actor: by, human: true })
      await db.from('eve_actions').update({ status: r.ok ? 'executed' : 'failed', executed_at: r.ok ? nowISO : null, result: { by, ok: r.ok, done: r.ok ? r.summary : null, error: r.ok ? null : r.error, via: 'slack' } }).eq('id', row.id)
      const { recordAgentAction } = await import('./agent-mode')
      await recordAgentAction('guest_reply_send', { rung: 2, allowed: r.ok, mode: 'act', reason: r.ok ? `sent by ${by} from Slack` : `send by ${by} failed: ${r.error}`, summary: r.summary, ref: r.ref || null, by: 'chat', actor: by, countAs: 'none' })
      // The note said "it's sorted" for a glitch: the glitch goes to the manager to close.
      let closing = ''
      if (r.ok) { try { const { glitchIdOfDraft, requestGlitchCompletion } = await import('@/lib/glitch-complete'); const gid = glitchIdOfDraft(pl); if (gid) { const c = await requestGlitchCompletion(gid, by, `guest told via Eve's note, sent from Slack by ${by.split('@')[0]}`); if (c.ok && c.status === 'manager_review') closing = ' · glitch sent to the manager to close' } } catch { /* the send stands */ } }
      lines.push(r.ok ? `${pk.idx}. sent to ${String(pl.guest || 'the guest')}${closing}` : `${pk.idx}. couldn't send: ${String(r.error || r.summary || '').slice(0, 120)}`)
    } catch (e: any) {
      await db.from('eve_actions').update({ status: 'failed', result: { by, ok: false, error: String(e?.message || e).slice(0, 200) } }).eq('id', row.id)
      lines.push(`${pk.idx}. couldn't send: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  return lines
}
