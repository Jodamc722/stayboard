// SLACK ALERT RULES — who hears what, and when. Editable from /users.
//
// Jon, 2026-08-19: "This should be editable in user settings, ect where we can set rules."
//
// THE ROUTING MODEL IS AREA × DEPARTMENT, NOT PER-BUILDING. Jon: "we have broward which will be
// all our broward units so HK broward, Broward maintenance ect, we have Miami same then you will
// have our vendor operated building like Botanica, PT, Capri Lucerne, etc."
//
// So a ROUTING GROUP owns a list of buildings and TWO channels — housekeeping and maintenance —
// because that is how his Slack is actually organised (#vr-broward-housekeeping is a different
// room from #vr-broward-maintenance, and 17West has its own pair). Late cleans are housekeeping
// work and go to the HK channel; a glitch routes on its own category, the same way the Breezeway
// push already decides which department gets the task. The cleaners never get pinged about an AC
// compressor, and the maintenance crew never gets pinged about a missed clean.
//
// VENDOR GROUPS tag `@here` instead of individuals (Jon's call) — those crews are not ours, they
// are mostly not in this Slack, and an @-mention that resolves to nobody is worse than useless.
import 'server-only'
import { getSetting, setSetting } from './app-settings'
import { getDirectory, type SlackUser } from './slack'
import { nameMatches, nameMatchesRoster } from './homebase'

export const RULES_KEY = 'slack_rules'

/** The alerts this system can send. Adding one here + a default rule is all it takes. */
export type EventKey =
  | 'late_cleans' | 'glitches' | 'overtime' | 'sync' | 'digest' | 'personal_brief'
  // added 2026-08-19 after reading 30 days of every ops channel — see [[reference-slack-channels]]
  | 'repeat_offenders' | 'door_codes' | 'blocked_arrival' | 'market_brief' | 'handover'
  | 'walk_in_risk'
  | 'readiness_3pm' | 'labor_report' | 'notable_arrivals'

export const EVENT_LABELS: Record<EventKey, string> = {
  late_cleans: 'Cleans running behind',
  glitches: 'Glitches & guest issues',
  overtime: 'Someone running over hours',
  sync: 'Sync failures (system)',
  digest: 'Morning ops digest',
  personal_brief: 'Personal morning brief (DM)',
  repeat_offenders: 'Same problem coming back',
  door_codes: 'Door code duplicates & gaps',
  blocked_arrival: 'Guest booked into a blocked unit',
  market_brief: 'Top priorities per market',
  handover: 'Nightly handover draft (leadership)',
  walk_in_risk: 'Could be a walk-in tonight',
  readiness_3pm: '3pm check — ready for 4pm?',
  labor_report: 'Hours, no-shows, over hours',
  notable_arrivals: 'Owner stays & big bookings',
}

/** The two rooms every area has. Safety issues ride with maintenance — there is no third channel. */
export type Dept = 'housekeeping' | 'maintenance'

/**
 * Which department owns a glitch, matching `deptFor` in app/api/glitches/action/route.ts so the
 * Slack routing and the Breezeway task always agree about whose job it is.
 */
export function deptForCategory(category: string | null | undefined): Dept {
  const c = String(category || '').toLowerCase()
  if (c.startsWith('cleanliness')) return 'housekeeping'
  return 'maintenance'
}

export type RoutingGroup = {
  id: string
  label: string
  /** canonical building labels from lib/segments */
  buildings: string[]
  housekeeping: string | null   // Slack channel id
  maintenance: string | null    // Slack channel id
  supervisors: string[]         // Slack user ids
  /** vendor-run: tag @here rather than naming people who are not in this workspace */
  vendor: boolean
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
  /** Used when a group has no channel for that department. */
  defaultChannel: string | null
  /** The short per-market priorities brief goes here. Jon: "in the VR ops channel". */
  opsChannel: string | null
  /** The nightly handover draft goes here for leadership to edit before it goes out. */
  leadershipChannel: string | null
  /** Tagged on the handover: Karla, Roberto, Silvia, Sulaman, Bernadette, Jon. */
  leadership: string[]
  /** Field-facing messages lead with Spanish, then English. */
  bilingualFieldChannels: boolean
  groups: RoutingGroup[]
  /** Always tagged on every alert, whatever the area. Jon + Roberto + Karla. */
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
  /** A reservation at or above this total counts as a "big booking" worth flagging. */
  bigBookingUsd: number
  /** Nights at or above this counts as a long stay. */
  longStayNights: number
  /** How far ahead the owner-stay / big-booking heads-up looks. */
  notableLookaheadDays: number
  /** Free-text steer folded into every generated message. */
  tone: string
}

// The people who are on everything, by Jon's instruction. Verified Slack ids, 2026-08-19.
export const JON_SLACK_ID = 'U04G9B24ECT'
export const ROBERTO_SLACK_ID = 'U07FSK2BBG8'
export const KARLA_SLACK_ID = 'U0AFT9LM0RH'
// The handover audience Jon named on 2026-08-19: "Send to her, Roberto, Silvia, Suluman,
// Bernadette and I in Leadership channel and we can then edit it as needed."
export const SILVIA_SLACK_ID = 'U0BQJQ0EYKT'
export const SULAMAN_SLACK_ID = 'U07PXLLK0LR'
export const BERNADETTE_SLACK_ID = 'U0A0MS29MNG'

// Jon's real channels, read off the workspace 2026-08-19. Seeded so this works on day one rather
// than shipping empty and routing nothing; every one of them is editable in the admin.
const CH = {
  brow_hk: 'C04BE7CL90W',      // #vr-broward-housekeeping (private — bot must be invited)
  brow_mt: 'C02S24UE1EZ',      // #vr-broward-maintenance  (private — bot must be invited)
  miami: 'C094TA92QGM',        // #vr-miami-hk-maintenance-arya-elser-district225
  w17_hk: 'C09PGAX5ARL',       // #vr-miami-houskeeping-17west (private — bot must be invited)
  w17_mt: 'C09T9T65VGU',       // #vr-maintenance-17west
  north: 'C08HW9XBZ8U',        // #vr-lakeworth-palmbeach-amri-capri-lucerne
  botanica: 'C0B8VTD0BFC',     // #vr-botanica
  parktower: 'C0AFLUUE8BH',    // #vr-parktower (private — bot must be invited)
}

/**
 * Buildings come from lib/segments KNOWN_BUILDINGS. Nomad and Miami House have no channel of
 * their own — the Miami room is the only sensible home, and Jon can move them in one dropdown.
 */
export const DEFAULT_GROUPS: RoutingGroup[] = [
  {
    id: '17west', label: '17West',
    buildings: ['17WEST'],
    housekeeping: CH.w17_hk, maintenance: CH.w17_mt,
    supervisors: [], vendor: false,
  },
  {
    id: 'miami', label: 'Miami',
    buildings: ['Arya', 'Elser', 'District 225', 'Nomad', 'Miami House'],
    housekeeping: CH.miami, maintenance: CH.miami,
    supervisors: [], vendor: false,
  },
  {
    id: 'broward', label: 'Broward',
    buildings: ['Eden', 'Rustic', 'Hendricks', 'Oasis', 'Waves', 'Pelican', 'Salato', '336 Arthur', '7071 SW', '906', '3316', '1587'],
    housekeeping: CH.brow_hk, maintenance: CH.brow_mt,
    supervisors: [], vendor: false,
  },
  {
    id: 'north', label: 'North — Capri / Lucerne / Amrit (vendor)',
    buildings: ['Capri', 'Lucerne', 'Amrit'],
    housekeeping: CH.north, maintenance: CH.north,
    supervisors: [], vendor: true,
  },
  {
    id: 'botanica', label: 'Botanica (vendor)',
    buildings: ['Botanica'],
    housekeeping: CH.botanica, maintenance: CH.botanica,
    supervisors: [], vendor: true,
  },
  {
    id: 'parktowers', label: 'Park Towers (vendor)',
    buildings: ['Park Towers'],
    housekeeping: CH.parktower, maintenance: CH.parktower,
    supervisors: [], vendor: true,
  },
]

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
  // #vr-ops-team-projects — low volume, already report-shaped, supervisors expect structure here.
  opsChannel: 'C083X66C17W',
  // Left unset on purpose: Jon said "Leadership channel" and the only match in the workspace is
  // #vr-jjleadership, which reads like the vendor's leadership room rather than Stay's. Pick it
  // in the admin and invite the bot; until then the handover holds rather than going somewhere wrong.
  leadershipChannel: null,
  leadership: [KARLA_SLACK_ID, ROBERTO_SLACK_ID, SILVIA_SLACK_ID, SULAMAN_SLACK_ID, BERNADETTE_SLACK_ID, JON_SLACK_ID],
  bilingualFieldChannels: true,
  groups: DEFAULT_GROUPS,
  core: [JON_SLACK_ID, ROBERTO_SLACK_ID, KARLA_SLACK_ID],
  people: {},
  events: {
    // superseded by readiness_3pm — the same information at the only hour it changes anything.
    late_cleans: { ...workHours(true), enabled: false },
    glitches: { ...workHours(true), enabled: false },
    // folded into labor_report, which says the same thing with the rest of the payroll picture.
    overtime: { ...workHours(true), enabled: false },
    // A dead feed is not a judgement call and waiting on a human defeats the point.
    sync: { enabled: true, approval: false, quietStart: 0, quietEnd: 24 * 60, cooldownMin: 360 },
    digest: { enabled: false, approval: false, quietStart: 6 * 60, quietEnd: 12 * 60, cooldownMin: 20 * 60 },
    personal_brief: { enabled: false, approval: false, quietStart: 6 * 60, quietEnd: 12 * 60, cooldownMin: 20 * 60 },
    // Once a day is plenty — a repeat is a week-old pattern, not breaking news.
    repeat_offenders: { enabled: false, approval: true, quietStart: 8 * 60, quietEnd: 18 * 60, cooldownMin: 20 * 60 },
    // Codes matter before check-in, so this one is allowed to speak early.
    door_codes: { enabled: false, approval: true, quietStart: 7 * 60, quietEnd: 20 * 60, cooldownMin: 12 * 60 },
    // The one alert that should never wait: a guest is already booked into a dead unit.
    blocked_arrival: { enabled: false, approval: true, quietStart: 7 * 60, quietEnd: 21 * 60, cooldownMin: 6 * 60 },
    // approval:true since 2026-08-19 — the first auto-sent version was unusable ("so bad... no
    // clarity or detail") and went out before anyone could stop it. Flip it off in settings once
    // the wording has earned trust.
    market_brief: { enabled: false, approval: true, quietStart: 6 * 60, quietEnd: 12 * 60, cooldownMin: 20 * 60 },
    // Written in the evening for the next day, like the human version it replaces.
    handover: { enabled: true, approval: true, quietStart: 16 * 60, quietEnd: 23 * 60, cooldownMin: 20 * 60 },
    // NO APPROVAL, and a short cooldown so it re-raises while the problem is still unfixed. Jon
    // asked for anything that could cause a walk-in to be stated as it is caught — a guest who
    // cannot get in tonight will not wait for someone to click approve. It re-checks all day and
    // goes quiet the moment the unit is clear.
    walk_in_risk: { enabled: false, approval: false, quietStart: 7 * 60, quietEnd: 21 * 60, cooldownMin: 90 },
    // THE 3PM CHECK. One narrow window on purpose: at 15:00 every arrival either has a finished
    // clean or it does not, and there is still an hour to act. Before 3pm it is noise, after 4pm it
    // is too late. Auto-sends — an hour of warning is the entire value.
    readiness_3pm: { enabled: true, approval: false, quietStart: 15 * 60, quietEnd: 15 * 60 + 45, cooldownMin: 20 * 60 },
    // Hours late in the afternoon, when "over hours" and "never showed" are both answerable.
    labor_report: { enabled: true, approval: false, quietStart: 17 * 60, quietEnd: 18 * 60, cooldownMin: 20 * 60 },
    // A heads-up, so it goes out with the morning rather than interrupting the day.
    notable_arrivals: { enabled: true, approval: false, quietStart: 8 * 60, quietEnd: 11 * 60, cooldownMin: 20 * 60 },
  },
  approvers: [JON_SLACK_ID],
  approvalExpiryMin: 240,
  overtimeHours: 9,
  bigBookingUsd: 3000,
  longStayNights: 14,
  notableLookaheadDays: 7,
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
    out.push(s.slice(0, 80))
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

const chan = (v: any): string | null => {
  const s = String(v || '').trim().slice(0, 40)
  return s || null
}

function mergeGroup(stored: any, index: number): RoutingGroup | null {
  if (!stored || typeof stored !== 'object') return null
  const label = String(stored.label || '').trim().slice(0, 80)
  if (!label) return null
  return {
    id: String(stored.id || 'group' + index).trim().slice(0, 40) || 'group' + index,
    label,
    buildings: strList(stored.buildings, 60),
    housekeeping: chan(stored.housekeeping),
    maintenance: chan(stored.maintenance),
    supervisors: strList(stored.supervisors, 20),
    vendor: !!stored.vendor,
  }
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
    return { ...d, core: d.core.slice(), approvers: d.approvers.slice(), leadership: d.leadership.slice(), groups: d.groups.map(g => ({ ...g })), events: { ...d.events } }
  }
  const events = {} as Record<EventKey, EventRule>
  const keys = Object.keys(d.events) as EventKey[]
  for (const k of keys) events[k] = mergeRule((stored.events || {})[k], d.events[k])

  const rawGroups = Array.isArray(stored.groups) ? stored.groups.slice(0, 40) : []
  const groups = rawGroups.map(mergeGroup).filter(Boolean) as RoutingGroup[]

  const core = strList(stored.core, 30)
  const approvers = strList(stored.approvers, 20)
  const leadership = strList(stored.leadership, 30)
  return {
    firehose: chan(stored.firehose),
    defaultChannel: chan(stored.defaultChannel),
    opsChannel: stored.opsChannel === undefined ? d.opsChannel : chan(stored.opsChannel),
    leadershipChannel: chan(stored.leadershipChannel),
    leadership: leadership.length ? leadership : d.leadership.slice(),
    bilingualFieldChannels: stored.bilingualFieldChannels === undefined ? d.bilingualFieldChannels : !!stored.bilingualFieldChannels,
    // Never leave the app with nowhere to route: an empty list falls back to the seeded areas.
    groups: groups.length ? groups : d.groups.map(g => ({ ...g })),
    // Jon asked for these three on everything. If someone empties the list we put them back.
    core: core.length ? core : d.core.slice(),
    people: strMap(stored.people, 300),
    events,
    approvers: approvers.length ? approvers : d.approvers.slice(),
    approvalExpiryMin: clampInt(stored.approvalExpiryMin, 15, 7 * 24 * 60, d.approvalExpiryMin),
    overtimeHours: clampInt(stored.overtimeHours, 4, 24, d.overtimeHours),
    bigBookingUsd: clampInt(stored.bigBookingUsd, 0, 1000000, d.bigBookingUsd),
    longStayNights: clampInt(stored.longStayNights, 2, 365, d.longStayNights),
    notableLookaheadDays: clampInt(stored.notableLookaheadDays, 1, 30, d.notableLookaheadDays),
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

// ── Resolution ─────────────────────────────────────────────────────────────────────────────────

/** Which area owns this building. Null when nothing claims it — those fall through to the firehose. */
export function groupForBuilding(rules: SlackRules, building: string | null | undefined): RoutingGroup | null {
  const b = String(building || '').trim()
  if (!b) return null
  for (const g of rules.groups) {
    if (g.buildings.indexOf(b) >= 0) return g
  }
  return null
}

/** The room this piece of work belongs in. Falls back to the group's other room, then defaults. */
export function channelFor(rules: SlackRules, group: RoutingGroup | null, dept: Dept): string | null {
  if (group) {
    const primary = dept === 'housekeeping' ? group.housekeeping : group.maintenance
    const other = dept === 'housekeeping' ? group.maintenance : group.housekeeping
    if (primary) return primary
    if (other) return other
  }
  return rules.defaultChannel || rules.firehose || null
}

/**
 * Everyone tagged on an alert. Order is deliberate: the people doing the work, then the area's
 * supervisor, then the core three. A VENDOR group contributes no individuals — the message uses
 * @here instead, because those crews are not in this workspace.
 */
export function audienceFor(
  rules: SlackRules,
  group: RoutingGroup | null,
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
  if (!group || !group.vendor) for (const p of personIds) push(p)
  if (group) for (const s of group.supervisors) push(s)
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
