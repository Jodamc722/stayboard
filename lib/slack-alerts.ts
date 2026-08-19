// THE ALERTS. Each function gathers a situation, groups it by building, writes ONE encouraging
// message per group, and hands it to the outbox. None of them post to Slack directly — that is
// the outbox's job, after a human has approved (Jon's rule, 2026-08-19).
//
// GROUPING IS THE WHOLE POINT. Jon: "if multiple cleans pending, or glitches it should group them
// ect and tag all parties". So the shape of every function here is the same:
//
//     load rows  ->  bucket by building  ->  resolve each person to a Slack id
//                ->  ONE draft per building, tagging everyone at once
//
// A building with nothing wrong produces no message at all. Silence is a feature.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf } from './segments'
import { getDirectory } from './slack'
import { getTimecards } from './homebase-labor'
import { loadBehind } from './ops-behind'
import { draft } from './slack-queue'
import {
  getSlackRules, channelForBuilding, audienceFor, resolveSlackId, type SlackRules,
} from './slack-rules'
import {
  lateCleansMessage, glitchesMessage, overtimeMessage, digestMessage,
  syncProblemMessage, syncRecoveredMessage,
  type LateCleanItem, type GlitchItem, type LongShift,
} from './slack-messages'

/** Today in ET, YYYY-MM-DD. Everything operational in this app is anchored to Eastern. */
export function etDate(d?: Date): string {
  const dt = d || new Date()
  const s = dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return String(s).slice(0, 10)
}

type Ctx = { rules: SlackRules; users: Awaited<ReturnType<typeof getDirectory>>['users'] }

async function ctx(): Promise<Ctx> {
  const rules = await getSlackRules()
  const dir = await getDirectory()
  return { rules, users: dir.users }
}

/** Bucket anything that knows its building. Returns a plain object so the tsconfig stays happy. */
function byBuilding<T>(rows: T[], keyOf: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const r of rows) {
    const k = keyOf(r) || 'Unassigned'
    if (!out[k]) out[k] = []
    out[k].push(r)
  }
  return out
}

// ── 1. Cleans running behind ───────────────────────────────────────────────────────────────────

/**
 * Reuses `loadBehind()` so the Slack alert and the Today-in-Ops board can never disagree about
 * what "behind" means. BehindRow carries no building, so we re-derive it from the unit name —
 * `buildingOf` matches against the name, which is exactly what a nickname string is.
 */
export async function runLateCleanAlert(): Promise<any> {
  const { rules, users } = await ctx()
  const rule = rules.events.late_cleans
  if (!rule.enabled) return { skipped: 'disabled' }

  const b = await loadBehind()
  if (!b.units.length) return { skipped: 'nothing behind', waiting: b.waiting }

  const groups = byBuilding(b.units, u => buildingOf(null, u.unit) || 'Unassigned')
  const results: any[] = []

  for (const building of Object.keys(groups)) {
    const rows = groups[building]
    const items: LateCleanItem[] = rows.map(r => ({
      unit: r.unit,
      assignee: r.assignee,
      assigneeSlackId: resolveSlackId(r.assignee, users, rules),
      arrivingAt: r.arrivingAt,
      checkOutTime: r.checkOutTime,
    }))
    const audience = audienceFor(rules, building, items.map(i => i.assigneeSlackId))
    const { body, summary } = lateCleansMessage({ building, items, audience, date: b.date })
    const res = await draft({
      eventKey: 'late_cleans',
      groupKey: 'late_cleans:' + building + ':' + b.date,
      building,
      channelId: channelForBuilding(rules, building),
      body, summary, audience,
      itemCount: items.length,
    }, rules)
    results.push({ building, count: items.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 2. Glitches / guest issues ─────────────────────────────────────────────────────────────────

const CLOSED_STATUSES = ['closed', 'done', 'resolved']

export async function runGlitchAlert(): Promise<any> {
  const { rules, users } = await ctx()
  const rule = rules.events.glitches
  if (!rule.enabled) return { skipped: 'disabled' }

  const today = etDate()
  const db = supabaseAdmin()
  const { data, error } = await db.from('glitches')
    .select('id, unit, overview, category, status, due_date, assignee, created_at')
    .not('status', 'in', '("' + CLOSED_STATUSES.join('","') + '")')
    .order('created_at', { ascending: true })
    .limit(300)
  if (error) return { error: error.message }
  const rows = (data || []) as any[]
  if (!rows.length) return { skipped: 'no open issues' }

  const groups = byBuilding(rows, r => buildingOf(null, String(r.unit || '')) || 'Unassigned')
  const results: any[] = []

  for (const building of Object.keys(groups)) {
    const rs = groups[building]
    const items: GlitchItem[] = rs.map(r => {
      const created = r.created_at ? Date.parse(r.created_at) : 0
      const ageDays = created ? Math.floor((Date.now() - created) / 86_400_000) : null
      return {
        unit: String(r.unit || 'Unit'),
        issue: String(r.overview || r.category || 'Open issue').replace(/\s+/g, ' ').trim(),
        ageDays,
        assignee: r.assignee ? String(r.assignee) : null,
        assigneeSlackId: resolveSlackId(r.assignee, users, rules),
        overdue: !!(r.due_date && String(r.due_date) < today),
      }
    })
    // Only speak up when something is actually aging — a fresh board needs no nudge.
    const worth = items.filter(i => i.overdue || (i.ageDays != null && i.ageDays >= 2))
    if (!worth.length) { results.push({ building, skipped: 'all fresh' }); continue }

    const audience = audienceFor(rules, building, worth.map(i => i.assigneeSlackId))
    const { body, summary } = glitchesMessage({ building, items: worth, audience, date: today })
    const res = await draft({
      eventKey: 'glitches',
      groupKey: 'glitches:' + building + ':' + today,
      building,
      channelId: channelForBuilding(rules, building),
      body, summary, audience,
      itemCount: worth.length,
    }, rules)
    results.push({ building, count: worth.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 3. Running over hours ──────────────────────────────────────────────────────────────────────

/**
 * NOTE the date guard. `t.open` alone means "no clock-out recorded", which is also true of a card
 * someone forgot to close three weeks ago — /api/ops-today/staffing has that bug. Anchoring on
 * today's date is what makes this "still on the clock right now".
 */
export async function runOvertimeAlert(): Promise<any> {
  const { rules, users } = await ctx()
  const rule = rules.events.overtime
  if (!rule.enabled) return { skipped: 'disabled' }

  const today = etDate()
  let cards: Awaited<ReturnType<typeof getTimecards>> = []
  try { cards = await getTimecards(today, today) } catch (e: any) { return { error: String(e && e.message) } }

  const over = cards.filter(t => t.open && t.date === today && (t.hours || 0) >= rules.overtimeHours)
  if (!over.length) return { skipped: 'nobody over the threshold', threshold: rules.overtimeHours }

  const items: LongShift[] = over.map(t => ({
    name: t.name,
    slackId: resolveSlackId(t.name, users, rules),
    hours: Number(t.hours || 0),
    clockIn: t.clockIn ? new Date(t.clockIn).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : null,
  }))

  // Jon's DM policy: supervisors first, the person tagged rather than DM'd about a problem.
  const audience = audienceFor(rules, null, items.map(i => i.slackId))
  const { body, summary } = overtimeMessage({ items, audience, threshold: rules.overtimeHours, date: today })
  const res = await draft({
    eventKey: 'overtime',
    groupKey: 'overtime:' + today,
    building: null,
    channelId: rules.defaultChannel || rules.firehose,
    dmUserIds: rules.core,
    body, summary, audience,
    itemCount: items.length,
  }, rules)
  return { count: items.length, ...res }
}

// ── 4. Sync health — auto-sends, no approval ───────────────────────────────────────────────────

export async function runSyncAlert(alerts: string[], recovered: string[]): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.sync.enabled) return { skipped: 'disabled' }
  const today = etDate()
  if (alerts.length) {
    return draft({
      eventKey: 'sync',
      groupKey: 'sync:problem:' + alerts.join('|').slice(0, 80) + ':' + today,
      channelId: rules.defaultChannel || rules.firehose,
      body: syncProblemMessage(alerts),
      summary: alerts.length + ' feed(s) stale',
      itemCount: alerts.length,
    }, rules)
  }
  if (recovered.length) {
    return draft({
      eventKey: 'sync',
      groupKey: 'sync:recovered:' + recovered.join('|').slice(0, 80) + ':' + today,
      channelId: rules.defaultChannel || rules.firehose,
      body: syncRecoveredMessage(recovered),
      summary: recovered.length + ' feed(s) back',
      itemCount: recovered.length,
    }, rules)
  }
  return { skipped: 'nothing to say' }
}

// ── 5. Morning digest ──────────────────────────────────────────────────────────────────────────

export async function runDigest(): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.digest.enabled) return { skipped: 'disabled' }
  const today = etDate()
  const db = supabaseAdmin()

  const behind = await loadBehind().catch(() => null)
  const [glitchOpen, glitchOverdue, arrivals, expired] = await Promise.all([
    db.from('glitches').select('id', { count: 'exact', head: true })
      .not('status', 'in', '("' + CLOSED_STATUSES.join('","') + '")'),
    db.from('glitches').select('id', { count: 'exact', head: true })
      .not('status', 'in', '("' + CLOSED_STATUSES.join('","') + '")').lt('due_date', today),
    db.from('guesty_reservations').select('listing_id', { count: 'exact', head: true }).eq('check_in', today),
    db.from('slack_outbox').select('id', { count: 'exact', head: true })
      .eq('status', 'expired').gte('created_at', new Date(Date.now() - 36 * 3600_000).toISOString()),
  ])

  let clockedIn = 0
  try {
    const cards = await getTimecards(today, today)
    clockedIn = cards.filter(t => t.open && t.date === today).length
  } catch { /* Homebase is optional for the digest */ }

  const stats = {
    date: today,
    turnovers: behind ? behind.units.length + behind.waiting : 0,
    arrivals: arrivals.count || 0,
    unassignedCleans: behind ? behind.unassigned : 0,
    openGlitches: glitchOpen.count || 0,
    overdueGlitches: glitchOverdue.count || 0,
    clockedIn,
    expiredYesterday: expired.count || 0,
  }

  const audience = rules.core
  const { body, summary } = digestMessage(stats, audience)
  return draft({
    eventKey: 'digest',
    groupKey: 'digest:' + today,
    channelId: rules.defaultChannel || rules.firehose,
    body, summary, audience,
    itemCount: 1,
  }, rules)
}
