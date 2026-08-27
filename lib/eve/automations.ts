// THE AUTOMATION REGISTRY — one place that knows what this app does while nobody is watching.
//
// Jon, 2026-08-26: "she needs to understand all automations."
//
// The audit that started this work found that Eve — who can read almost every table in the
// business — had no route to a single automation SWITCH. She could not answer "is guest orders
// on", "who gets the 7am brief", "what fires a late-clean alert", "did the sentiment scan run
// today". Not because the data was hidden, but because nothing had ever written down what the
// automations ARE. The schedules lived in vercel.json, the switches in a dozen app_settings keys,
// the descriptions in the head of whoever built each one.
//
// So this file is that written-down thing, and it is deliberately the ONLY copy:
//   - `lib/eve/audit.ts` builds its expected-cron list from here, so adding an automation
//     automatically puts it under the audit's watch instead of quietly outside it. Three crons
//     were silently dropped by a merge once; the audit only noticed the fourteen it had been told
//     about by hand.
//   - the `automations` tool reads it, resolves each switch against the LIVE setting, and joins
//     the last recorded run.
//   - the settings page it points at is where a human goes to change the answer.
//
// WHAT MAKES AN ENTRY HONEST. `enabledPath` is a dot-path into the stored config, and a missing
// key is reported as "unset (off)" rather than assumed on — the maintenance briefs were
// `enabled:true` with empty recipient lists for weeks, sending nothing, and every dashboard said
// they were fine. Default-off automations are marked so, because "no orders today" and "the orders
// automation has never been switched on" are different sentences.
import 'server-only'
import { getSetting } from '@/lib/app-settings'

export type AutomationArea = 'sync' | 'guests' | 'ops' | 'money' | 'slack' | 'eve'

export type AutomationDef = {
  key: string
  label: string
  /** Plain English, one sentence, written for someone who has never seen the code. */
  what: string
  area: AutomationArea
  /** The vercel.json path (crons) or a note for event-driven ones. */
  path?: string
  trigger?: string
  /** app_settings key holding its configuration, when it has one. */
  configKey?: string
  /** Dot-path inside that config to the on/off switch. Absent = always on. */
  enabledPath?: string
  /** Dot-paths to recipient lists worth surfacing. */
  recipientPaths?: string[]
  /** Where a human changes it. */
  settingsPath?: string
  /** True when the shipped default is OFF and someone must switch it on deliberately. */
  defaultOff?: boolean
  /** What it records into automation_runs / email_log, when it records anything. */
  receipt?: 'automation_runs' | 'email_log' | 'slack_outbox' | 'none'
  notes?: string
}

export const AUTOMATIONS: AutomationDef[] = [
  // ---- Keeping the mirror true to Guesty / Breezeway / Homebase ------------------------------
  { key: 'reservations', label: 'Bookings sync', area: 'sync', path: '/api/cron/reservations',
    what: 'Pulls new and changed Guesty reservations into our mirror every five minutes. Everything dated in this app rests on it.', receipt: 'none' },
  { key: 'reservations-full', label: 'Bookings full resync', area: 'sync', path: '/api/cron/reservations-full',
    what: 'Once a day, re-pulls an 80-day window rather than trusting the incremental watermark, so a missed webhook cannot rot quietly.', receipt: 'none' },
  { key: 'sync-reviews', label: 'Reviews sync', area: 'guests', path: '/api/cron/sync-reviews',
    what: 'Pulls guest reviews from Guesty on their own cadence, per channel — the feed whose per-channel death hid behind a portfolio-wide freshness check for a week.', receipt: 'none' },
  { key: 'guesty-full', label: 'Guesty full reconcile', area: 'sync', path: '/api/sync/guesty',
    what: 'Every two hours, reconciles listings, custom-field definitions, conversations and reviews.', receipt: 'none' },
  { key: 'guest-comms', label: 'Conversations & messages sync', area: 'guests', path: '/api/cron/guest-comms',
    what: 'Pulls guest conversations and their recent messages, then recomputes response times for anything that moved.', receipt: 'none' },
  { key: 'breezeway-tasks', label: 'Breezeway task mirror', area: 'ops', path: '/api/cron/breezeway-tasks',
    what: 'Mirrors Breezeway tasks and their comments, and raises the behind-schedule signal the ops board reads.', receipt: 'none' },
  { key: 'owner-statements', label: 'Owner statements sync', area: 'money', path: '/api/sync/owner-statements',
    what: 'Mirrors Guesty owner statements and their line items — the source of truth for anything owner-facing.', receipt: 'none' },
  { key: 'revenue-sync', label: 'Revenue app mirror', area: 'money', path: '/api/cron/revenue-sync',
    what: "Hourly pull of the boss's revenue app feeds (snapshots, budget, owner map) into the rev_* mirror.", receipt: 'automation_runs' },
  { key: 'schedule-sync', label: 'Turnover schedule refresh', area: 'ops', path: '/api/schedule/sync',
    what: 'Twice a day, forces the turnover schedule cache to rebuild so the board is not served stale.', receipt: 'none' },
  { key: 'billing-detail', label: 'Billable-hours backfill', area: 'money', path: '/api/cron/billing-detail',
    what: 'Walks Breezeway task cost and supply detail into the billing mirror, current month first then backwards.', receipt: 'automation_runs',
    notes: 'Until it catches up, every maintenance recovery rate reads LOWER than reality.' },

  // ---- Watching the machine ------------------------------------------------------------------
  { key: 'watchdog', label: 'Sync watchdog', area: 'sync', path: '/api/cron/watchdog',
    what: 'Checks that each feed actually ran, per channel, and says so in Slack when one dies or recovers.', receipt: 'slack_outbox' },
  { key: 'eve-audit', label: "Eve's standing audit", area: 'eve', path: '/api/cron/eve-audit',
    what: 'Runs her own audit of what is broken right now and posts only NEW findings, with one roll-up after 7am.', receipt: 'automation_runs',
    settingsPath: '/users → Settings → Eve → Audits' },
  { key: 'eve-metrics', label: 'Daily baselines', area: 'eve', path: '/api/cron/eve-metrics',
    what: 'Snapshots the day\'s numbers so trends and anomalies have a history to sit against, and grades recommendations that came due.', receipt: 'automation_runs',
    notes: 'Without this, trend() and anomaly_scan() have nothing to compare against.' },
  { key: 'eve-learn', label: 'Nightly learning pass', area: 'eve', path: '/api/eve/learn',
    what: 'Mines messages, reviews and her own chat log into knowledge, expires beliefs that stopped being true, and writes new questions for a human.', receipt: 'automation_runs',
    settingsPath: '/users → Settings → Eve → Memory' },

  // ---- Guests ---------------------------------------------------------------------------------
  { key: 'sentiment', label: 'Guest sentiment scan', area: 'guests', path: '/api/sentiment/scan',
    what: 'Scores recently active guest threads for unhappiness and flags the reservation Sensitive in Guesty when it is bad.', receipt: 'none' },
  { key: 'reservation-notices', label: 'Front-desk notice queue', area: 'guests', path: '/api/cron/reservation-notices',
    what: 'Builds the per-building front-desk notice queue for arrivals.', configKey: 'reservation_emails',
    settingsPath: '/users → Settings → Reservation emails', receipt: 'none' },
  { key: 'notice-drafts', label: 'Notice drafts into Gmail', area: 'guests', path: '/api/cron/notice-drafts',
    what: 'Drafts those notices into the sending mailbox so a human only has to read and press send.',
    configKey: 'task_automation', enabledPath: 'noticeDrafts.enabled', defaultOff: true,
    settingsPath: '/users → Settings → Task automation', receipt: 'none' },
  { key: 'guest-orders', label: 'Guest orders', area: 'guests', path: '/api/cron/guest-orders',
    what: 'Writes the per-reservation order link into Guesty, and on the delivery day pushes paid orders to Breezeway, Slack and email.',
    configKey: 'guest_orders', enabledPath: 'enabled', defaultOff: true,
    settingsPath: '/users → Settings → Guest orders', receipt: 'automation_runs' },
  { key: 'guide-activations', label: 'Guidebook events', area: 'guests', path: '/api/cron/guide-activations',
    what: 'Scrapes building event calendars into the guest guidebook so what a guest reads is current.', receipt: 'none' },
  { key: 'welcome-calls', label: 'Welcome calls', area: 'guests', trigger: 'in-app',
    what: 'Tracks the pre-arrival welcome call on a reservation custom field; not scheduled, driven by the desk.', receipt: 'none' },

  // ---- Ops ------------------------------------------------------------------------------------
  { key: 'auto-inspections', label: 'Automatic inspections', area: 'ops', path: '/api/cron/auto-inspections',
    what: 'Creates and assigns an inspection ahead of big, VIP or owner arrivals, and for units whose reviews have slipped.',
    configKey: 'task_automation', enabledPath: 'enabled', defaultOff: true,
    settingsPath: '/users → Settings → Task automation', receipt: 'none',
    notes: 'Writes to auto_inspections — a DIFFERENT table from the manual unit_inspections the inspections tool reads.' },
  { key: 'suggestions', label: 'Preventative suggestions', area: 'ops', path: '/api/cron/suggestions',
    what: 'Each morning works out which preventative jobs are due, throws away everything that cannot happen today, and proposes a capped handful on Today in Ops — creating only the cadences set to run themselves.',
    configKey: 'preventative_cadences', enabledPath: 'enabled', defaultOff: true,
    settingsPath: '/users \u2192 Settings \u2192 Preventative cadences', receipt: 'automation_runs',
    notes: 'On a heavy turn day it deliberately proposes and creates nothing — that is the day read working, not a failure.' },
  { key: 'stay-window', label: 'Minimum-stay switch', area: 'ops', path: '/api/cron/stay-window',
    what: 'Flips the minimum-stay rule at the hour Jon set, so the calendar opens up without anyone remembering to do it.',
    configKey: 'stay_window', enabledPath: 'enabled', defaultOff: true, receipt: 'none' },
  { key: 'claims-nudge', label: 'Claims nudge', area: 'ops', path: '/api/cron/claims',
    what: 'Chases claims that are unfiled, overdue, or about to fall outside the channel filing window.', receipt: 'none' },

  // ---- Slack ----------------------------------------------------------------------------------
  { key: 'slack-alerts', label: 'Slack alert engines', area: 'slack', path: '/api/cron/slack',
    what: 'Every half hour, runs fourteen alert engines (late cleans, glitches, overtime, readiness, walk-in risk, door codes, handover and the rest) and dispatches whatever has been approved.',
    configKey: 'slack_rules', settingsPath: '/users → Settings → Slack alerts & rules', receipt: 'slack_outbox' },
  { key: 'slack-digest', label: 'Morning Slack digest', area: 'slack', path: '/api/cron/slack-digest',
    what: 'Posts the day-ahead summary into the ops channel.', configKey: 'slack_rules', receipt: 'slack_outbox' },
  { key: 'weekly-planner', label: 'Weekly plan', area: 'slack', path: '/api/cron/weekly-planner',
    what: 'Sunday night, posts next week\'s plan per market.', configKey: 'slack_rules', enabledPath: 'events.weekly_planner.enabled',
    settingsPath: '/users → Settings → Slack alerts & rules', receipt: 'slack_outbox' },

  // ---- The morning mail -----------------------------------------------------------------------
  { key: 'ops-brief', label: 'Morning ops brief', area: 'ops', path: '/api/cron/ops-brief',
    what: 'The 7am email: Miami, Broward, the full portfolio, the GM edition and the vendor buildings.',
    configKey: 'ops_brief', enabledPath: 'enabled', recipientPaths: ['recipients', 'miami', 'broward', 'gm', 'vendor'],
    settingsPath: '/users → Settings → Morning brief', receipt: 'email_log' },
  { key: 'maint-brief', label: 'Maintenance brief', area: 'ops', path: '/api/cron/maint-brief',
    what: 'The maintenance worklist email for Miami and Broward.', configKey: 'ops_brief', enabledPath: 'maint.enabled',
    recipientPaths: ['maint.miami', 'maint.broward'], settingsPath: '/users → Settings → Morning brief', receipt: 'email_log',
    notes: 'Shipped enabled with EMPTY recipient lists and therefore sent nothing at all for weeks — the reason a recipient list is now shown next to every switch.' },
  { key: 'labor-trueup', label: 'Daily labor email', area: 'money', path: '/api/cron/labor-trueup',
    what: 'Yesterday against the last 7 and 30 days: cleans completed, actual clocked hours, revenue and profit.',
    configKey: 'labor_trueup', recipientPaths: ['recipients'], settingsPath: '/users → Settings → Morning brief', receipt: 'email_log' },
  { key: 'salato-daily', label: 'Salato daily', area: 'guests', path: '/api/cron/salato-daily',
    what: 'The arrivals-and-departures email for the Salato front desk.', configKey: 'salato_daily', enabledPath: 'enabled',
    recipientPaths: ['recipients'], defaultOff: true, settingsPath: '/users → Settings → Morning brief', receipt: 'email_log' },

  // ---- Event-driven ----------------------------------------------------------------------------
  { key: 'breezeway-webhook', label: 'Breezeway webhook', area: 'ops', trigger: 'webhook', path: '/api/breezeway/webhook',
    what: 'Breezeway calls us the moment a task changes; we re-fetch the task rather than trusting the payload.', receipt: 'none' },
  { key: 'telegram', label: 'Eve on Telegram', area: 'eve', trigger: 'webhook', path: '/api/telegram/webhook',
    what: 'Approved people can ask Eve anything from Telegram; unapproved ones get one polite refusal and a row waiting for a human.',
    settingsPath: '/users → Settings → Eve → Telegram', receipt: 'none' },
]

export const AUTOMATION_KEYS = AUTOMATIONS.map(a => a.key)

/** Every cron path the app expects to be scheduled. The audit's watch list, derived not retyped. */
export function expectedCronPaths(): string[] {
  const out: string[] = []
  for (const a of AUTOMATIONS) {
    if (a.trigger === 'webhook' || a.trigger === 'in-app') continue
    if (a.path && out.indexOf(a.path) < 0) out.push(a.path)
  }
  return out
}

export function findAutomation(key: string): AutomationDef | null {
  const k = String(key || '').toLowerCase().trim()
  if (!k) return null
  return AUTOMATIONS.find(a => a.key === k)
    || AUTOMATIONS.find(a => a.path === k)
    || AUTOMATIONS.find(a => a.label.toLowerCase() === k)
    || AUTOMATIONS.find(a => a.key.includes(k) || a.label.toLowerCase().includes(k))
    || null
}

/** Dot-path read that treats a missing key as missing rather than as false. */
export function readPath(obj: any, path: string): any {
  if (!obj || !path) return undefined
  let cur: any = obj
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function recipientsOf(cfg: any, def: AutomationDef): { path: string; count: number; to: string[] }[] {
  const out: { path: string; count: number; to: string[] }[] = []
  for (const p of (def.recipientPaths || [])) {
    const v = readPath(cfg, p)
    const list = Array.isArray(v) ? v.map((x: any) => String(x?.email || x)).filter(Boolean)
      : (v && typeof v === 'object' && Array.isArray(v.recipients)) ? v.recipients.map((x: any) => String(x?.email || x)).filter(Boolean)
      : []
    out.push({ path: p, count: list.length, to: list.slice(0, 12) })
  }
  return out
}

export type AutomationState = {
  key: string
  label: string
  what: string
  area: AutomationArea
  runs: string           // human-readable schedule, or the trigger
  path?: string
  on: boolean | null     // null = no switch, i.e. always on
  onWhy: string
  settings?: string
  recipients?: { path: string; count: number; to: string[] }[]
  notes?: string
  receipt: string
}

/** Turn a cron expression into something a person reads without decoding it. */
export function describeSchedule(expr: string): string {
  const e = String(expr || '').trim()
  if (!e) return 'not scheduled'
  const [min, hour, dom, mon, dow] = e.split(/\s+/)
  const et = (h: string) => {
    // vercel crons are UTC; the business runs on ET. Show both, because every argument about
    // "the 7am brief" has been an argument about which clock.
    const n = Number(h)
    if (!Number.isFinite(n)) return `${h} UTC`
    const e1 = (n + 24 - 4) % 24
    return `${String(n).padStart(2, '0')}:00 UTC (${String(e1).padStart(2, '0')}:00 ET)`
  }
  if (min?.includes('/') || hour === '*') {
    if (min === '*') return 'every minute'
    if (min?.includes('/')) return `every ${min.split('/')[1]} minutes`
    return `hourly at :${min}`
  }
  if (dow && dow !== '*') return `weekly (day ${dow}) at ${et(hour)}`
  if (dom && dom !== '*') return `monthly (day ${dom}) at ${et(hour)}`
  return `daily at ${et(hour)} :${min}`
}

let _schedules: Record<string, string[]> | null = null
async function schedules(): Promise<Record<string, string[]>> {
  if (_schedules) return _schedules
  const out: Record<string, string[]> = {}
  try {
    const cfg: any = await import('@/vercel.json').then((m: any) => m.default || m)
    for (const c of (cfg?.crons || [])) {
      const p = String(c?.path || '')
      if (!p) continue
      ;(out[p] = out[p] || []).push(String(c?.schedule || ''))
    }
  } catch { /* the automations list still works without schedules */ }
  _schedules = out
  return out
}

/**
 * The live state of one automation: is it on, on what schedule, with which recipients.
 * A config key that has never been saved reads as OFF and SAYS SO — the difference between
 * "switched off" and "never set up" is the whole answer to half of Jon's questions.
 */
export async function automationState(def: AutomationDef): Promise<AutomationState> {
  const cfg = def.configKey ? await getSetting<any>(def.configKey, null) : null
  let on: boolean | null = null
  let onWhy = 'always on — no switch'
  if (def.enabledPath) {
    const v = readPath(cfg, def.enabledPath)
    if (v === undefined || v === null) {
      on = false
      onWhy = cfg ? `never set (${def.configKey}.${def.enabledPath} is missing) — treated as off`
                  : `never configured (${def.configKey} has no saved value) — treated as off`
    } else {
      on = v === true
      onWhy = on ? `on (${def.configKey}.${def.enabledPath})` : `off (${def.configKey}.${def.enabledPath})`
    }
  } else if (def.configKey) {
    on = null
    onWhy = cfg ? `always runs; configured by ${def.configKey}` : `always runs; ${def.configKey} has no saved config yet`
  }
  const sch = (await schedules())[def.path || ''] || []
  const runs = sch.length ? sch.map(describeSchedule).join(' and ')
    : def.trigger === 'webhook' ? 'when the other system calls us'
    : def.trigger === 'in-app' ? 'when someone uses it'
    : 'NOT SCHEDULED — no cron entry found'
  return {
    key: def.key, label: def.label, what: def.what, area: def.area, runs, path: def.path,
    on, onWhy, settings: def.settingsPath, notes: def.notes, receipt: def.receipt || 'none',
    recipients: def.recipientPaths ? recipientsOf(cfg, def) : undefined,
  }
}

export async function allAutomationStates(area?: string): Promise<AutomationState[]> {
  const a = String(area || '').toLowerCase().trim()
  const defs = a ? AUTOMATIONS.filter(d => d.area === a) : AUTOMATIONS
  return Promise.all(defs.map(automationState))
}
