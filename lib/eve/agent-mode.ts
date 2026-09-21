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
// QUIET HOURS DEFER, THEY DO NOT PROPOSE (2026-09-21). For three mornings the Slack watch ran at
// 5:22am ET, inside quiet hours, and each digest and "affects a guest today" post was turned into a
// PROPOSAL — and the proposal's own notification was gated by the telegram_ask rung, which was 0.
// Five posts sat in "waiting on a yes" that nobody was ever told about. Nothing reached Slack for
// three days. So now: an act inside quiet hours is DEFERRED — stored with `deferUntil` = the end of
// quiet hours and carried out then, no yes required, by flushDeferred() (called every 30 minutes
// from /api/sentiment/scan and from the eve-ask cron). And the notification for a proposal is the
// approval channel itself: it goes to the approvers whenever agent mode is on, whatever the
// telegram_ask rung says; in quiet hours it is deferred to the morning, never dropped.
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
export type Mode = 'observe' | 'draft' | 'propose' | 'act' | 'deferred'

/** The wiring for a recommended, safe day-one setup — the "Recommended setup" button. */
export const RECOMMENDED_RUNGS: Partial<Record<ActionType, Rung>> = {
  slack_post: 3, telegram_ask: 2, email_draft: 2, recommendation: 1, memory_rule: 1, task_note: 2, task_create: 2,
}
export function recommendedRungs(): Record<ActionType, Rung> {
  const out: any = {}
  for (const a of ACTIONS) out[a.key] = RECOMMENDED_RUNGS[a.key] ?? Math.min(2, a.cap)
  return out
}

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
  { key: 'email_draft', label: 'Draft an email', what: 'A Gmail draft in a connected mailbox. Nobody receives it until a person sends it.', def: 2, cap: 4, wiredAt: ['lib/eve/executors.ts email_draft', 'lib/eve/watches.ts channel_broken, stock_low'] },
  { key: 'email_send', label: 'Send an email', what: 'An email leaving the company. Permanently propose-only, and the executor is not enabled.', def: 2, cap: 2, wiredAt: [] },
  { key: 'guest_reply_draft', label: 'Draft a guest reply', what: 'A reply saved on the thread (/messages) and in Command Center → Decide with Send / Discard. Not sent.', def: 2, cap: 4, wiredAt: ['lib/eve/executors.ts guest_reply_draft', 'lib/eve/watches.ts guest_unanswered_1h, bad_review_in'] },
  { key: 'guest_reply_send', label: 'Message a guest', what: 'A message the guest actually receives (Guesty send-message). Permanently propose-only: only a Send button or a Telegram yes runs it.', def: 2, cap: 2, wiredAt: ['lib/eve/executors.ts guest_reply_send', 'app/api/eve/guest-drafts send'] },
  { key: 'task_create', label: 'Create a task', what: 'A new Breezeway task.', def: 2, cap: 4, wiredAt: ['lib/eve/executors.ts task_create', 'lib/eve/core.ts propose_action', 'lib/eve/watches.ts big_arrival_uninspected, bad_review_in, glitch_overdue'] },
  { key: 'task_assign', label: 'Assign a task', what: 'Put a task on somebody\'s board.', def: 2, cap: 4, wiredAt: ['lib/eve/executors.ts task_assign', 'lib/eve/watches.ts clean_late'] },
  { key: 'task_note', label: 'Note on a task', what: 'A comment on an existing Breezeway task.', def: 2, cap: 4, wiredAt: ['lib/eve/executors.ts task_note', 'lib/eve/watches.ts no_show_risk'] },
  { key: 'task_cancel', label: 'Cancel a task', what: 'Cancel a Breezeway task (never a departure clean — those belong to the scheduler).', def: 2, cap: 3, wiredAt: ['lib/eve/executors.ts task_cancel'] },
  { key: 'door_code_release', label: 'Release a door code', what: 'Hand a code to a person. Permanently propose-only; a person set to Direct is their own approver.', def: 2, cap: 2,
    wiredAt: ['lib/eve/core.ts door_code_check'] },
  { key: 'guesty_write', label: 'Write to Guesty', what: 'Reservation notes, custom fields. Permanently propose-only.', def: 2, cap: 2, wiredAt: ['lib/eve/executors.ts guesty_write'] },
  { key: 'calendar_block', label: 'Block a calendar', what: 'Soft-block a turnover day (the schedule board + the Breezeway clean move). Permanently propose-only.', def: 2, cap: 2, wiredAt: ['lib/eve/executors.ts calendar_block'] },
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

/** What the effective rung means for a person: the column next to each action in the panel. */
export type Stance = 'Observes' | 'Drafts only' | 'Needs your approval' | 'Acts on her own'
export function stanceOf(action: ActionType, rung: Rung, enabled: boolean): Stance {
  const def = ACTIONS.find(a => a.key === action)
  const r = clampRung(rung, def ? def.cap : 2)
  const internal = !!def && def.cap <= 1
  if (!enabled && !internal) return r >= 1 ? 'Drafts only' : 'Observes'
  if (r >= 3) return 'Acts on her own'
  if (r === 2) return 'Needs your approval'
  if (r === 1) return 'Drafts only'
  return 'Observes'
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

/** Minutes east of UTC for a zone (default America/New_York) at a given instant (negative = west). */
function etOffsetMinutes(d: Date, zone = 'America/New_York'): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(d)
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

/**
 * The next instant quiet hours end, as an ISO string. Inside quiet hours this is the coming `end`
 * (today or tomorrow in the zone, whichever is next); outside them it is `now`, so a deferral made
 * by mistake flushes on the next pass rather than waiting a day.
 */
export function quietHoursEnd(s: AgentSettings, now = new Date()): string {
  try {
    if (!inQuietHours(s, now)) return now.toISOString()
    const tz = s.quietHours.tz || 'America/New_York'
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    const parts: Record<string, string> = {}
    for (const p of f.formatToParts(now)) parts[p.type] = p.value
    const cur = toMin(`${parts.hour}:${parts.minute}`), end = toMin(s.quietHours.end)
    // Local wall-clock of the end, today; if that has already passed today, tomorrow.
    let local = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}:00`)
    if (cur >= end) local = new Date(local.getTime() + 86400_000)
    const instant = new Date(local.getTime() - etOffsetMinutes(local, tz) * 60_000)
    return instant.toISOString()
  } catch { return new Date(now.getTime() + 60 * 60_000).toISOString() }
}

// ---- The decision --------------------------------------------------------------------------------

export function modeOf(rung: Rung): Mode {
  return rung >= 3 ? 'act' : rung === 2 ? 'propose' : rung === 1 ? 'draft' : 'observe'
}
const RANK: Record<Mode, number> = { observe: 0, draft: 1, propose: 2, deferred: 3, act: 3 }
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
 * `urgent` means a person asked for this right now (a door code at 2am, Jon's own yes) — quiet
 * hours hold Eve's own initiative, not a human's request.
 */
export async function agentAllowed(action: ActionType, opts: { usd?: number; now?: Date; ask?: boolean; urgent?: boolean } = {}): Promise<AgentVerdict> {
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

  // QUIET HOURS: an act is held, not turned into a proposal nobody is told about. A Telegram ask
  // is a message to a person, so at rung 2 (where it sends) it is held as well — hold until
  // morning, never propose-to-nobody at 3am. Decided last so the budgets above still apply.
  if (!opts.urgent && inQuietHours(s, opts.now) && (mode === 'act' || (action === 'telegram_ask' && mode === 'propose'))) {
    mode = 'deferred'; why.push(`quiet hours ${s.quietHours.start}–${s.quietHours.end} ${s.quietHours.tz}: held until ${s.quietHours.end}`)
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
  by: string   // 'eve' | 'cron:<name>' | 'chat' | 'watch:<key>'
  actor?: string | null
  /** What would reverse it (lib/eve/executors.ts Undo) — stored so "undo" can put it back within 24h. */
  undo?: any
}

/**
 * One row per decision. Best-effort: never throws, never blocks the caller for long. Returns the
 * row id when the insert landed in time (the undo handle), else null.
 */
export async function logAgent(e: AgentLogEntry): Promise<string | null> {
  const base: any = {
    action: e.action, rung: e.rung, allowed: !!e.allowed, mode: e.mode || null,
    reason: (e.reason || '').slice(0, 300), usd: e.usd ?? null,
    summary: (e.summary || '').slice(0, 500), ref: e.ref ? String(e.ref).slice(0, 120) : null,
    by: String(e.by || 'eve').slice(0, 60), actor: e.actor ? String(e.actor).slice(0, 120) : null,
  }
  const attempt = async (row: any) => {
    const ins = supabaseAdmin().from('eve_agent_log').insert(row).select('id').maybeSingle()
    const r: any = await Promise.race([ins, new Promise(res => setTimeout(() => res({ timeout: true }), 2500))])
    return r
  }
  try {
    let r = await attempt(e.undo ? { ...base, undo: e.undo } : base)
    // Migration 102 not run yet: the undo column is missing. Log the action anyway, without it.
    if (r?.error && e.undo && /column|schema cache/i.test(String(r.error.message || ''))) r = await attempt(base)
    const id = r?.data?.id
    return id != null ? String(id) : null
  } catch { return null }   /* migration 100 not run, or a blip — the action still happens */
}

/**
 * Count it AND log it. Call after the thing actually happened (or was proposed / drafted).
 * `mode` decides which counter moves: an act counts against actions, an ask against asks.
 * Returns the log row id (the undo handle) when there is one.
 */
export async function recordAgentAction(action: ActionType, meta: Omit<AgentLogEntry, 'action'> & { countAs?: 'action' | 'ask' | 'none' }): Promise<string | null> {
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
  return logAgent({ action, ...meta })
}

/** The "Today" strip: acted / proposed / graded good / graded bad (the loop, in four numbers). */
export async function agentToday(): Promise<{ date: string; actions: number; asks: number; aiUsd: number; byAction: Record<string, number>; proposed: number; gradedGood: number; gradedBad: number; gradedPending: number }> {
  const [c, usd] = await Promise.all([readCounters(), aiSpendToday()])
  let proposed = 0, gradedGood = 0, gradedBad = 0, gradedPending = 0
  try {
    const sinceLocal = new Date(c.date + 'T00:00:00')
    const since = new Date(sinceLocal.getTime() - etOffsetMinutes(sinceLocal) * 60_000).toISOString()
    const { data } = await supabaseAdmin().from('eve_actions').select('id,payload').eq('kind', 'ask').gte('created_at', since).limit(500)
    for (const r of ((data as any[]) || [])) if (r.payload?.type === 'action') proposed++
  } catch { /* zero */ }
  try {
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
    const { data } = await supabaseAdmin().from('eve_recommendations').select('outcome,status').eq('kind', 'action').gte('created_at', since30).limit(1000)
    for (const r of ((data as any[]) || [])) {
      if (r.outcome === 'worked') gradedGood++
      else if (r.outcome === 'didnt') gradedBad++
      else if (!r.outcome && r.status === 'accepted') gradedPending++
    }
  } catch { /* migration 099/102 not run: zeros */ }
  return { date: c.date, actions: c.actions, asks: c.asks, aiUsd: usd, byAction: c.byAction, proposed, gradedGood, gradedBad, gradedPending }
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
  /** Set by lib/eve/watches.ts: which watch fired and on what (a unit, a thread, a task). */
  watchKey?: string | null
  subject?: string | null
  /** The metric the action is expected to move — the recommendation row it creates is graded on it. */
  metric?: string | null
  /** When the action carries out a plan from the ledger: a yes accepts it, a no rejects it. */
  recommendationId?: string | null
  /** Short evidence lines for the Thinking feed (lib/eve/thoughts.ts). */
  evidence?: string[]
  /** What Eve was asked, when this came out of chat — shown on the thought. */
  snippet?: string | null
  /** A note on the thought ('draft skipped — AI budget'). */
  note?: string | null
  /** Dedupe window for the thought; a watch passes its cooldown. */
  thoughtCooldownHours?: number
}

/** The executor's answer (lib/eve/executors.ts ExecOut, minus the summary the caller already has). */
export type ExecResult = { ok: boolean; done?: string; error?: string; ref?: string | null; undo?: any }

/** What the proposal carries into the eve_actions payload so the receipts survive the round trip. */
function proposalMeta(p: Proposal) {
  return { actor: p.actor || null, watchKey: p.watchKey || null, subject: p.subject || null, metric: p.metric || null, recommendation_id: p.recommendationId || null }
}

// The metric an action most plausibly moves, when the caller did not say. Only ever a guess — the
// grader decides — but a guess that is measurable beats no row at all.
const ACTION_METRIC: Partial<Record<ActionType, string>> = {
  task_create: 'tasks_completed', task_assign: 'cleans_unassigned', task_note: 'tasks_completed', task_cancel: 'tasks_completed',
  guest_reply_draft: 'sentiment_negative', guest_reply_send: 'sentiment_negative',
  email_draft: 'open_field_work', guesty_write: 'glitches_open', calendar_block: 'cleans_done',
  slack_post: 'tasks_completed',
}

/**
 * THE LOOP CLOSES (Build 3, 2026-09-21). Every action she carries out becomes a recommendation row
 * (kind 'action', measured in 7 days, accepted on the spot because the thing was actually done) so
 * gradeDue measures whether it helped and the Today strip can say "graded good / graded bad".
 * Best-effort: a missing metric or a failed insert never touches the action that already happened.
 */
export async function afterAct(action: ActionType, res: ExecResult, meta: { by: string; actor?: string | null; watchKey?: string | null; subject?: string | null; summary: string; metric?: string | null }): Promise<void> {
  const internal = action === 'memory_rule' || action === 'recommendation' || action === 'telegram_ask'
  if (!res.ok || internal) return
  const metric = meta.metric || ACTION_METRIC[action]
  if (!metric) return
  try {
    const { createRecommendation, decideRecommendation } = await import('./recommendations')
    const title = `Action: ${(res.done || meta.summary || action).slice(0, 240)}`
    const detail = [`Eve carried this out (${action}) via ${meta.by}${meta.actor ? `, approved by ${meta.actor}` : ''}.`, meta.watchKey ? `Fired by watch ${meta.watchKey}${meta.subject ? ` on ${meta.subject}` : ''}.` : '', res.ref ? `Ref ${res.ref}.` : ''].filter(Boolean).join(' ')
    const r = await createRecommendation({ title, detail, metric, scope: 'portfolio', expect_direction: metricDirection(metric), measure_in_days: 7, measure_window: 7, created_by: meta.actor || 'eve', source: meta.watchKey ? 'watch' : 'chat', kind: 'action', area: 'operations' })
    if (r.ok && r.id) await decideRecommendation(r.id, 'accepted', 'eve', 'accepted automatically: the action was carried out')
  } catch { /* the ledger is a receipt, never a gate */ }
}
function metricDirection(metric: string): 'up' | 'down' {
  return /unassigned|negative|open|low_|glitches|cancel|minutes|unanswered/.test(metric) ? 'down' : 'up'
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
 *
 * THE NOTIFICATION IS THE APPROVAL CHANNEL (2026-09-21). It is not itself a `telegram_ask` that the
 * telegram_ask rung may switch off — that is how five proposals sat unseen for three days. When
 * agent mode is on it always goes to an approver: Telegram if one is bound, else the Slack
 * approvals room, else it is logged 'undeliverable' and the panel shows it in red. In quiet hours
 * the notification is deferred to the morning, never dropped.
 */
export async function proposeAction(p: Proposal): Promise<{ ok: boolean; id?: string; notified: string[]; error?: string }> {
  let id: string | undefined
  try {
    const { data, error } = await supabaseAdmin().from('eve_actions').insert({
      created_by: p.actor || p.by, kind: 'ask',
      payload: { type: 'action', ref: '', action: p.action, summary: p.summary.slice(0, 600), exec: p.exec || null, usd: p.usd ?? null, why: (p.why || '').slice(0, 300), delivery_count: 0, by: p.by, ...proposalMeta(p) },
      why: (p.why || p.summary).slice(0, 400), status: 'proposed',
      expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
    }).select('id').maybeSingle()
    if (error) throw error
    id = (data as any)?.id ? String((data as any).id) : undefined
  } catch (e: any) {
    return { ok: false, notified: [], error: String(e?.message || e).slice(0, 200) }
  }
  if (!id) return { ok: false, notified: [], error: 'proposal was not filed' }

  const s = await getAgentSettings()
  let notified: string[] = []
  let reason = 'proposed; waiting in the panel'
  if (s.enabled && inQuietHours(s)) {
    const d = await deferAction({ action: p.action, summary: `tell an approver: ${p.summary.slice(0, 200)}`, exec: { proposal_id: id }, why: 'proposal made in quiet hours', by: p.by, actor: p.actor }, 'proposal_notify', s)
    reason = d.ok ? `proposed; approver will be told at ${s.quietHours.end} (quiet hours)` : 'proposed; could not schedule the morning notification'
    try { await supabaseAdmin().from('eve_actions').update({ result: { delivery: 'deferred', until: d.until } }).eq('id', id) } catch { /* fine */ }
  } else if (s.enabled) {
    const n = await notifyProposal(id, s)
    notified = n.notified
    reason = notified.length ? `proposed; asked via ${notified.join('+')}` : `proposed; UNDELIVERABLE — ${n.error || 'no approver reachable'}`
  }
  await recordAgentAction(p.action, { rung: 2, allowed: false, mode: 'propose', reason, summary: p.summary, ref: id, by: p.by, actor: p.actor, usd: p.usd, countAs: notified.length ? 'ask' : 'none' })
  return { ok: true, id, notified }
}

/**
 * Tell an approver about a filed proposal. Telegram first (the first approver bound to a chat),
 * then the Slack approvals room; if neither can carry it, the row is marked undeliverable so the
 * panel can shout. Returns which channels took it.
 */
export async function notifyProposal(id: string, settings?: AgentSettings): Promise<{ notified: string[]; error?: string }> {
  const s = settings || await getAgentSettings()
  const notified: string[] = []
  let row: any = null
  try { const { data } = await supabaseAdmin().from('eve_actions').select('id,payload,status').eq('id', id).maybeSingle(); row = data } catch { /* below */ }
  if (!row || row.status !== 'proposed') return { notified, error: row ? `already ${row.status}` : 'proposal not on file' }
  const pl = row.payload || {}
  const summary = String(pl.summary || '').slice(0, 300), why = String(pl.why || '').slice(0, 300), usd = Number(pl.usd) || 0
  const errors: string[] = []

  if (s.channels.telegram) {
    try {
      const { sendMessage } = await import('@/lib/telegram')
      const { data } = await supabaseAdmin().from('telegram_contacts').select('email,dm_chat_id,status').eq('status', 'approved').limit(100)
      const rows = ((data as any[]) || []).filter(r => r.email && r.dm_chat_id && s.approvers.indexOf(String(r.email).toLowerCase()) >= 0)
      const to = rows[0]
      if (!to) errors.push('no approver is bound on Telegram')
      else {
        const text = `🤖 **Eve wants to: ${summary}**${why ? `\n\n_Why:_ ${why}` : ''}${usd ? `\n_Money:_ $${usd.toFixed(2)}` : ''}\n\nReply **yes** and I'll do it. Reply **no** and I'll drop it. It also sits in Settings → Eve → Agent mode.`
        const res = await sendMessage(String(to.dm_chat_id), text)
        if (res.ok) {
          notified.push('telegram')
          const messageId = Number((res as any)?.result?.message_id) || null
          await supabaseAdmin().from('eve_actions').update({ payload: { ...pl, chat_id: String(to.dm_chat_id), message_id: messageId, delivery_count: Number(pl.delivery_count || 0) + 1, sent_at: new Date().toISOString() }, result: { delivery: 'telegram' } }).eq('id', id)
        } else errors.push(`Telegram: ${String((res as any)?.error || 'refused').slice(0, 80)}`)
      }
    } catch (e: any) { errors.push(`Telegram: ${String(e?.message || e).slice(0, 80)}`) }
  } else errors.push('Telegram is switched off')

  if (!notified.length && s.channels.slack) {
    try {
      const { getApprovalsChannel } = await import('./approvals')
      const { postToChannel } = await import('@/lib/slack')
      const ch = await getApprovalsChannel()
      if (!ch) errors.push('no Slack approvals channel')
      else {
        const r = await postToChannel(ch.id, `🤖 *Eve wants to:* ${summary}${why ? `\n_Why:_ ${why.slice(0, 200)}` : ''}\nApprove or reject in Lighthouse → Users & admin → Eve → Agent mode.`)
        if (r.ok) { notified.push('slack'); await supabaseAdmin().from('eve_actions').update({ result: { delivery: 'slack' } }).eq('id', id) }
        else errors.push(`Slack: ${String(r.error || 'refused').slice(0, 80)}`)
      }
    } catch (e: any) { errors.push(`Slack: ${String(e?.message || e).slice(0, 80)}`) }
  } else if (!notified.length) errors.push('Slack is switched off')

  if (!notified.length) {
    const error = errors.join('; ').slice(0, 300)
    try { await supabaseAdmin().from('eve_actions').update({ result: { delivery: 'undeliverable', error } }).eq('id', id) } catch { /* fine */ }
    await logAgent({ action: String(pl.action || 'telegram_ask') as ActionType, rung: 2, allowed: false, mode: 'propose', reason: `UNDELIVERABLE: ${error}`, summary: summary, ref: id, by: 'eve' })
    return { notified, error }
  }
  return { notified }
}

// ---- Deferred: quiet hours hold the action, the morning carries it out --------------------------

export type DeferKind = 'action' | 'proposal_notify'

/**
 * Store an action to be carried out at the end of quiet hours — no yes required. Lands in
 * eve_actions kind 'ask', payload.type 'deferred' (no migration; same queue), with `deferUntil`.
 */
export async function deferAction(p: Proposal, kind: DeferKind = 'action', settings?: AgentSettings): Promise<{ ok: boolean; id?: string; until: string }> {
  const s = settings || await getAgentSettings()
  const until = quietHoursEnd(s)
  try {
    const { data, error } = await supabaseAdmin().from('eve_actions').insert({
      created_by: p.actor || p.by, kind: 'ask',
      payload: { type: 'deferred', ref: '', deferKind: kind, action: p.action, summary: p.summary.slice(0, 600), exec: p.exec || null, usd: p.usd ?? null, deferUntil: until, by: p.by, delivery_count: 0, ...proposalMeta(p) },
      why: (p.why || `held for quiet hours until ${s.quietHours.end} ${s.quietHours.tz}`).slice(0, 400), status: 'proposed',
      expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
    }).select('id').maybeSingle()
    if (error) throw error
    const id = (data as any)?.id ? String((data as any).id) : undefined
    if (kind === 'action') await recordAgentAction(p.action, { rung: 3, allowed: false, mode: 'deferred', reason: `quiet hours; will run at ${until}`, summary: p.summary, ref: id || null, by: p.by, actor: p.actor, usd: p.usd, countAs: 'none' })
    return { ok: true, id, until }
  } catch (e: any) {
    await logAgent({ action: p.action, rung: 3, allowed: false, mode: 'deferred', reason: `could not defer: ${String(e?.message || e).slice(0, 120)}`, summary: p.summary, by: p.by, actor: p.actor })
    return { ok: false, until }
  }
}

/**
 * Carry out everything whose hold has expired. Called from the two jobs that run through the
 * morning: /api/sentiment/scan (every 30 minutes) and the eve-ask cron. Each row is CLAIMED with a
 * conditional update first, so two overlapping callers cannot both post the same digest.
 */
export async function flushDeferred(by = 'cron:flush'): Promise<{ ran: number; failed: number; skipped: number; notes: string[] }> {
  const out = { ran: 0, failed: 0, skipped: 0, notes: [] as string[] }
  let rows: any[] = []
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,payload,status,created_by,created_at')
      .eq('kind', 'ask').eq('status', 'proposed').order('created_at', { ascending: true }).limit(200)
    rows = ((data as any[]) || []).filter(r => r.payload?.type === 'deferred')
  } catch { return out }
  if (!rows.length) return out
  const s = await getAgentSettings()
  if (!s.enabled) { out.skipped = rows.length; out.notes.push('agent mode is OFF; deferred work stays held'); return out }
  if (inQuietHours(s)) { out.skipped = rows.length; out.notes.push('still quiet hours'); return out }
  const now = Date.now()
  for (const r of rows) {
    const pl = r.payload || {}
    const due = Date.parse(String(pl.deferUntil || ''))
    if (Number.isFinite(due) && due > now) { out.skipped++; continue }
    // Claim it. Only the caller whose update lands moves on.
    let claimed = false
    try {
      const { data } = await supabaseAdmin().from('eve_actions').update({ status: 'approved', decided_by: by, decided_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'proposed').select('id')
      claimed = !!((data as any[]) || []).length
    } catch { claimed = false }
    if (!claimed) { out.skipped++; continue }
    const action = String(pl.action || 'slack_post') as ActionType
    let res: ExecResult
    if (pl.deferKind === 'proposal_notify') {
      const n = await notifyProposal(String(pl.exec?.proposal_id || ''), s)
      res = n.notified.length ? { ok: true, done: `approver told via ${n.notified.join('+')}` } : { ok: false, error: n.error || 'undeliverable' }
    } else {
      res = await runExec(action, pl.exec || {}, by, { actor: String(pl.actor || '') || null })
    }
    const nowISO = new Date().toISOString()
    try { await supabaseAdmin().from('eve_actions').update({ status: res.ok ? 'executed' : 'failed', executed_at: res.ok ? nowISO : null, result: { by, ok: res.ok, done: res.done, error: res.error, ref: res.ref } }).eq('id', String(r.id)) } catch { /* fine */ }
    if (pl.deferKind !== 'proposal_notify') {
      await recordAgentAction(action, { rung: 3, allowed: res.ok, mode: 'act', reason: res.ok ? `deferred from quiet hours; ran at ${nowISO}` : `deferred from quiet hours; failed: ${res.error}`, summary: res.ok && res.done ? res.done : String(pl.summary || ''), ref: res.ref || String(r.id), by: String(pl.by || by), countAs: res.ok ? 'action' : 'none', undo: res.undo || undefined })
      if (res.ok) await afterAct(action, res, { by: String(pl.by || by), watchKey: String(pl.watchKey || '') || null, subject: String(pl.subject || '') || null, summary: String(pl.summary || '') })
    }
    if (res.ok) out.ran++; else { out.failed++; out.notes.push(`${action}: ${res.error}`) }
  }
  return out
}

/**
 * Step down from whatever the verdict allows. The caller passes what it WANTED to do; this files
 * the right smaller thing and returns which one. When the verdict says act, the action runs through
 * the executor registry (lib/eve/executors.ts) from `p.exec` — or through `act`, the caller's own
 * function, for the few paths that still carry their own (Slack watch). Either way it is counted
 * when it succeeds, logged with its undo, and turned into a graded recommendation row.
 * `deferred` stores the exec to run later, so `p.exec` must be complete enough for runExec.
 */
export type StepResult = { mode: Mode; ok: boolean; ref?: string | null; error?: string; done?: string; logId?: string | null; undo?: any }

export async function stepDown(verdict: AgentVerdict, p: Proposal, act?: () => Promise<{ ok: boolean; ref?: string | null; error?: string }>): Promise<StepResult> {
  if (verdict.mode === 'act') {
    let r: ExecResult
    if (act) {
      try { r = await act() } catch (e: any) { r = { ok: false, error: String(e?.message || e).slice(0, 200) } }
    } else {
      r = await runExec(p.action, p.exec || {}, p.by, { actor: p.actor })
    }
    const logId = await recordAgentAction(p.action, { rung: verdict.rung, allowed: r.ok, mode: 'act', reason: r.ok ? verdict.reason : `act failed: ${r.error || 'unknown'}`, summary: r.ok && r.done ? r.done : p.summary, ref: r.ref || null, by: p.by, actor: p.actor, usd: p.usd, countAs: r.ok ? 'action' : 'none', undo: r.undo || undefined })
    if (r.ok) await afterAct(p.action, r, { by: p.by, actor: p.actor, watchKey: p.watchKey, subject: p.subject, summary: p.summary, metric: p.metric })
    return { mode: 'act', ok: r.ok, ref: r.ref, error: r.error, done: r.done, logId, undo: r.undo || null }
  }
  if (verdict.mode === 'deferred') {
    const r = await deferAction(p, 'action', verdict.settings)
    return { mode: 'deferred', ok: r.ok, ref: r.id || null, error: r.ok ? undefined : 'could not defer' }
  }
  if (verdict.mode === 'propose') {
    const r = await proposeAction(p)
    return { mode: 'propose', ok: r.ok, ref: r.id || null, error: r.error }
  }
  if (verdict.mode === 'draft') {
    const r = await saveDraft(p)
    await thinkAbout(verdict, p)
    return { mode: 'draft', ok: r.ok, ref: r.id || null }
  }
  await recordAgentAction(p.action, { rung: verdict.rung, allowed: false, mode: 'observe', reason: verdict.reason, summary: p.summary, by: p.by, actor: p.actor, usd: p.usd, countAs: 'none' })
  const th = await thinkAbout(verdict, p)
  return { mode: 'observe', ok: true, ref: th?.id || null }
}

/**
 * WHAT SHE IS THINKING (2026-09-21). An observe or draft step-down used to leave one log line and
 * throw the prepared action away. Now the whole thing — payload, draft, reason, the ask she would
 * have sent — is written as a thought (lib/eve/thoughts.ts) for the Thinking tab and the Command
 * Center line. Best-effort; never touches the step-down's own result.
 */
async function thinkAbout(verdict: AgentVerdict, p: Proposal): Promise<{ id?: string } | null> {
  if (p.action === 'memory_rule' || p.action === 'recommendation') return null
  try {
    const { recordThought, wouldHaveBeenFor } = await import('./thoughts')
    const source = p.by === 'chat' ? 'chat' : p.watchKey ? `watch:${p.watchKey}` : p.by.startsWith('watch:') ? p.by : p.by.startsWith('cron:eve-ask') ? 'ask' : p.by
    const r = await recordThought({
      action: p.action, payload: p.exec ?? null, why: p.why || verdict.reason, ask: p.summary, source, subject: p.subject || null,
      rungNow: verdict.rung, wouldHaveBeen: wouldHaveBeenFor(p.action), evidence: p.evidence || [], snippet: p.snippet || null,
      note: p.note || (p.exec ? null : 'no prepared payload'), by: p.by, actor: p.actor || null, cooldownHours: p.thoughtCooldownHours,
    })
    return r.ok ? { id: r.id } : null
  } catch { return null }
}

/**
 * ONE CALL FOR "EVE WANTS TO DO X" (the chat tool and the watches). Decides with agentAllowed, then
 * steps down. `p.exec` is the full payload the executor needs.
 */
export async function attemptAction(p: Proposal, opts: { ask?: boolean; urgent?: boolean; usd?: number } = {}): Promise<StepResult & { verdict: AgentVerdict }> {
  const verdict = await agentAllowed(p.action, { ask: opts.ask, urgent: opts.urgent, usd: opts.usd ?? (p.usd || undefined) })
  const r = await stepDown(verdict, p)
  return { ...r, verdict }
}

// ---- Executing an approved proposal --------------------------------------------------------------

/**
 * The executors live in lib/eve/executors.ts (one per ActionType). This is the thin adapter every
 * path in this file uses: a stored `exec` payload in, the executor's receipt out. `human` marks a
 * person's yes — the welded actions (guest_reply_send, guesty_write, calendar_block) refuse to run
 * without it, whatever the caller thinks the rung is.
 */
async function runExec(action: ActionType, exec: any, by: string, opts: { actor?: string | null; human?: boolean } = {}): Promise<ExecResult> {
  try {
    const { runExecutor } = await import('./executors')
    const r = await runExecutor(action, exec || {}, { by, actor: opts.actor || null, human: !!opts.human })
    return { ok: r.ok, done: r.ok ? (r.done || r.summary) : undefined, error: r.ok ? undefined : (r.error || r.summary), ref: r.ref || null, undo: r.undo || null }
  } catch (e: any) { return { ok: false, error: String(e?.message || e).slice(0, 200) } }
}

/**
 * A person said yes. The executor for the action runs with `human: true`, the row is closed with
 * the receipt, and — because the thing actually happened — it is logged with its undo and becomes
 * a graded recommendation. A deferred row may be approved too: "post it now" instead of waiting.
 */
export async function executeProposal(id: string, by: string): Promise<{ ok: boolean; done?: string; error?: string; logId?: string | null; undo?: any }> {
  let row: any = null
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('*').eq('id', id).maybeSingle()
    row = data
  } catch { /* below */ }
  const isAsk = row && row.kind === 'ask' && (row.payload?.type === 'action' || row.payload?.type === 'deferred')
  if (!row || (!isAsk && row.kind !== 'draft')) return { ok: false, error: 'that proposal is no longer on file' }
  if (row.status !== 'proposed') return { ok: false, error: `already ${row.status}` }
  const action = String(row.payload?.action || '') as ActionType
  const exec = row.payload?.exec || {}
  const s = await getAgentSettings()
  if (!s.enabled) return { ok: false, error: 'Agent mode is OFF — switch it on to let her carry this out, or do it by hand.' }

  const nowISO = new Date().toISOString()
  const close = async (status: string, result: any) => {
    try { await supabaseAdmin().from('eve_actions').update({ status, decided_by: by, decided_at: nowISO, executed_at: status === 'executed' ? nowISO : null, result }).eq('id', id) } catch { /* fine */ }
  }

  const out: ExecResult = row.payload?.deferKind === 'proposal_notify'
    ? await (async () => { const n = await notifyProposal(String(exec?.proposal_id || ''), s); return n.notified.length ? { ok: true, done: `approver told via ${n.notified.join('+')}` } : { ok: false, error: n.error || 'undeliverable' } })()
    : await runExec(action, exec, 'chat', { actor: by, human: true })

  await close(out.ok ? 'executed' : 'failed', { by, ok: out.ok, done: out.done, error: out.error, ref: out.ref })
  if (out.ok && row.payload?.recommendation_id) { try { const { decideRecommendation } = await import('./recommendations'); await decideRecommendation(String(row.payload.recommendation_id), 'accepted', by, 'accepted: the action was carried out') } catch { /* fine */ } }
  const logId = await recordAgentAction(action, { rung: 2, allowed: out.ok, mode: 'act', reason: out.ok ? `approved by ${by}` : `approved by ${by} but failed: ${out.error}`, summary: out.ok && out.done ? out.done : String(row.payload?.summary || ''), ref: out.ref || id, by: 'chat', actor: by, countAs: out.ok ? 'action' : 'none', undo: out.undo || undefined })
  if (out.ok && row.payload?.deferKind !== 'proposal_notify') await afterAct(action, out, { by: String(row.payload?.by || 'chat'), actor: by, watchKey: row.payload?.watchKey || null, subject: row.payload?.subject || null, summary: String(row.payload?.summary || ''), metric: row.payload?.metric || null })
  return { ok: out.ok, done: out.done, error: out.error, logId, undo: out.undo || null }
}

export async function rejectProposal(id: string, by: string, note?: string): Promise<{ ok: boolean }> {
  try {
    const { data } = await supabaseAdmin().from('eve_actions').update({ status: 'rejected', decided_by: by, decided_at: new Date().toISOString(), result: note ? { note: note.slice(0, 300) } : null }).eq('id', id).eq('status', 'proposed').select('payload')
    // A "no" to an action that carried out a plan is a "no" to the plan: the ledger says rejected.
    const recId = ((data as any[]) || [])[0]?.payload?.recommendation_id
    if (recId) { try { const { decideRecommendation } = await import('./recommendations'); await decideRecommendation(String(recId), 'rejected', by, note ? `rejected on Telegram: ${note.slice(0, 200)}` : 'rejected with the proposal') } catch { /* ledger is best-effort */ } }
    await logAgent({ action: 'memory_rule', rung: 0, allowed: false, mode: 'observe', reason: `proposal rejected by ${by}`, ref: id, by: 'chat', actor: by })
    return { ok: true }
  } catch { return { ok: false } }
}

/** Open proposals, drafts and deferred work, for the panel. */
export async function listProposals(limit = 40): Promise<any[]> {
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,kind,payload,why,status,created_by,created_at,decided_by,decided_at,result')
      .in('kind', ['ask', 'draft']).order('created_at', { ascending: false }).limit(200)
    return ((data as any[]) || []).filter(r => r.kind === 'draft' || r.payload?.type === 'action' || r.payload?.type === 'deferred').slice(0, limit)
  } catch { return [] }
}

/**
 * The graveyard sweep (2026-09-21). A morning roll-up or an "affects a guest today" post that has
 * waited more than a day for a yes is about a day that is over: posting it now would be noise.
 * Expire them, log it, and let the queue hold only things still worth a decision. Run when the
 * panel loads.
 */
export async function expireStaleDigests(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data } = await supabaseAdmin().from('eve_actions').select('id,payload,created_at')
      .eq('kind', 'ask').eq('status', 'proposed').lt('created_at', cutoff).limit(200)
    const stale = ((data as any[]) || []).filter(r => (r.payload?.type === 'action' || r.payload?.type === 'deferred') && r.payload?.action === 'slack_post' && /roll-up|digest|urgent-today|affects a guest/i.test(String(r.payload?.summary || '')))
    let n = 0
    for (const r of stale) {
      try {
        const { data: upd } = await supabaseAdmin().from('eve_actions').update({ status: 'expired', decided_by: 'eve', decided_at: new Date().toISOString(), result: { note: 'expired: a day-of post older than 24h' } }).eq('id', r.id).eq('status', 'proposed').select('id')
        if (((upd as any[]) || []).length) { n++; await logAgent({ action: 'slack_post', rung: 2, allowed: false, mode: 'observe', reason: 'expired: a digest older than 24h is about a day that is over', summary: String(r.payload?.summary || ''), ref: String(r.id), by: 'eve' }) }
      } catch { /* next */ }
    }
    return n
  } catch { return 0 }
}

/** The strip at the top of the panel: how many wait, how many the approver was never told about. */
export async function queueStatus(): Promise<{ waiting: number; deferred: number; undeliverable: number; undeliverableWhy: string[] }> {
  const out = { waiting: 0, deferred: 0, undeliverable: 0, undeliverableWhy: [] as string[] }
  try {
    const { data } = await supabaseAdmin().from('eve_actions').select('id,payload,result').eq('kind', 'ask').eq('status', 'proposed').limit(300)
    for (const r of ((data as any[]) || [])) {
      const t = r.payload?.type
      if (t === 'deferred') out.deferred++
      else if (t === 'action') {
        out.waiting++
        if (r.result?.delivery === 'undeliverable') { out.undeliverable++; if (r.result?.error && out.undeliverableWhy.length < 3) out.undeliverableWhy.push(String(r.result.error).slice(0, 160)) }
      }
    }
  } catch { /* zeros */ }
  return out
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
    return `AGENT MODE IS OFF. You observe, answer and draft. Nothing you do leaves this app: no Slack post, no Telegram message, no task, no door code, no message to a guest. propose_action still files a DRAFT in the Agent panel queue so the work is not lost — say it is drafted, not done. If something needs doing, say precisely what and who should do it. Your own notebook ("remember") and the recommendation ledger ("recommend") still work.`
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
  const quiet = `Quiet hours ${s.quietHours.start}–${s.quietHours.end} ET: anything you would act on is held and goes out on its own at ${s.quietHours.end}; nobody is woken for it.`
  return `AGENT MODE IS ON, inside a fence. propose_action is how you do things; it applies these rungs for you. You may ACT on your own for: ${acts.length ? acts.join(', ') : 'nothing yet'}. You must PROPOSE and wait for a yes for: ${proposes.length ? proposes.join(', ') : 'nothing'}. You only DRAFT (a person picks it up) for: ${drafts.length ? drafts.join(', ') : 'nothing'}.${off.length ? ` You do not do: ${off.join(', ')}.` : ''} Budgets today: ${s.budgets.actionsPerDay} actions, ${s.budgets.asksPerDay} asks, $${s.budgets.aiUsdPerDay} of AI; money over $${s.budgets.moneyCeilingUsd} always needs a yes. ${quiet} Say which of these applied after you call propose_action — never claim you already did a thing that was only proposed, and never say you cannot do something you may act on. Anything you did can be undone for 24 hours ("undo").`
}
