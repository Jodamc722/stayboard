// THE FENCE'S RULES, WITH NOTHING ELSE IN THE FILE (2026-11-10).
//
// lib/eve/agent-mode.ts reads the switch, the counters and the ledger and talks to Slack and
// Telegram; lib/eve/executors.ts does the work. The RULES both of them apply live here — which
// rung an action may reach, what OFF does, what quiet hours and the posting window hold, which
// actions never run without a person, who may say yes — as plain functions over plain values.
// This file imports nothing, so lib/eve/__tests__/agent-rules.test.mjs can prove each rule with
// numbers and dates instead of trusting it. agent-mode.ts re-exports the names it always exported,
// so no caller changes its import.

// ---- The action inventory: names and limits --------------------------------------------------------

export type ActionType =
  | 'slack_post' | 'telegram_ask' | 'email_draft' | 'email_send'
  | 'guest_reply_draft' | 'guest_reply_send' | 'guest_notice_send'
  | 'task_create' | 'task_assign' | 'task_note' | 'task_cancel'
  | 'door_code_release' | 'guesty_write' | 'calendar_block'
  | 'recommendation' | 'memory_rule'

export type Rung = 0 | 1 | 2 | 3 | 4
export type Mode = 'observe' | 'draft' | 'propose' | 'act' | 'deferred'

/**
 * `def` — the rung an action starts on when agent mode is switched on. `cap` — the hard ceiling:
 * the UI shows a lock above it and clampRung() holds it whatever the stored JSON says. The labels
 * and descriptions are in agent-mode.ts ACTIONS, which takes its numbers from this table.
 */
export const ACTION_LIMITS: Readonly<Record<ActionType, { def: Rung; cap: Rung }>> = {
  slack_post: { def: 3, cap: 4 },
  telegram_ask: { def: 2, cap: 4 },
  email_draft: { def: 2, cap: 4 },
  email_send: { def: 2, cap: 2 },           // permanently propose-only; the executor is not enabled
  guest_reply_draft: { def: 2, cap: 4 },
  guest_reply_send: { def: 2, cap: 2 },     // a message a guest receives: a person, always
  guest_notice_send: { def: 2, cap: 4 },    // fixed templates only; acts only inside a pilot building
  task_create: { def: 2, cap: 4 },
  task_assign: { def: 2, cap: 4 },
  task_note: { def: 2, cap: 4 },
  // CAPPED AT PROPOSE (2026-11-10, was 3). Cancelling a task removes work somebody planned around;
  // a wrong one is found when the job is not done. A person says yes to every cancellation.
  task_cancel: { def: 2, cap: 2 },
  door_code_release: { def: 2, cap: 2 },
  guesty_write: { def: 2, cap: 2 },
  calendar_block: { def: 0, cap: 0 },       // switched off for good (Jon, 2026-09-23)
  recommendation: { def: 1, cap: 1 },       // her ledger — never leaves the app
  memory_rule: { def: 1, cap: 1 },          // her notebook — never leaves the app
}
export const ACTION_TYPES = Object.keys(ACTION_LIMITS) as ActionType[]

/**
 * THE SECOND LOCK. These never run unless the context says a person approved THIS action
 * (`human: true`, set by executeProposal, the Send button, a Slack or Telegram yes). The first lock
 * is the cap above — agentAllowed can never answer `act` for them; this one catches a code path
 * that forgot to ask. lib/eve/executors.ts runExecutor enforces it for every caller.
 */
export const NEEDS_HUMAN: readonly ActionType[] = ['guest_reply_send', 'guesty_write', 'calendar_block', 'email_send', 'door_code_release', 'task_cancel']

/** The refusal runExecutor returns for a welded action with no person behind it; null when it may run. */
export function needsHumanRefusal(action: ActionType | string, human: boolean | undefined | null): { summary: string; error: string } | null {
  if ((NEEDS_HUMAN as readonly string[]).indexOf(String(action)) < 0 || human === true) return null
  return { summary: `${action} only runs after a person says yes`, error: 'This action is welded to propose: a person has to approve it.' }
}

// ---- Rungs and modes -------------------------------------------------------------------------------

export function clampRung(v: any, cap: Rung): Rung {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(cap, n)) as Rung
}
export function modeOf(rung: Rung): Mode {
  return rung >= 3 ? 'act' : rung === 2 ? 'propose' : rung === 1 ? 'draft' : 'observe'
}
const RANK: Record<Mode, number> = { observe: 0, draft: 1, propose: 2, deferred: 3, act: 3 }
export function lower(a: Mode, b: Mode): Mode { return RANK[a] <= RANK[b] ? a : b }

// ---- Two tiers of yes ------------------------------------------------------------------------------

// TWO TIERS OF YES (Eve audit 2026-10-10). Sixty asks a week went to ONE approver and 65% of them
// expired — "draft a reply to a guest who has waited 9h", "make the Breezeway task for this glitch".
// None of those is money, a door code, a cancellation or a write to Guesty; they are the desk's own
// work, which the desk can say yes to. DESK actions can be approved by anyone on the team with a
// Lighthouse login (the people in #vr-customercareteam); OWNER actions stay with the approver list.
// Jon's rule (2026-09-10): "anyone can ask if they need something, only approvals are PTE and door
// codes… Money is not something Eve should ever share." Settings → Eve → Agent mode → deskApprovals.
export const DESK_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(['task_note', 'task_create', 'task_assign', 'guest_reply_draft', 'guest_reply_send', 'guest_notice_send'])
export type Tier = 'desk' | 'owner'
export function tierOf(action: ActionType | string, payload?: any): Tier {
  if (!DESK_ACTIONS.has(action as ActionType)) return 'owner'
  // Money attached, or anything that reads as a cancellation/refund, is the owner's whatever the verb.
  if (payload && (Number(payload.usd) > 0 || /refund|cancel|discount|comp\b|credit/i.test(String(payload.summary || '')))) return 'owner'
  return 'desk'
}

/**
 * WHO MAY SAY YES TO ONE ACTION — the rule executeProposal applies, written once so the panel, the
 * Slack thread and the drafts list cannot drift apart. 'approver' = on the approver list (or a
 * superadmin, or the list is empty — the old rule); 'desk' = a desk-tier action while deskApprovals
 * is on, from anyone whose identity resolved to an email; null = may not.
 */
export function mayApprove(s: { approvers: readonly string[]; deskApprovals: boolean }, action: ActionType | string, payload: any, by: string | null | undefined, superadmin: boolean): 'approver' | 'desk' | null {
  const e = String(by || '').toLowerCase().trim()
  const list = (s.approvers || []).map(x => String(x).toLowerCase().trim()).filter(Boolean)
  if (superadmin || !list.length || list.indexOf(e) >= 0) return 'approver'
  if (s.deskApprovals && tierOf(action, payload) === 'desk' && /@/.test(e)) return 'desk'
  return null
}

// ---- Clocks ----------------------------------------------------------------------------------------

/** Minutes east of UTC for a zone (default America/New_York) at a given instant (negative = west). */
export function etOffsetMinutes(d: Date, zone = 'America/New_York'): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(d)
    const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5'
    const m = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
    if (!m) return -300
    const h = Number(m[1]); const mm = Number(m[2] || 0)
    return h * 60 + (h < 0 ? -mm : mm)
  } catch { return -300 }
}

export type QuietHours = { start: string; end: string; tz: string }
function toMin(hhmm: string): number { const [h, m] = String(hhmm).split(':').map(Number); return ((h || 0) % 24) * 60 + (m || 0) }

export function inQuietHours(s: { quietHours: QuietHours }, now = new Date()): boolean {
  try {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: s.quietHours.tz || 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
    const cur = toMin(hm), a = toMin(s.quietHours.start), b = toMin(s.quietHours.end)
    if (a === b) return false
    return a < b ? (cur >= a && cur < b) : (cur >= a || cur < b)   // wraps midnight
  } catch { return false }
}

/**
 * The next instant quiet hours end, as an ISO string. Inside quiet hours this is the coming `end`
 * (today or tomorrow in the zone, whichever is next); outside them it is `now`, so a deferral made
 * by mistake flushes on the next pass rather than waiting a day.
 */
export function quietHoursEnd(s: { quietHours: QuietHours }, now = new Date()): string {
  try {
    if (!inQuietHours(s, now)) return now.toISOString()
    const tz = s.quietHours.tz || 'America/New_York'
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    const parts: Record<string, string> = {}
    for (const p of f.formatToParts(now)) parts[p.type] = p.value
    const cur = toMin(`${parts.hour}:${parts.minute}`), end = toMin(s.quietHours.end)
    // Local wall-clock of the end, today; if that has already passed today, tomorrow. Read as UTC on
    // purpose ('Z'): the zone's offset is taken off below, so the answer does not depend on the
    // server's own time zone (it was right before only because the servers run in UTC).
    let local = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}:00Z`)
    if (cur >= end) local = new Date(local.getTime() + 86400_000)
    const instant = new Date(local.getTime() - etOffsetMinutes(local, tz) * 60_000)
    return instant.toISOString()
  } catch { return new Date(now.getTime() + 60 * 60_000).toISOString() }
}

// THE POSTING WINDOW — 7am–8pm ET (Jon, 2026-11-05: "nothing posts between 8pm and 7am ET"). The same
// numbers and the same test as lib/eve/room-gate.ts, which gates the direct posts; this copy is the
// one the agent gate (stepDown, flushDeferred) uses and the one the tests exercise.
export const POST_WINDOW_ET = { start: 7, end: 20 }
export function etHour(now = new Date()): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now))
  return h === 24 ? 0 : h
}
export function inPostWindow(now = new Date(), win: { start: number; end: number } = POST_WINDOW_ET): boolean {
  const h = etHour(now)
  return h >= win.start && h < win.end
}
/** The next instant the 7am–8pm ET posting window is open (now, when it already is). */
export function nextPostWindowOpen(now = new Date()): string {
  const t0 = Math.ceil(now.getTime() / 300_000) * 300_000
  for (let i = 0; i <= 14 * 12; i++) { const t = new Date(t0 + i * 300_000); if (inPostWindow(t)) return t.toISOString() }
  return new Date(now.getTime() + 11 * 3600_000).toISOString()
}

// ---- The daily counters ----------------------------------------------------------------------------

export type AgentCounters = { date: string; actions: number; asks: number; byAction: Record<string, number> }

/** Whatever is stored → today's counters; a row from another day (or none, or garbage) is a fresh day. */
export function countersFor(raw: any, today: string): AgentCounters {
  let c: any = raw
  if (typeof c === 'string') { try { c = JSON.parse(c) } catch { c = null } }
  if (c && typeof c === 'object' && c.date === today) {
    return { date: today, actions: Number(c.actions) || 0, asks: Number(c.asks) || 0, byAction: c.byAction && typeof c.byAction === 'object' ? { ...c.byAction } : {} }
  }
  return { date: today, actions: 0, asks: 0, byAction: {} }
}
/** One more action or ask, as a NEW object (the input is never mutated, so a failed write can be retried from a fresh read). */
export function bumpCounters(c: AgentCounters, action: string, countAs: 'action' | 'ask'): AgentCounters {
  return {
    date: c.date,
    actions: c.actions + (countAs === 'action' ? 1 : 0),
    asks: c.asks + (countAs === 'ask' ? 1 : 0),
    byAction: { ...c.byAction, [action]: (c.byAction[action] || 0) + 1 },
  }
}

// ---- The AI-spend cap the agent can actually reach -------------------------------------------------

/**
 * THE AGENT'S OWN AI CAP, MADE HONEST (2026-11-10). Settings → Eve → Agent mode has "AI spend, $"
 * (default 15): past it she stops acting on her own and asks instead. But every AI call in the app
 * stops at the app-wide daily cap first (Settings → AI models, default $9), so a 15 here could never
 * trip and the panel showed a limit that did not exist. The cap that applies is therefore the
 * SMALLER of the two: her own number, or the app-wide daily total while that budget is on. 0 means
 * she has no cap of her own.
 */
export function effectiveAiCap(agentUsd: number, app: { on: boolean; totalUsd: number } | null | undefined): number {
  const own = Number(agentUsd)
  if (!Number.isFinite(own) || own <= 0) return 0
  const total = app && app.on ? Number(app.totalUsd) : NaN
  return Number.isFinite(total) && total > 0 ? Math.min(own, total) : own
}

// ---- The decision ----------------------------------------------------------------------------------

export type GateInput = {
  action: ActionType
  /** The rung stored for this action (undefined → the action's default). */
  storedRung?: any
  /** Agent mode's master switch. */
  enabled: boolean
  /** The pilot's name when this unit is inside a LIVE pilot building and the action is on its list. */
  pilot?: string | null
  /** …and the building, for the reason line. */
  pilotBuilding?: string | null
  /** Money at stake, when there is any. */
  usd?: number
  budgets: { asksPerDay: number; actionsPerDay: number; moneyCeilingUsd: number }
  /** Today's counters. */
  counters: { actions: number; asks: number }
  /** The cap that applies to her AI spend today (effectiveAiCap); 0 = none. */
  aiCapUsd: number
  /** What her own tasks have spent today. */
  aiSpendUsd: number
  /** The caller's `ask: true` — this would ping a person. */
  ask?: boolean
  /** A person asked for this right now — quiet hours do not hold it. */
  urgent?: boolean
  /** Is it quiet hours right now? */
  quiet: boolean
  /** The quiet-hours setting, for the reason line. */
  quietHours: QuietHours
}

/** Step 1 — the rung and what OFF does to it. `internal` = her notebook and ledger, which never leave the app. */
export function gateStart(i: Pick<GateInput, 'action' | 'storedRung' | 'enabled' | 'pilot' | 'pilotBuilding'>, why: string[]): { rung: Rung; mode: Mode } {
  const lim = ACTION_LIMITS[i.action] as { def: Rung; cap: Rung } | undefined
  let rung = clampRung(i.storedRung ?? (lim ? lim.def : 0), lim ? lim.cap : 2)
  // PILOT: inside a pilot building, a listed action acts — only for an action whose cap allows it.
  if (i.pilot && (lim ? lim.cap : 2) >= 4) { rung = 4; why.push(`${i.pilot} (${i.pilotBuilding}): act`) }
  let mode = modeOf(rung)
  const internal = rung <= 1 && !!lim && lim.cap <= 1   // recommendation / memory: never leave the app
  if (!i.enabled && !internal) {
    // OFF: nothing leaves the app. Drafts still get written, so the work is not lost — just parked.
    mode = lower(mode, 'draft'); why.push('agent mode is OFF')
  }
  return { rung, mode }
}
/** Step 2 — money over the ceiling is never acted on. */
export function gateMoney(mode: Mode, i: Pick<GateInput, 'usd' | 'budgets'>, why: string[]): Mode {
  const usd = Number(i.usd)
  if (Number.isFinite(usd) && usd > 0 && mode === 'act' && usd > i.budgets.moneyCeilingUsd) {
    why.push(`$${usd.toFixed(2)} is over the $${i.budgets.moneyCeilingUsd} ceiling`)
    return 'propose'
  }
  return mode
}
/** Does step 3 need today's counters / today's AI spend? (So the caller reads them only when it does.) */
export function gateNeedsCounters(mode: Mode): boolean { return mode === 'act' || mode === 'propose' }
export function gateNeedsSpend(mode: Mode, i: Pick<GateInput, 'budgets' | 'counters' | 'aiCapUsd'>): boolean {
  return mode === 'act' && i.counters.actions < i.budgets.actionsPerDay && i.aiCapUsd > 0
}
/** Step 3 — the daily budgets: actions, AI spend, asks. Only called for act / propose. */
export function gateBudgets(mode: Mode, i: Pick<GateInput, 'action' | 'ask' | 'budgets' | 'counters' | 'aiCapUsd' | 'aiSpendUsd'>, why: string[]): Mode {
  if (mode !== 'act' && mode !== 'propose') return mode
  if (mode === 'act' && i.counters.actions >= i.budgets.actionsPerDay) { mode = 'propose'; why.push(`today's ${i.budgets.actionsPerDay} actions are spent`) }
  if (mode === 'act' && i.aiCapUsd > 0 && i.aiSpendUsd >= i.aiCapUsd) { mode = 'propose'; why.push(`AI spend $${i.aiSpendUsd} is over today's $${i.aiCapUsd}`) }
  // THE ASKS BUDGET IS FOR ASKS (2026-09-28 audit, F22). Every cron-originated proposal passes
  // ask:true, so a proposal that would ping an approver (or a Telegram message itself) counts
  // against the daily asks. An act that pings nobody is not charged, so ask:true can never turn the
  // morning roll-up into a draft just because six questions went out earlier. Decided after the two
  // downgrades above, so an act they turned into a proposal is counted as the ask it now is.
  const isAsk = i.action === 'telegram_ask' || i.ask === true
  if (isAsk && (mode === 'propose' || i.action === 'telegram_ask') && i.counters.asks >= i.budgets.asksPerDay) { mode = lower(mode, 'draft'); why.push(`today's ${i.budgets.asksPerDay} asks are spent`) }
  return mode
}
/**
 * Step 4 — QUIET HOURS: an act is held, not turned into a proposal nobody is told about. A Telegram
 * ask is a message to a person, so at rung 2 (where it sends) it is held as well — hold until
 * morning, never propose-to-nobody at 3am. Decided last so the budgets above still apply.
 */
export function gateQuiet(mode: Mode, i: Pick<GateInput, 'action' | 'urgent' | 'quiet' | 'quietHours'>, why: string[]): Mode {
  if (!i.urgent && i.quiet && (mode === 'act' || (i.action === 'telegram_ask' && mode === 'propose'))) {
    why.push(`quiet hours ${i.quietHours.start}–${i.quietHours.end} ${i.quietHours.tz}: held until ${i.quietHours.end}`)
    return 'deferred'
  }
  return mode
}

/** The four steps in order — what agentAllowed does, with every reading already in hand. */
export function decideGate(i: GateInput): { rung: Rung; mode: Mode; ok: boolean; needsApproval: boolean; reason: string } {
  const why: string[] = []
  const start = gateStart(i, why)
  let mode = gateMoney(start.mode, i, why)
  mode = gateBudgets(mode, i, why)
  mode = gateQuiet(mode, i, why)
  const reason = why.length ? why.join('; ') : (mode === 'act' ? `rung ${start.rung}: act` : `rung ${start.rung}: ${mode}`)
  return { rung: start.rung, mode, ok: mode === 'act', needsApproval: mode === 'propose', reason }
}
