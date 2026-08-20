// THE ALERTS. Each function gathers a situation, groups it by ROUTING AREA (and for glitches, by
// department), writes ONE encouraging message per group, and hands it to the outbox. None of them
// post to Slack directly — that is the outbox's job, after a human has approved.
//
// GROUPING IS THE WHOLE POINT. Jon: "if multiple cleans pending, or glitches it should group them
// ect and tag all parties". And the areas are his, not invented: "we have broward which will be
// all our broward units so HK broward, Broward maintenance ect, we have Miami same then you will
// have our vendor operated building like Botanica, PT, Capri Lucerne, etc."
//
// So the shape of every function here is:
//
//     load rows  ->  bucket by (area × department)  ->  resolve each person to a Slack id
//                ->  ONE draft per bucket, into that department's channel, tagging everyone
//
// A bucket with nothing wrong produces no message at all. Silence is a feature.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { buildingOf } from './segments'
import { getDirectory } from './slack'
import { getTimecards } from './homebase-labor'
import { loadBehind } from './ops-behind'
import { draft } from './slack-queue'
import {
  getSlackRules, groupForBuilding, channelFor, audienceFor, resolveSlackId, deptForCategory,
  type SlackRules, type RoutingGroup, type Dept,
} from './slack-rules'
import {
  lateCleansMessage, glitchesMessage, overtimeMessage, digestMessage,
  syncProblemMessage, syncRecoveredMessage,
  lateCleansSpanish, glitchesSpanish,
  repeatOffendersMessage, codeProblemsMessage, blockedArrivalsMessage,
  marketBriefMessage, handoverMessage, walkInRiskMessage,
  readinessMessage, laborMessage, notableArrivalsMessage,
  type LateCleanItem, type GlitchItem, type LongShift,
} from './slack-messages'
import {
  findRepeatOffenders, findCodeProblems, findBlockedArrivals, marketPriorities, tomorrowByArea,
  findWalkInRisks, checkReadiness, laborSnapshot, findNotableArrivals,
} from './slack-signals'

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

/** A bucket of work that shares one message: one area, one department. */
type Bucket<T> = { key: string; label: string; group: RoutingGroup | null; dept: Dept; rows: T[] }

/**
 * Sort rows into (area × department) buckets. A unit whose building no area claims still gets a
 * bucket — it routes to the fallback channel rather than vanishing, because a silent drop is how
 * you end up trusting a board that is quietly missing work.
 */
function bucketBy<T>(
  rules: SlackRules,
  rows: T[],
  unitOf: (row: T) => string,
  deptOf: (row: T) => Dept,
): Bucket<T>[] {
  const map: Record<string, Bucket<T>> = {}
  for (const r of rows) {
    const building = buildingOf(null, unitOf(r))
    const group = groupForBuilding(rules, building)
    const dept = deptOf(r)
    const label = group ? group.label : (building || 'Unassigned')
    const key = (group ? group.id : 'unassigned:' + label) + ':' + dept
    if (!map[key]) map[key] = { key, label, group, dept, rows: [] }
    map[key].rows.push(r)
  }
  return Object.keys(map).map(k => map[k])
}

// ── 1. Cleans running behind ───────────────────────────────────────────────────────────────────

/**
 * Reuses `loadBehind()` so the Slack alert and the Today-in-Ops board can never disagree about
 * what "behind" means. Always housekeeping — a clean that has not started is not a maintenance
 * problem, and the maintenance channel should never see it.
 */
export async function runLateCleanAlert(): Promise<any> {
  const { rules, users } = await ctx()
  const rule = rules.events.late_cleans
  if (!rule.enabled) return { skipped: 'disabled' }

  const b = await loadBehind()
  if (!b.units.length) return { skipped: 'nothing behind', waiting: b.waiting }

  const buckets = bucketBy(rules, b.units, u => u.unit, () => 'housekeeping' as Dept)
  const results: any[] = []

  for (const bucket of buckets) {
    const items: LateCleanItem[] = bucket.rows.map(r => ({
      unit: r.unit,
      assignee: r.assignee,
      assigneeSlackId: resolveSlackId(r.assignee, users, rules),
      arrivingAt: r.arrivingAt,
      checkOutTime: r.checkOutTime,
    }))
    const vendor = !!(bucket.group && bucket.group.vendor)
    const audience = audienceFor(rules, bucket.group, items.map(i => i.assigneeSlackId))
    // @here on EVERY clean message, not just vendor areas (Jon, 2026-08-20: "The slack messages
    // needs to tag @Here + the housekeeper") — the assigned cleaners are already in `audience`.
    const { body: en, summary } = lateCleansMessage({
      area: bucket.label, items, audience, date: b.date, here: true,
    })
    // Field crews are Spanish-first (Jon, 2026-08-19). Vendor areas stay English — those are
    // outside companies with their own office staff, not our crews.
    const body = (rules.bilingualFieldChannels && !vendor ? lateCleansSpanish(bucket.label, items) : '') + en
    const res = await draft({
      eventKey: 'late_cleans',
      groupKey: 'late_cleans:' + bucket.key + ':' + b.date,
      building: bucket.label,
      channelId: channelFor(rules, bucket.group, 'housekeeping'),
      body, summary, audience,
      itemCount: items.length,
    }, rules)
    results.push({ area: bucket.label, count: items.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 2. Glitches / guest issues ─────────────────────────────────────────────────────────────────

const CLOSED_STATUSES = ['closed', 'done', 'resolved']

/**
 * Routes each issue on its own category, matching the Breezeway task department exactly: a
 * cleanliness complaint reaches housekeeping, everything else reaches maintenance. That means an
 * area can produce two messages — but each one goes to the people who can actually fix it, which
 * is the opposite of spam.
 */
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

  const buckets = bucketBy(rules, rows, r => String(r.unit || ''), r => deptForCategory(r.category))
  const results: any[] = []

  for (const bucket of buckets) {
    const items: GlitchItem[] = bucket.rows.map(r => {
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
    if (!worth.length) { results.push({ area: bucket.label, dept: bucket.dept, skipped: 'all fresh' }); continue }

    const vendor = !!(bucket.group && bucket.group.vendor)
    const audience = audienceFor(rules, bucket.group, worth.map(i => i.assigneeSlackId))
    const label = bucket.label + (bucket.dept === 'housekeeping' ? ' · housekeeping' : ' · maintenance')
    const { body: en, summary } = glitchesMessage({
      area: label, items: worth, audience, date: today, here: vendor,
    })
    const body = (rules.bilingualFieldChannels && !vendor ? glitchesSpanish(label, worth) : '') + en
    const res = await draft({
      eventKey: 'glitches',
      groupKey: 'glitches:' + bucket.key + ':' + today,
      building: bucket.label,
      channelId: channelFor(rules, bucket.group, bucket.dept),
      body, summary, audience,
      itemCount: worth.length,
    }, rules)
    results.push({ area: bucket.label, dept: bucket.dept, count: worth.length, ...res })
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

  // Jon's DM policy: supervisors first, the person tagged rather than DM'd about a problem. This
  // one is not area-scoped — it is about people, and someone can work across buildings in a day.
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

// ── 6. The same problem coming back ────────────────────────────────────────────────────────────

/**
 * Arya 2004/2 A/C: closed as fixed on the 13th, reopened the 14th, reopened the 15th. Nobody
 * linked them — it surfaced because Jon remembered. This is that memory, automated.
 */
export async function runRepeatOffenderAlert(windowDays = 14): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.repeat_offenders.enabled) return { skipped: 'disabled' }
  const items = await findRepeatOffenders(windowDays)
  if (!items.length) return { skipped: 'nothing repeating' }

  const today = etDate()
  const buckets = bucketBy(rules, items, i => i.unit, () => 'maintenance' as Dept)
  const results: any[] = []
  for (const bucket of buckets) {
    const audience = audienceFor(rules, bucket.group, [])
    const { body, summary } = repeatOffendersMessage({
      items: bucket.rows.map(r => ({
        unit: r.unit, category: r.category, count: r.count,
        closedBefore: r.closedBefore, firstSeen: r.firstSeen, lastSeen: r.lastSeen,
        latestIssue: r.latestIssue,
      })),
      audience, windowDays,
    })
    const res = await draft({
      eventKey: 'repeat_offenders',
      groupKey: 'repeat:' + bucket.key + ':' + today,
      building: bucket.label,
      channelId: channelFor(rules, bucket.group, 'maintenance'),
      body, summary, audience, itemCount: bucket.rows.length,
    }, rules)
    results.push({ area: bucket.label, count: bucket.rows.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 7. Door codes ──────────────────────────────────────────────────────────────────────────────

export async function runDoorCodeAlert(): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.door_codes.enabled) return { skipped: 'disabled' }
  const problems = await findCodeProblems(2)
  if (!problems.length) return { skipped: 'codes look fine' }

  const duplicates = problems.map(p => ({ code: p.code, units: p.units }))
  if (!duplicates.length) return { skipped: 'no duplicate codes' }

  const today = etDate()
  const audience = audienceFor(rules, null, [])
  const { body, summary } = codeProblemsMessage({ duplicates, audience })
  // Codes are issued centrally by CCS, not per area — so this goes to one place, not per building.
  return draft({
    eventKey: 'door_codes',
    groupKey: 'codes:' + today,
    channelId: rules.opsChannel || rules.defaultChannel || rules.firehose,
    body, summary, audience,
    itemCount: duplicates.length,
  }, rules)
}

// ── 8. Guest booked into a blocked unit ────────────────────────────────────────────────────────

export async function runBlockedArrivalAlert(lookaheadDays = 5): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.blocked_arrival.enabled) return { skipped: 'disabled' }
  const items = await findBlockedArrivals(lookaheadDays)
  if (!items.length) return { skipped: 'no arrivals into blocked units' }

  const today = etDate()
  const buckets = bucketBy(rules, items, i => i.unit, () => 'maintenance' as Dept)
  const results: any[] = []
  for (const bucket of buckets) {
    const audience = audienceFor(rules, bucket.group, [])
    const { body, summary } = blockedArrivalsMessage({
      items: bucket.rows.map(r => ({
        unit: r.unit, checkIn: r.checkIn, daysAway: r.daysAway,
        reason: r.reason, openEnded: r.openEnded, blockedTo: r.blockedTo,
      })),
      audience,
    })
    const res = await draft({
      eventKey: 'blocked_arrival',
      groupKey: 'blocked:' + bucket.key + ':' + today,
      building: bucket.label,
      channelId: channelFor(rules, bucket.group, 'maintenance'),
      body, summary, audience, itemCount: bucket.rows.length,
    }, rules)
    results.push({ area: bucket.label, count: bucket.rows.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 9. Top priorities per market ───────────────────────────────────────────────────────────────

/** Jon: "a general brief in the VR ops channel, short and to the point, top priorities per market." */
export async function runMarketBrief(): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.market_brief.enabled) return { skipped: 'disabled' }
  const markets = await marketPriorities()
  if (!markets.length) return { skipped: 'no markets with work' }

  const today = etDate()
  const audience = rules.core
  const { body, summary } = marketBriefMessage({
    markets: markets.map(m => ({
      market: m.market, cleans: m.cleans, arrivals: m.arrivals,
      blocked: m.blocked, lateWithArrival: m.lateWithArrival,
      lateNoArrival: m.lateNoArrival, unassigned: m.unassigned, overdue: m.overdue,
    })),
    date: today, audience,
    boardUrl: (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '') + '/plan',
  })
  return draft({
    eventKey: 'market_brief',
    groupKey: 'marketbrief:' + today,
    channelId: rules.opsChannel || rules.defaultChannel || rules.firehose,
    body, summary, audience, itemCount: markets.length,
  }, rules)
}

// ── 10. Nightly handover draft ─────────────────────────────────────────────────────────────────

/**
 * Karla writes this by hand every night. Jon asked for it to go to leadership so they can edit it
 * before it goes out — so it is explicitly labelled a draft and holds if no leadership channel is
 * set rather than guessing which room "Leadership" means.
 */
export async function runHandover(): Promise<any> {
  const rules = await getSlackRules()
  if (!rules.events.handover.enabled) return { skipped: 'disabled' }
  if (!rules.leadershipChannel) {
    return { skipped: 'no leadership channel set — pick one in /users then invite the bot' }
  }
  const { date, areas } = await tomorrowByArea()
  if (!areas.length) return { skipped: 'nothing on the board for tomorrow' }

  const audience = rules.leadership
  const { body, summary } = handoverMessage({
    date,
    areas: areas.map(a => ({
      area: a.area, cleans: a.cleans, arrivals: a.arrivals,
      departures: a.departures, sameDayTurns: a.sameDayTurns, openIssues: a.openIssues,
    })),
    audience,
  })
  return draft({
    eventKey: 'handover',
    groupKey: 'handover:' + date,
    channelId: rules.leadershipChannel,
    body, summary, audience, itemCount: areas.length,
  }, rules)
}

// ── 11. Walk-in risk — runs all day, never waits ───────────────────────────────────────────────

/**
 * Jon, 2026-08-19: "Anything that it catches throughout the day that might be urgent or to prevent
 * a walkin, it should state." So this one skips the approval queue by default and re-checks every
 * pass: a guest arriving tonight into a unit that is blocked, uncleaned, or has no working code.
 */
export async function runWalkInRiskAlert(): Promise<any> {
  const { rules, users } = await ctx()
  const rule = rules.events.walk_in_risk
  if (!rule.enabled) return { skipped: 'disabled' }

  const risks = await findWalkInRisks()
  if (!risks.length) return { skipped: 'no arrivals at risk' }

  const today = etDate()
  const buckets = bucketBy(rules, risks, r => r.unit, () => 'housekeeping' as Dept)
  const results: any[] = []
  for (const bucket of buckets) {
    // Tag @here + the cleaners on the scheduled cleans (Jon, 2026-08-20: "tag @Here + the
    // housekeeper... the cleaners that are scheduled for the clean"). audienceFor still drops
    // personal ids for vendor areas — those crews are not in this workspace.
    const audience = audienceFor(rules, bucket.group,
      bucket.rows.flatMap(r => (r.assignees || []).map(n => resolveSlackId(n, users, rules))))
    const { body, summary } = walkInRiskMessage({
      items: bucket.rows.map(r => ({ unit: r.unit, at: r.at, problems: r.problems, unassigned: r.unassigned })),
      audience, here: true,
    })
    // The group key carries the unit list, so a NEW unit going at-risk raises a fresh message
    // rather than silently updating one nobody looked at again.
    const sig = bucket.rows.map(r => r.unit).sort().join('|').slice(0, 90)
    const res = await draft({
      eventKey: 'walk_in_risk',
      groupKey: 'walkin:' + bucket.key + ':' + today + ':' + sig,
      building: bucket.label,
      channelId: channelFor(rules, bucket.group, 'housekeeping'),
      body, summary, audience, itemCount: bucket.rows.length,
    }, rules)
    results.push({ area: bucket.label, count: bucket.rows.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 12. THE 3PM CHECK ──────────────────────────────────────────────────────────────────────────

/**
 * Jon, 2026-08-19: "it should just be based on status cleans at 3pm to make sure units are ready at
 * 4pm." One message per area, into the housekeeping channel, at 3pm — and it sends even when
 * everything is ready, because "all ready" at 3pm is genuinely the news.
 */
export async function runReadinessCheck(): Promise<any> {
  const { rules, users } = await ctx()
  const rule = rules.events.readiness_3pm
  if (!rule.enabled) return { skipped: 'disabled' }

  const { date, units } = await checkReadiness()
  if (!units.length) return { skipped: 'no arrivals today' }

  const buckets = bucketBy(rules, units, u => u.unit, () => 'housekeeping' as Dept)
  const results: any[] = []
  for (const bucket of buckets) {
    const vendor = !!(bucket.group && bucket.group.vendor)
    // Vendor buildings do not put cleans on our Breezeway board (Botanica runs off Guesty alone),
    // so every unit there reads as "no clean scheduled" — seven of them did on the first run.
    // We cannot see their readiness, so we do not claim to.
    if (vendor) { results.push({ area: bucket.label, skipped: 'vendor-run — no clean data' }); continue }
    // @here + the cleaners named on today's cleans (Jon, 2026-08-20: "tag @Here + the
    // housekeeper... the cleaners that are scheduled for the clean").
    const audience = audienceFor(rules, bucket.group,
      bucket.rows.flatMap(u => (u.assignees || []).map(n => resolveSlackId(n, users, rules))))
    const { body, threadBody, summary } = readinessMessage({
      area: bucket.label,
      items: bucket.rows.map(u => ({
        unit: u.unit, at: u.at, status: u.status, assignees: u.assignees, startedAt: u.startedAt,
        guest: u.guest, nights: u.nights, outGuest: u.outGuest, outAt: u.outAt,
        flags: u.flags, task: u.task,
      })),
      audience,
      spanish: rules.bilingualFieldChannels,
      here: true,
    })
    const res = await draft({
      eventKey: 'readiness_3pm',
      groupKey: 'ready3pm:' + bucket.key + ':' + date,
      building: bucket.label,
      channelId: channelFor(rules, bucket.group, 'housekeeping'),
      body, threadBody, summary, audience, itemCount: bucket.rows.length,
    }, rules)
    results.push({ area: bucket.label, count: bucket.rows.length, ...res })
  }
  return { ok: true, groups: results.length, results }
}

// ── 13. HOURS, to leadership ───────────────────────────────────────────────────────────────────

/**
 * Jon, 2026-08-19: "sending a message in leadership chat sharing hours, not clocked in, over
 * hours, ect." Goes to the leadership channel, tagging the leadership group.
 */
export async function runLaborReport(): Promise<any> {
  const rules = await getSlackRules()
  const rule = rules.events.labor_report
  if (!rule.enabled) return { skipped: 'disabled' }
  const channelId = rules.leadershipChannel || rules.defaultChannel || rules.firehose
  if (!channelId) return { skipped: 'no leadership channel set — pick one in /users' }

  const snap = await laborSnapshot(rules.overtimeHours)
  if (!snap.complete) return { skipped: 'no Homebase data for today' }

  const audience = rules.leadership.length ? rules.leadership : rules.core
  const { body, summary } = laborMessage({
    date: snap.date,
    totalHours: snap.totalHours,
    clockedInNow: snap.clockedInNow,
    overHours: snap.overHours,
    notClockedIn: snap.notClockedIn,
    missedClockOut: snap.missedClockOut,
    threshold: rules.overtimeHours,
    audience,
  })
  return draft({
    eventKey: 'labor_report',
    groupKey: 'labor:' + snap.date,
    channelId,
    body, summary, audience, itemCount: 1,
  }, rules)
}

// ── 14. Owner stays & big bookings ─────────────────────────────────────────────────────────────

/** Jon, 2026-08-19: "It should also send updates for owner stays, big bookings, etc." */
export async function runNotableArrivals(): Promise<any> {
  const rules = await getSlackRules()
  const rule = rules.events.notable_arrivals
  if (!rule.enabled) return { skipped: 'disabled' }
  const channelId = rules.leadershipChannel || rules.opsChannel || rules.defaultChannel || rules.firehose
  if (!channelId) return { skipped: 'no channel set' }

  const items = await findNotableArrivals({
    days: rules.notableLookaheadDays,
    bigBookingUsd: rules.bigBookingUsd,
    longStayNights: rules.longStayNights,
  })
  if (!items.length) return { skipped: 'nothing notable coming up' }

  const today = etDate()
  const audience = rules.leadership.length ? rules.leadership : rules.core
  const { body, summary } = notableArrivalsMessage({
    items: items.map(i => ({
      unit: i.unit, guest: i.guest, checkIn: i.checkIn, daysAway: i.daysAway,
      nights: i.nights, value: i.value, kind: i.kind,
    })),
    audience, days: rules.notableLookaheadDays,
  })
  return draft({
    eventKey: 'notable_arrivals',
    groupKey: 'notable:' + today,
    channelId, body, summary, audience, itemCount: items.length,
  }, rules)
}
