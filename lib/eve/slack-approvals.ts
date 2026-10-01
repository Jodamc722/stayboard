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
import { getAgentSettings, executeProposal, rejectProposal } from './agent-mode'
import { getApprovalsChannel } from './approvals'

const SPEND_POSTS_KEY = 'slack_spend_posts'
type SpendPost = { id: string; channel: string; at: string; title?: string }

export const YES = /^\s*(y|ya|yes|yep|yeah|yup|ok|okay|sure|go|go ahead|do it|please do|approved?|approve it|✅|👍)\b/i
export const NO = /^\s*(n|no|nope|nah|reject(ed)?|deny|denied|decline[d]?|drop( it)?|don'?t|do not|stop|❌|👎)\b/i

const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })

async function isApprover(email: string | null): Promise<boolean> {
  const e = String(email || '').toLowerCase().trim()
  if (!e) return false
  if (isSuperadmin(e)) return true
  try { const s = await getAgentSettings(); return s.approvers.map(x => String(x).toLowerCase()).indexOf(e) >= 0 } catch { return false }
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
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,status,payload').eq('payload->>slack_ts', root).limit(1)
    proposal = (data || [])[0] || null
  } catch { proposal = null }
  let spend: SpendPost | null = null
  if (!proposal) {
    try { const m = (await getSetting<Record<string, SpendPost>>(SPEND_POSTS_KEY, {})) || {}; spend = m[root] || null } catch { spend = null }
  }
  if (!proposal && !spend) return false

  const reply = (t: string) => postThreadReply(channel, root, t).catch(() => null)
  if (!yes && !no) { await reply(`Reply *yes* to approve or *no* to drop it.`); return true }

  const email = await emailForSlackUser(String(ev.user)).catch(() => null)
  if (!(await isApprover(email))) {
    await reply(`Only an approver can decide this (Settings → Eve → Agent mode)${email ? '' : ' — and I could not match your Slack account to a Lighthouse login'}.`)
    return true
  }
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
