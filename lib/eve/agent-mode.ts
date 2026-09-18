// AGENT MODE — the switch and the fence.
//
// Jon, 2026-09-18: "How do we make Eve agentic? Need a turn-on button for agent mode and an off
// button as well. Also need to set parameters for her."
//
// WHAT THIS IS. Every path where Eve does something OUTSIDE her own notebook — posts in Slack, pings
// Telegram, releases a door code, files a task — asks this file first. One master switch (OFF means
// she observes and drafts and nothing leaves the app), then one autonomy RUNG per kind of action:
//
//   0 observe   — she notes it in her log and does nothing
//   1 draft     — she writes it down (eve_actions kind 'draft') for a person to pick up
//   2 propose   — she files it for approval and asks (Telegram / Slack); a person taps yes
//   3 act       — she does it inside the fence, and it is reversible
//   4 act+report — she does it and only reports the exceptions
//
// Some rungs are welded shut. Money, anything a guest experiences directly, door codes, writes into
// Guesty and calendar blocks never go above 2 — the UI cannot raise them and this file clamps them
// even if the stored JSON says otherwise. "Money and anything a guest can't un-experience stay at
// rung 2."
//
// WHEN SHE IS NOT ALLOWED, SHE STEPS DOWN A RUNG rather than failing: an act becomes a proposal, a
// proposal becomes a draft, a draft becomes a log line. The caller reads `mode` and does the
// smaller thing. Every decision — allowed or not — is one row in eve_agent_log, so "why didn't she
// post that" is a query, not a debate.
//
// THE KILL PATH. `enabled:false` must stop everything within one request, so the setting is read
// FRESH here (app_settings has a 60s cache; this bypasses it on purpose). A stale "on" for a minute
// after Jon hits OFF is the one latency this design refuses to have.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { setSetting } from '@/lib/app-settings'
import { todayET } from './ctx'

export const AGENT_KEY = 'eve_agent'
export const AGENT_COUNTERS_KEY = 'eve_agent_counters'
export const OWNER = 'jon@stay-hospitality.com'

// ---- The action inventory ------------------------------------------------------------------------

export type ActionType =
  | 'slack_post' | 'telegram_ask' | 'email_draft' | 'email_send'
  | 'guest_reply_draft' | 'guest_reply_send'
  | 'task_create' | 'task_assign' | 'task_note' | 'task_cancel'
  | 'door_code_release' | 'guesty_write' | 'calendar_block'
  | 'recommendation' | 'memory_rule'

export type Rung = 0 | 1 | 2 | 3 | 4
export type Mode = 'observe' | 'draft' | 'propose' | 'act'

export type ActionDef = {
  key: ActionType
  label: string
  what: string
  /** Default rung when agent mode is switched on. */
  def: Rung
  /** Hard ceiling. The UI shows a lock above it and this file clamps to it. */
  cap: Rung
  /** Where in the code this gate is enforced — shown in the UI so nobody has to guess. */
  wiredAt: string[]
}

export const ACTIONS: ActionDef[] = [
  { key: 'slack_post', label: 'Post in Slack', what: 'Nudges in a thread, the urgent-today post, the morning roll-up in #vr-eve, door-code approval posts.', def: 3, cap: 4,
    wiredAt: ['lib/eve/slack-watch.ts (nudge, urgent, digest)', 'lib/eve/approvals.ts postDoorCodeApproval'] },
  { key: 'telegram_ask', label: 'Ask on Telegram', what: 'The morning ask (findings, questions), proposals waiting on a yes, approved questions to Ralphbot.', def: 2, cap: 4,
    wiredAt: ['lib/eve/ask.ts deliverOne', 'lib/eve/ralph.ts sendApproved', 'lib/eve/agent-mode.ts proposeAction'] },
  { key: 'email_draft', label: 'Draft an email', what: 'A Gmail draft in a connected mailbox. Nobody receives it until a person sends it.', def: 2, cap: 4, wiredAt: [] },
  { key: 'email_send', label: 'Send an email', what: 'An email leaving the company. Permanently propose-only.', def: 2, cap: 2, wiredAt: [] },
  { key: 'guest_reply_draft', label: 'Draft a guest reply', what: 'A reply written into the guest thread as a draft, not sent.', def: 2, cap: 4, wiredAt: [] },
  { key: 'guest_reply_send', label: 'Message a guest', what: 'A message the guest actually receives. Permanently propose-only.', def: 2, cap: 2, wiredAt: [] },
  { key: 'task_create', label: 'Create a task', what: 'A new Breezeway task.', def: 2, cap: 4, wiredAt: [] },
  { key: 'task_assign', label: 'Assign a task', what: 'Put a task on somebody\'s board.', def: 2, cap: 4, wiredAt: [] },
  { key: 'task_note', label: 'Note on a task', what: 'A comment on an existing Breezeway task.', def: 2, cap: 4, wiredAt: [] },
  { key: 'task_cancel', label: 'Cancel a task', what: 'Cancel a Breezeway task.', def: 2, cap: 3, wiredAt: [] },
  { key: 'door_code_release', label: 'Release a door code', what: 'Hand a code to a person. Permanently propose-only; a person set to Direct is their own approver.', def: 2, cap: 2,
    wiredAt: ['lib/eve/core.ts door_code_check'] },
  { key: 'guesty_write', label: 'Write to Guesty', what: 'Reservation notes, custom fields. Permanently propose-only.', def: 2, cap: 2, wiredAt: [] },
  { key: 'calendar_block', label: 'Block a calendar', what: 'Block or unblock nights in Guesty. Permanently propose-only.', def: 2, cap: 2, wiredAt: [] },
  { key: 'recommendation', label: 'Log a recommendation', what: 'Her ledger — graded later, changes nothing until accepted.', def: 1, cap: 1,
    wiredAt: ['lib/eve/core.ts recommend', 'lib/eve/review.ts plans'] },
  { key: 'memory_rule', label: 'Write a memory', what: 'Her own notebook. At 0 she stops learning on her own; Jon can still teach her.', def: 1, cap: 1,
    wiredAt: ['lib/eve/core.ts remember', 'lib/eve/slack-watch.ts facts', 'lib/eve/run.ts auto-capture'] },
]
export const ACTION_KEYS = ACTIONS.map(a => a.key)

export const RUNG_MEANING: Record<Rung, string> = {
  0: 'Observe — she notes it and does nothing.',
  1: 'Draft — she writes it down for a person to pick up.',
  2: 'Propose — she files it and asks; a person taps yes.',
  3: 'Act — she does it inside the fence; it can be undone.',
  4: 'Act and report — she does it and only tells you about exceptions.',
}

// ---- Settings ------------------------------------------------------------------------------------

export type AgentSettings = {
  enabled: boolean
  rungs: Record<ActionType, Rung>
  budgets: { asksPerDay: number; actionsPerDay: number; aiUsdPerDay: number; moneyCeilingUsd: number }
  quietHours: { start: string; end: string; tz: string }
  approvers: string[]
  channels: { telegram: boolean; slack: boolean; email: boolean }
  updatedBy?: string | null
  updatedAt?: string | null
}

const DEFAULT_BUDGETS = { asksPerDay: 6, actionsPerDay: 40, aiUsdPerDay: 15, moneyCeilingUsd: 0 }
const DEFAULT_QUIET = { start: '22:00', end: '07:00', tz: 'America/New_York' }

export function defaultRungs(): Record<ActionType, Rung> {
  const out: any = {}
  for (const a of ACTIONS) out[a.key] = a.def
  return out
}

function clampRung(v: any, cap: Rung): Rung {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(cap, n)) as Rung
}

/** Normalise whatever is stored into a complete, clamped settings object. */
export function normalizeAgentSettings(raw: any): AgentSettings {
  const r = raw && typeof raw === 'object' ? raw : {}
  const rungs: any = defaultRungs()
  const stored = r.rungs && typeof r.rungs === 'object' ? r.rungs : {}
  for (const a of ACTIONS) if (stored[a.key] != null) rungs[a.key] = clampRung(stored[a.key], a.cap)
  const b = r.budgets && typeof r.budgets === 'object' ? r.budgets : {}
  const num = (v: any, d: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : d }
  const q = r.quietHours && typeof r.quietHours === 'object' ? r.quietHours : {}
  const hhmm = (v: any, d: string) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : d)
  const ch = r.channels && typeof r.channels === 'object' ? r.channels : {}
  const approvers = Array.isArray(r.approvers) ? r.approvers.map((e: any) => String(e).toLowerCase().trim()).filter((e: string) => /@/.test(e)) : []
  return {
    enabled: r.enabled === true,
    rungs,
    budgets: {
      asksPerDay: num(b.asksPerDay, DEFAULT_BUDGETS.asksPerDay, 200),
      actionsPerDay: num(b.actionsPerDay, DEFAULT_BUDGETS.actionsPerDay, 2000),
      aiUsdPerDay: num(b.aiUsdPerDay, DEFAULT_BUDGETS.aiUsdPerDay, 10000),
      moneyCeilingUsd: num(b.moneyCeilingUsd, DEFAULT_BUDGETS.moneyCeilingUsd, 1_000_000),
    },
    quietHours: { start: hhmm(q.start, DEFAULT_QUIET.start), end: hhmm(q.end, DEFAULT_QUIET.end), tz: String(q.tz || DEFAULT_QUIET.tz) },
    approvers: approvers.length ? approvers : [OWNER],
    channels: { telegram: ch.telegram !== false, slack: ch.slack !== false, email: ch.email === true },
    updatedBy: r.updatedBy || null,
    updatedAt: r.updatedAt || null,
  }
}

/**
 * READ FRESH, ON PURPOSE. lib/app-settings caches for a minute, which is right for presets and
 * wrong for a kill switch. This is one indexed read per acting decision; the acting paths are
 * rare and slow anyway (they talk to Slack or Telegram), so the cost is invisible.
 */
export async function getAgentSettings(): Promise<AgentSettings> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', AGENT_KEY).limit(1)
    const raw = Array.isArray(data) && data[0] ? (data[0] as any).value : null
    let parsed: any = null
    if (raw && typeof raw === 'object') parsed = raw
    else if (typeof raw === 'string' && raw) { try { parsed = JSON.parse(raw) } catch { parsed = null } }
    return normalizeAgentSettings(parsed)
  } catch { return normalizeAgentSettings(null) }   // fail CLOSED: no row, no read → OFF
}

export async function saveAgentSettings(patch: any, by: string): Promise<{ ok: boolean; settings: AgentSettings; error?: string }> {
  const current = await getAgentSettings()
  const merged = normalizeAgentSettings({
    ...current,
    ...(patch && typeof patch === 'object' ? patch : {}),
    rungs: { ...current.rungs, ...(patch?.rungs && typeof patch.rungs === 'object' ? patch.rungs : {}) },
    budgets: { ...current.budgets, ...(patch?.budgets && typeof patch.budgets === 'object' ? patch.budgets : {}) },
    quietHours: { ...current.quietHours, ...(patch?.quietHours && typeof patch.quietHours === 'object' ? patch.quietHours : {}) },
    channels: { ...current.channels, ...(patch?.channels && typeof patch.channels === 'object' ? patch.channels : {}) },
  })
  merged.updatedBy = by
  merged.updatedAt = new Date().toISOString()
  const res = await setSetting(AGENT_KEY, merged, by)
  if (!res.ok) return { ok: false, settings: current, error: res.error }
  await logAgent({ action: 'memory_rule', rung: 0, allowed: true, mode: 'observe', reason: `settings changed: ${current.enabled === merged.enabled ? 'parameters' : merged.enabled ? 'AGENT MODE ON' : 'AGENT MODE OFF'}`, summary: JSON.stringify({ enabled: merged.enabled, rungs: merged.rungs, budgets: merged.budgets }).slice(0, 400), by: 'chat', actor: by })
  return { ok: true, settings: merged }
}

// ---- Counters (per ET day) -----------------------------------------------------------------------

export type AgentCounters = { date: string; actions: number; asks: number; byAction: Record<string, number> }

async function readCounters(): Promise<AgentCounters> {
  const today = todayET()
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', AGENT_COUNTERS_KEY).limit(1)
    const raw = Array.isArray(data) && data[0] ? (data[0] as any).value : null
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (c && c.date === today) return { date: today, actions: Number(c.actions) || 0, asks: Number(c.asks) || 0, byAction: c.byAction && typeof c.byAction === 'object' ? c.byAction : {} }
  } catch { /* fresh day */ }
  return { date: today, actions: 0, asks: 0, byAction: {} }
}

export async function getCounters(): Promise<AgentCounters> { return readCounters() }

/** Dollars Eve's own tasks have spent today (ET), from the ai_usage ledger. */
export async function aiSpendToday(): Promise<number> {
  try {
    // Midnight ET as an ISO instant: take today's ET date and ask Intl what UTC offset applies.
    const day = todayET()
    const sinceLocal = new Date(day + 'T00:00:00')
    const offsetMin = etOffsetMinutes(sinceLocal)
    const since = new Date(sinceLocal.getTime() - offsetMin * 60_000).toISOString()
    const { data } = await supabaseAdmin().from('ai_usage').select('task,cost_usd').gte('at', since).limit(5000)
    let usd = 0
    for (const r of ((data as any[]) || [])) {
      const t = String(r.task || '')
      if (/^(eve|learn|ops-focus|eve-review)/.test(t)) usd += Number(r.cost_usd) || 0
    }
    return Math.round(usd * 100) / 100
  } catch { return 0 }
}

/** Minutes east of UTC for America/New_York at a given instant (negative = west). */
function etOffsetMinutes(d: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(d)
    const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5'
    const m = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
    if (!m) return -300
    const h = Number(m[1]); const mm = Number(m[2] || 0)
    return h * 60 + (h < 0 ? -mm : mm)
  } catch { return -300 }
}

// ---- Quiet hours ---------------------------------------------------------------------------------

export function inQuietHours(s: AgentSettings, now = new Date()): boolean {
  try {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: s.quietHours.tz || 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const cur = toMin(hm), a = toMin(s.quietHours.start), b = toMin(s.quietHours.end)
    if (a === b) return false
    return a < b ? (cur >= a && cur < b) : (cur >= a || cur < b)   // wraps midnight
  } catch { return false }
}
function toMin(hhmm: string): number { const [h, m] = String(hhmm).split(':').map(Number); return ((h || 0) % 24) * 60 + (m || 0) }

// ---- The decision --------------------------------------------------------------------------------

export function modeOf(rung: Rung): Mode {
  return rung >= 3 ? 'act' : rung === 2 ? 'propose' : rung === 1 ? 'draft' : 'observe'
}
const RANK: Record<Mode, number> = { observe: 0, draft: 1, propose: 2, act: 3 }
function lower(a: Mode, b: Mode): Mode { return RANK[a] <= RANK[b] ? a : b }

export type AgentVerdict = {
  /** true only when the caller may DO the thing right now. */
  ok: boolean
  rung: Rung
  /** What the caller should do instead (or as well): act | propose | draft | observe. */
  mode: Mode
  reason: string
  needsApproval: boolean
  enabled: boolean
  settings: AgentSettings
}

/**
 * May Eve take this action right now? Never throws. Reads the switch fresh.
 *
 * `usd` is the money at stake, when there is any; `now` is for tests.
 */
export async function agentAllowed(action: ActionType, opts: { usd?: number; now?: Date; ask?: boolean } = {}): Promise<AgentVerdict> {
  const s = await getAgentSettings()
  const def = ACTIONS.find(a => a.key === action)
  const rung = clampRung(s.rungs[action] ?? (def ? def.def : 0), def ? def.cap : 2)
  let mode = modeOf(rung)
  const why: string[] = []
  const internal = rung <= 1 && def && def.cap <= 1   // recommendation / memory: never leave the app

  if (!s.enabled && !internal) {
    // OFF: nothing leaves the app. Drafts still get written, so the work is not lost — just parked.
    mode = lower(mode, 'draft'); why.push('agent mode is OFF')
  }
  if (mode === 'act' && inQuietHours(s, opts.now)) { mode = 'propose'; why.push(`quiet hours ${s.quietHours.start}–${s.quietHours.end} ${s.quietHours.tz}`) }

  const usd = Number(opts.usd)
  if (Number.isFinite(usd) && usd > 0 && mode === 'act' && usd > s.budgets.moneyCeilingUsd) {
    mode = 'propose'; why.push(`$${usd.toFixed(2)} is over the $${s.budgets.moneyCeilingUsd} ceiling`)
  }

  if (mode === 'act' || mode === 'propose') {
    const c = await readCounters()
    if (mode === 'act' && c.actions >= s.budgets.actionsPerDay) { mode = 'propose'; why.push(`today's ${s.budgets.actionsPerDay} actions are spent`) }
    const isAsk = action === 'telegram_ask' || opts.ask === true
    if (isAsk && c.asks >= s.budgets.asksPerDay) { mode = lower(mode, 'draft'); why.push(`today's ${s.budgets.asksPerDay} asks are spent`) }
    if (mode === 'act' && s.budgets.aiUsdPerDay > 0) {
      const spend = await aiSpendToday()
      if (spend >= s.budgets.aiUsdPerDay) { mode = 'propose'; why.push(`AI spend $${spend} is over today's $${s.budgets.aiUsdPerDay}`) }
    }
  }

  const reason = why.length ? why.join('; ') : (mode === 'act' ? `rung ${rung}: act` : `rung ${rung}: ${mode}`)
  return { ok: mode === 'act', rung, mode, reason, needsApproval: mode === 'propose', enabled: s.enabled, settings: s }
}

// ---- The log and the counters --------------------------------------------------------------------

export type AgentLogEntry = {
  action: ActionType
  rung: Rung
  allowed: boolean
  mode?: Mode
  reason?: string
  usd?: number | null
  summary?: string
  /** eve_actions id, task id, Slack ts — whatever lets a person find the thing. */
  ref?: string | null
  by: string   // 'eve' | 'cron:<name>' | 'chat'
  actor?: string | null
}

/** One row per decision. Best-effort: never throws, never blocks the caller for long. */
export async function logAgent(e: AgentLogEntry): Promise<void> {
  try {
    const ins = supabaseAdmin().from('eve_agent_log').insert({
      action: e.action, rung: e.rung, allowed: !!e.allowed, mode: e.mode || null,
      reason: (e.reason || '').slice(0, 300), usd: e.usd ?? null,
      summary: (e.summary || '').slice(0, 500), ref: e.ref ? String(e.ref).slice(0, 120) : null,
      by: String(e.by || 'eve').slice(0, 60), actor: e.actor ? String(e.actor).slice(0, 120) : null,
    })
    await Promise.race([ins, new Promise(res => setTimeout(res, 2000))])
  } catch { /* migration 100 not run, or a blip — the action still happens */ }
}

/**
 * Count it AND log it. Call after the thing actually happened (or was proposed / drafted).
 * `mode` decides which counter moves: an act counts against actions, an ask against asks.
 */
export async function recordAgentAction(action: ActionType, meta: Omit<AgentLogEntry, 'action'> & { countAs?: 'action' | 'ask' | 'none' }): Promise<void> {
  const countAs = meta.countAs || (meta.mode === 'act' ? 'action' : (action === 'telegram_ask' || meta.mode === 'propose') ? 'ask' : 'none')
  if (countAs !== 'none') {
    try {
      const c = await readCounters()
      if (countAs === 'action') c.actions++
      else c.asks++
      c.byAction[action] = (c.byAction[action] || 0) + 1
      await setSetting(AGENT_COUNTERS_KEY, c, meta.by)
    } catch { /* counters are advisory */ }
  }
  await logAgent({ action, ...meta })
}

/** The "Today" strip. */
export async function agentToday(): Promise<{ date: string; actions: number; asks: number; aiUsd: number; byAction: Record<string, number> }> {
  const [c, usd] = await Promise.all([readCounters(), aiSpendToday()])
  return { date: c.date, actions: c.actions, asks: c.asks, aiUsd: usd, byAction: c.byAction }
}

// ---- Stepping down: drafts and proposals ---------------------------------------------------------

export type Proposal = {
  action: ActionType
  summary: string
  /** What executing it takes — the executor for that action reads this. */
  exec?: any
  why?: string
  usd?: number | null
  by: string
  actor?: string | null
}

/** Rung 1: write it down and stop. Lands in eve_actions kind 'draft' so it shows in the queue. */
export async function saveDraft(p: Proposal): Promise<{ ok: boolean; id?: string }> {
  try {
    const { data } = await supabaseAdmin().from('eve_actions').insert({
      created_by: p.actor || p.by, kind: 'draft',
      payload: { action: p.action, summary: p.summary.slice(0, 600), exec: p.exec || null, usd: p.usd ?? null },
      why: (p.why || '').slice(0, 400), status: 'proposed',
    }).select('id').maybeSingle()
    const id = (data as any)?.id ? String((data as any).id) : undefined
    await recordAgentAction(p.action, { rung: 1, allowed: false, mode: 'draft', reason: 'saved as draft', summary: p.summary, ref: id || null, by: p.by, actor: p.actor, usd: p.usd, countAs: 'none' })
    return { ok: true, id }
  } catch { return { ok: false } }
}

/**
 * Rung 2: file it for approval and ASK. Reuses the morning-ask envelope (eve_actions kind 'ask',
 * payload.type 'action') so a Telegram reply of "yes" lands on it exactly like a reply to a
 * question does — lib/eve/ask.ts resolveAsk handles the 'action' type. Slack gets a plain line in
 * the approvals room pointing at Settings → Eve → Agent mode, where Approve / Reject live.
 */
export async function proposeAction(p: Proposal): Promise<{ ok: boolean; id?: string; notified: string[]; error?: string }> {
  const notified: string[] = []
  let id: string | undefined
  try {
    const { data, error } = await supabaseAdmin().from('eve_actions').insert({
      created_by: p.actor || p.by, kind: 'ask',
      payload: { type: 'action', ref: '', action: p.action, summary: p.summary.slice(0, 600), exec: p.exec || null, usd: p.usd ?? null, delivery_count: 0 },
      why: (p.why || p.summary).slice(0, 400), status: 'proposed',
      expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
    }).select('id').maybeSingle()
    if (error) throw error
    id = (data as any)?.id ? String((data as any).id) : undefined
  } catch (e: any) {
    return { ok: false, notified, error: String(e?.message || e).slice(0, 200) }
  }

  const s = await getAgentSettings()
  const text = `🤖 **Eve wants to: ${p.summary.slice(0, 300)}**${p.why ? `\n\n_Why:_ ${p.why.slice(0, 300)}` : ''}${p.usd ? `\n_Money:_ $${Number(p.usd).toFixed(2)}` : ''}\n\nReply **yes** and I'll do it. Reply **no** and I'll drop it. It also sits in Settings → Eve → Agent mode.`

  // The ask itself is budgeted: past today's asks it is filed silently and shows in the panel.
  const askOk = await agentAllowed('telegram_ask', { ask: true })
  if (askOk.mode !== 'observe' && askOk.mode !== 'draft' && s.enabled) {
    if (s.channels.telegram) {
      try {
        const { sendMessage } = await import('@/lib/telegram')
        const { data } = await supabaseAdmin().from('telegram_contacts').select('email,dm_chat_id,status').eq('status', 'approved').limit(100)
        const rows = ((data as any[]) || []).filter(r => r.email && r.dm_chat_id && s.approvers.indexOf(String(r.email).toLowerCase()) >= 0)
        const to = rows[0]
        if (to && id) {
          const res = await sendMessage(String(to.dm_chat_id), text)
          if (res.ok) {
            notified.push('telegram')
            const messageId = Number((res as any)?.result?.message_id) || null
            await supabaseAdmin().from('eve_actions').update({ payload: { type: 'action', ref: '', action: p.action, summary: p.summary.slice(0, 600), exec: p.exec || null, usd: p.usd ?? null, chat_id: String(to.dm_chat_id), message_id: messageId, delivery_count: 1, sent_at: new Date().toISOString() } }).eq('id', id)
          }
        }
      } catch { /* Slack may still carry it */ }
    }
    if (s.channels.slack) {
      try {
        const { getApprovalsChannel } = await import('./approvals')
        const { postToChannel } = await import('@/lib/slack')
        const ch = await getApprovalsChannel()
        if (ch) {
          const r = await postToChannel(ch.id, `🤖 *Eve wants to:* ${p.summary.slice(0, 300)}${p.why ? `\n_Why:_ ${p.why.slice(0, 200)}` : ''}\nApprove or reject in Lighthouse → Users & admin → Eve → Agent mode.`)
          if (r.ok) notified.push('slack')
        }
      } catch { /* the proposal is filed regardless */ }
    }
  }
  await recordAgentAction(p.action, { rung: 2, allowed: false, mode: 'propose', reason: notified.length ? `proposed; asked via ${notified.join('+')}` : 'proposed; waiting in the panel', summary: p.summary, ref: id || null, by: p.by, actor: p.actor, usd: p.usd, countAs: notified.length ? 'ask' : 'none' })
  return { ok: true, id, notified }
}

/**
 * Step down from whatever the verdict allows. The caller passes what it WANTED to do; this files
 * the right smaller thing and returns which one. `act` is the caller's own function, run only when
 * the verdict says act — and counted when it succeeds.
 */
export async function stepDown(verdict: AgentVerdict, p: Proposal, act?: () => Promise<{ ok: boolean; ref?: string | null; error?: string }>): Promise<{ mode: Mode; ok: boolean; ref?: string | null; error?: string }> {
  if (verdict.mode === 'act' && act) {
    let r: { ok: boolean; ref?: string | null; error?: string }
    try { r = await act() } catch (e: any) { r = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    await recordAgentAction(p.action, { rung: verdict.rung, allowed: true, mode: 'act', reason: r.ok ? verdict.reason : `act failed: ${r.error || 'unknown'}`, summary: p.summary, ref: r.ref || null, by: p.by, actor: p.actor, usd: p.usd, countAs: r.ok ? 'action' : 'none' })
    return { mode: 'act', ok: r.ok, ref: r.ref, error: r.error }
  }
  if (verdict.mode === 'propose') {
    const r = await proposeAction(p)
    return { mode: 'propose', ok: r.ok, ref: r.id || null, error: r.error }
  }
  if (verdict.mode === 'draft') {
    const r = await saveDraft(p)
    return { mode: 'draft', ok: r.ok, ref: r.id || null }
  }
  await recordAgentAction(p.action, { rung: verdict.rung, allowed: false, mode: 'observe', reason: verdict.reason, summary: p.summary, by: p.by, actor: p.actor, usd: p.usd, countAs: 'none' })
  return { mode: 'observe', ok: true }
}

// ---- Executing an approved proposal --------------------------------------------------------------

/**
 * A person said yes. Executors exist for the actions Eve can currently take herself; anything else
 * is marked approved with a note that a person has to do it — an approval is never silently lost.
 */
export async function executeProposal(id: string, by: string): Promise<{ ok: boolean; done?: string; error?: string }> {
  let row: any = null
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('*').eq('id', id).maybeSingle()
    row = data
  } catch { /* below */ }
  if (!row || !(row.kind === 'ask' && row.payload?.type === 'action') && row.kind !== 'draft') return { ok: false, error: 'that proposal is no longer on file' }
  if (row.status !== 'proposed') return { ok: false, error: `already ${row.status}` }
  const action = String(row.payload?.action || '') as ActionType
  const exec = row.payload?.exec || {}
  const s = await getAgentSettings()
  if (!s.enabled) return { ok: false, error: 'Agent mode is OFF — switch it on to let her carry this out, or do it by hand.' }

  const nowISO = new Date().toISOString()
  const close = async (status: string, result: any) => {
    try { await supabaseAdmin().from('eve_actions').update({ status, decided_by: by, decided_at: nowISO, executed_at: status === 'executed' ? nowISO : null, result }).eq('id', id) } catch { /* fine */ }
  }

  let out: { ok: boolean; done?: string; error?: string }
  try {
    if (action === 'slack_post' && exec?.channel && exec?.text) {
      const { postToChannel, postThreadReply } = await import('@/lib/slack')
      const r = exec.thread_ts ? await postThreadReply(String(exec.channel), String(exec.thread_ts), String(exec.text)) : await postToChannel(String(exec.channel), String(exec.text))
      out = r.ok ? { ok: true, done: `posted in ${exec.channel_name || exec.channel}` } : { ok: false, error: String(r.error || 'Slack refused it') }
    } else if (action === 'telegram_ask' && exec?.chat_id && exec?.text) {
      const { sendMessage } = await import('@/lib/telegram')
      const r = await sendMessage(String(exec.chat_id), String(exec.text))
      out = r.ok ? { ok: true, done: 'sent on Telegram' } : { ok: false, error: String((r as any).error || 'Telegram refused it') }
    } else if (action === 'memory_rule' && exec?.text) {
      const { saveMemory } = await import('./memory')
      const r = await saveMemory({ text: String(exec.text), kind: exec.kind, why: exec.why, scope: exec.scope, weight: exec.weight, source: 'eve', created_by: by })
      out = r.ok ? { ok: true, done: 'remembered' } : { ok: false, error: r.error || 'could not save' }
    } else {
      out = { ok: true, done: `approved — no executor for ${action} yet, so a person does this one by hand` }
    }
  } catch (e: any) { out = { ok: false, error: String(e?.message || e).slice(0, 200) } }

  await close(out.ok ? 'executed' : 'failed', { by, ...out })
  await recordAgentAction(action, { rung: 2, allowed: out.ok, mode: 'act', reason: out.ok ? `approved by ${by}` : `approved by ${by} but failed: ${out.error}`, summary: String(row.payload?.summary || ''), ref: id, by: 'chat', actor: by, countAs: out.ok ? 'action' : 'none' })
  return out
}

export async function rejectProposal(id: string, by: string, note?: string): Promise<{ ok: boolean }> {
  try {
    await supabaseAdmin().from('eve_actions').update({ status: 'rejected', decided_by: by, decided_at: new Date().toISOString(), result: note ? { note: note.slice(0, 300) } : null }).eq('id', id).eq('status', 'proposed')
    await logAgent({ action: 'memory_rule', rung: 0, allowed: false, mode: 'observe', reason: `proposal rejected by ${by}`, ref: id, by: 'chat', actor: by })
    return { ok: true }
  } catch { return { ok: false } }
}

/** Open proposals and drafts, for the panel. */
export async function listProposals(limit = 40): Promise<any[]> {
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,kind,payload,why,status,created_by,created_at,decided_by,decided_at,result')
      .in('kind', ['ask', 'draft']).order('created_at', { ascending: false }).limit(200)
    return ((data as any[]) || []).filter(r => r.kind === 'draft' || r.payload?.type === 'action').slice(0, limit)
  } catch { return [] }
}

export async function agentLog(limit = 100): Promise<any[]> {
  try {
    const { data } = await supabaseAdmin().from('eve_agent_log').select('*').order('at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 500))
    return (data as any[]) || []
  } catch { return [] }
}

// ---- For the prompt -------------------------------------------------------------------------------

/** One paragraph, so she never claims she can or cannot act wrongly. */
export function renderAgentModeForPrompt(s: AgentSettings): string {
  if (!s.enabled) {
    return `AGENT MODE IS OFF. You observe, answer and draft. Nothing you do leaves this app: no Slack post, no Telegram message, no task, no door code, no message to a guest. If something needs doing, say precisely what and who should do it, and offer to draft it. Your own notebook ("remember") and the recommendation ledger ("recommend") still work.`
  }
  const acts: string[] = [], proposes: string[] = [], drafts: string[] = [], off: string[] = []
  for (const a of ACTIONS) {
    const r = s.rungs[a.key]
    const m = modeOf(r)
    if (a.cap <= 1) continue
    if (m === 'act') acts.push(a.label.toLowerCase())
    else if (m === 'propose') proposes.push(a.label.toLowerCase())
    else if (m === 'draft') drafts.push(a.label.toLowerCase())
    else off.push(a.label.toLowerCase())
  }
  const quiet = `Quiet hours ${s.quietHours.start}–${s.quietHours.end} ET: anything you would act on waits for a person until morning.`
  return `AGENT MODE IS ON, inside a fence. You may ACT on your own for: ${acts.length ? acts.join(', ') : 'nothing yet'}. You must PROPOSE and wait for a yes for: ${proposes.length ? proposes.join(', ') : 'nothing'}. You only DRAFT (a person picks it up) for: ${drafts.length ? drafts.join(', ') : 'nothing'}.${off.length ? ` You do not do: ${off.join(', ')}.` : ''} Budgets today: ${s.budgets.actionsPerDay} actions, ${s.budgets.asksPerDay} asks, $${s.budgets.aiUsdPerDay} of AI; money over $${s.budgets.moneyCeilingUsd} always needs a yes. ${quiet} Say which of these applies when someone asks you to do something — never claim you already did a thing that was only proposed, and never say you cannot do something you may act on.`
}
