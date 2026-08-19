// SLACK ALERT RULES — everything about who hears what, and when, editable from /users.
//
// Jon, 2026-08-19: "This should be editable in user settings, ect where we can set rules."
// So nothing here is hardcoded behaviour. The channel each building posts to, who is always
// tagged, the overtime threshold, the quiet hours, whether an event needs approval before it
// sends, how long an unapproved item lives — all of it is one JSON blob in app_settings that the
// admin screen reads and writes. No migration.
//
// THE STANDING RULES Jon set, expressed as defaults below:
//   - Every alert tags the person involved + that building's supervisor + Roberto + Karla + Jon.
//   - Nothing staff-facing sends until a human approves it; sync failures go straight out.
//   - Group, never spam: one message per building per run, tagging everyone at once.
//   - Encouraging tone, always.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { getDirectory, type SlackUser } from './slack'
import { nameMatches, nameMatchesRoster } from './homebase'

export const RULES_KEY = 'slack_rules'

/** The alerts this system can send. Adding one here + a default rule is all it takes. */
export type EventKey = 'late_cleans' | 'glitches' | 'overtime' | 'sync' | 'digest' | 'personal_brief'

export const EVENT_LABELS: Record<EventKey, string> = {
  late_cleans: 'Cleans running behind',
  glitches: 'Glitches & guest issues',
  overtime: 'Someone running over hours',
  sync: 'Sync failures (system)',
  digest: 'Morning ops digest',
  personal_brief: 'Personal morning brief (DM)',
}

export type EventRule = {
  enabled: boolean
  /** Hold in the approval queue instead of sending straight away. */
  approval: boolean
  /** Minutes-of-day window. Nothing sends outside it — an 11pm alert helps nobody. */
  quietStart: number
  quietEnd: number
  /** Minimum minutes between two sends about the same thing. The anti-spam floor. */
  cooldownMin: number
}

export type SlackRules = {
  /** Gets a copy of everything, so Jon can see the whole picture in one place. */
  firehose: string | null
  /** Used when a building has no channel of its own. */
  defaultChannel: string | null
  /** building label (from lib/segments) -> Slack channel id */
  buildings: Record<string, string>
  /** building label -> Slack user ids who supervise it */
  supervisors: Record<string, string[]>
  /** Always tagged on every alert, whatever the building. Jon + Roberto + Karla. */
  core: string[]
  /** Manual staff-name -> Slack id overrides, for when the fuzzy match cannot get there. */
  people: Record<string, string>
  events: Record<EventKey, EventRule>
  /** Slack ids who receive the approve/skip DM. */
  approvers: string[]
  /** An unapproved item older than this is dropped rather than sent. */
  approvalExpiryMin: number
  /** Hours on the clock in one day before we flag someone as running long. */
  overtimeHours: number
  /** Free-text steer folded into every generated message. */
  tone: string
}

// The people who are on everything, by Jon's instruction. Verified Slack ids, 2026-08-19.
export const JON_SLACK_ID = 'U04G9B24ECT'
export const ROBERTO_SLACK_ID = 'U07FSK2BBG8'
export const KARLA_SLACK_ID = 'U0AFT9LM0RH'

const workHours = (approval: boolean): EventRule => ({
  enabled: true,
  approval,
  quietStart: 7 * 60,
  quietEnd: 20 * 60,
  cooldownMin: 180,
})

export const DEFAULT_RULES: SlackRules = {
  firehose: null,
  defaultChannel: null,
  buildings: {},
  supervisors: {},
  core: [JON_SLACK_ID, ROBERTO_SLACK_ID, KARLA_SLACK_ID],
  people: {},
  events: {
    late_cleans: workHours(true),
    glitches: workHours(true),
    overtime: workHours(true),
    // A dead feed is not a judgement call and waiting on a human defeats the point.
    sync: { enabled: true, approval: false, quietStart: 0, quietEnd: 24 * 60, cooldownMin: 360 },
    digest: { enabled: true, approval: false, quietStart: 6 * 60, quietEnd: 12 * 60, cooldownMin: 20 * 60 },
    personal_brief: { enabled: false, approval: false, quietStart: 6 * 60, quietEnd: 12 * 60, cooldownMin: 20 * 60 },
  },
  approvers: [JON_SLACK_ID],
  approvalExpiryMin: 240,
  overtimeHours: 9,
  tone: 'Warm, encouraging, on the team’s side. Name the situation plainly, then point at the next action. Never scold, never blame an individual, never imply someone is in trouble.',
}

const clampInt = (v: any, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

const strList = (v: any, cap: number): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  for (const raw of v.slice(0, cap)) {
    const s = String(raw || '').trim()
    if (!s || seen[s]) continue
    seen[s] = true
    out.push(s.slice(0, 40))
  }
  return out
}

const strMap = (v: any, cap: number): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of Object.keys(v).slice(0, cap)) {
    const key = String(k || '').trim().slice(0, 80)
    const val = String((v as any)[k] || '').trim().slice(0, 40)
    if (key && val) out[key] = val
  }
  return out
}

const listMap = (v: any, cap: number): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of Object.keys(v).slice(0, cap)) {
    const key = String(k || '').trim().slice(0, 80)
    const val = strList((v as any)[k], 20)
    if (key && val.length) out[key] = val
  }
  return out
}

function mergeRule(stored: any, dflt: EventRule): EventRule {
  if (!stored || typeof stored !== 'object') return { ...dflt }
  return {
    enabled: stored.enabled === undefined ? dflt.enabled : !!stored.enabled,
    approval: stored.approval === undefined ? dflt.approval : !!stored.approval,
    quietStart: clampInt(stored.quietStart, 0, 24 * 60, dflt.quietStart),
    quietEnd: clampInt(stored.quietEnd, 0, 24 * 60, dflt.quietEnd),
    cooldownMin: clampInt(stored.cooldownMin, 0, 7 * 24 * 60, dflt.cooldownMin),
  }
}

/** Normalise whatever is on disk into a complete, safe rule set. Never throws. */
export function mergeRules(stored: any): SlackRules {
  const d = DEFAULT_RULES
  if (!stored || typeof stored !== 'object') {
    return { ...d, core: d.core.slice(), approvers: d.approvers.slice(), events: { ...d.events } }
  }
  const events = {} as Record<EventKey, EventRule>
  const keys = Object.keys(d.events) as EventKey[]
  for (const k of keys) events[k] = mergeRule((stored.events || {})[k], d.events[k])
  const core = strList(stored.core, 30)
  return {
    firehose: stored.firehose ? String(stored.firehose).slice(0, 40) : null,
    defaultChannel: stored.defaultChannel ? String(stored.defaultChannel).slice(0, 40) : null,
    buildings: strMap(stored.buildings, 60),
    supervisors: listMap(stored.supervisors, 60),
    // Jon asked for these three on everything. If someone empties the list we put them back.
    core: core.length ? core : d.core.slice(),
    people: strMap(stored.people, 300),
    events,
    approvers: strList(stored.approvers, 20).length ? strList(stored.approvers, 20) : d.approvers.slice(),
    approvalExpiryMin: clampInt(stored.approvalExpiryMin, 15, 7 * 24 * 60, d.approvalExpiryMin),
    overtimeHours: clampInt(stored.overtimeHours, 4, 24, d.overtimeHours),
    tone: String(stored.tone || d.tone).slice(0, 600),
  }
}

export async function getSlackRules(): Promise<SlackRules> {
  return mergeRules(await getSetting<any>(RULES_KEY, null))
}

export async function saveSlackRules(next: any, actor: string): Promise<{ ok: boolean; error?: string; rules: SlackRules }> {
  const clean = mergeRules(next)
  const res = await setSetting(RULES_KEY, clean, actor)
  return { ok: res.ok, error: res.error, rules: clean }
}

// ── Resolution helpers ─────────────────────────────────────────────────────────────────────────

/** Where a building's alerts go. Falls back to the default channel, then the firehose. */
export function channelForBuilding(rules: SlackRules, building: string | null | undefined): string | null {
  const b = String(building || '').trim()
  if (b && rules.buildings[b]) return rules.buildings[b]
  return rules.defaultChannel || rules.firehose || null
}

/**
 * Everyone who should be tagged on an alert about `building` concerning `people`.
 * Order is deliberate: the people doing the work first, then their supervisor, then the core.
 */
export function audienceFor(
  rules: SlackRules,
  building: string | null | undefined,
  personIds: (string | null | undefined)[],
): string[] {
  const out: string[] = []
  const seen: Record<string, boolean> = {}
  const push = (id: string | null | undefined) => {
    const s = String(id || '').trim()
    if (!s || seen[s]) return
    seen[s] = true
    out.push(s)
  }
  for (const p of personIds) push(p)
  const b = String(building || '').trim()
  if (b && rules.supervisors[b]) for (const s of rules.supervisors[b]) push(s)
  for (const c of rules.core) push(c)
  return out
}

/**
 * Staff name -> Slack id. Manual overrides win; then exact email; then the same fuzzy matcher the
 * staffing check uses, which already bridges the married/maiden drift ("Shaany Espinoza" is
 * "Shaany Christian" in Slack). Returns null rather than guessing wrong.
 */
export function resolveSlackId(
  name: string | null | undefined,
  users: SlackUser[],
  rules: SlackRules,
): string | null {
  const raw = String(name || '').trim()
  if (!raw) return null
  const key = raw.toLowerCase()
  if (rules.people[key]) return rules.people[key]
  if (raw.indexOf('@') > 0) {
    const byEmail = users.find(u => (u.email || '').toLowerCase() === key)
    if (byEmail) return byEmail.id
  }
  for (const u of users) {
    if (u.name && nameMatches(u.name, raw)) return u.id
  }
  const roster = users.map(u => u.name).filter(Boolean)
  const hit = nameMatchesRoster(raw, roster)
  if (hit) {
    const u = users.find(x => x.name === hit)
    if (u) return u.id
  }
  return null
}

/** Convenience: resolve a batch of names in one directory read. */
export async function resolveMany(names: (string | null | undefined)[]): Promise<Record<string, string>> {
  const rules = await getSlackRules()
  const dir = await getDirectory()
  const out: Record<string, string> = {}
  for (const n of names) {
    const raw = String(n || '').trim()
    if (!raw || out[raw]) continue
    const id = resolveSlackId(raw, dir.users, rules)
    if (id) out[raw] = id
  }
  return out
}

/** Is `event` allowed to send right now, given its quiet hours? `nowMin` is minutes-of-day ET. */
export function withinWindow(rule: EventRule, nowMin: number): boolean {
  if (rule.quietStart === rule.quietEnd) return true
  if (rule.quietStart < rule.quietEnd) return nowMin >= rule.quietStart && nowMin <= rule.quietEnd
  // Window wraps midnight.
  return nowMin >= rule.quietStart || nowMin <= rule.quietEnd
}
