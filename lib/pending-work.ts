// PENDING WORK IN A UNIT, AND CONSOLIDATING THE TRIP.
//
// Jon, 2026-08-27:
//   "Some pending tasks in a unit should show in that recommendation section as well. Push it to
//    that date for the maintenance person that scheduled... This should be really, really robust
//    and help us just keep tabs on pending tasks in a particular unit. Also, if maintenance is
//    going into a unit, automatically push all of the pending maintenance tasks in that unit to
//    that date that they're going in the unit."
//
// The operational fact underneath: the expensive part of a maintenance job is not the job, it is
// GETTING SOMEBODY THROUGH THE DOOR. A tech driving to Arya 1418 to change a filter is standing two
// feet from the closet door that has been on the list for three weeks. Every pending job in that
// unit is nearly free while he is in there, and costs a whole second trip the moment he leaves.
//
// So: whenever somebody is going into a unit, everything else pending in that unit goes with them.
//
// ── WHAT COUNTS AS PENDING ──────────────────────────────────────────────────────────────────────
// An open Breezeway task on this unit that is NOT on today's board — overdue and never done, or
// parked on some future date, or sitting unscheduled. Today's tasks are already in front of the
// coordinator; these are the ones that quietly age.
//
// ── WHY IT SAYS SO ON THE TASK ──────────────────────────────────────────────────────────────────
// Jon, same day: "It should change the title to something indicating that it was moved", and "if
// Lighthouse is pushing something or creating an automation, it should indicate that Lighthouse
// pushed or updated the task. That way, it's an indicator."
//
// A task that silently changes date is indistinguishable from a task somebody rescheduled by hand,
// and in Breezeway the tech has no way to ask why. So a moved task is renamed and stamped: the
// title carries [Moved to <date>], the description carries a dated Lighthouse line saying what
// moved it and why. Both are additive — the ORIGINAL NAME IS PRESERVED inside the new title,
// because the cadence engine recognises existing work by matching that name, and a title rewrite
// that destroyed it would make the engine propose a duplicate of the very task it just moved.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { updateBreezewayTask, breezewayConfigured, matchBreezewayPerson } from './breezeway'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const dOf = (v: any) => str(v).slice(0, 10)
const DONE = /\b(complete|finish|close|approv)/i
const GONE = /delete|cancel/i

export function deptOf(v: any): 'maintenance' | 'housekeeping' | 'inspection' | 'other' {
  const s = str(v).toLowerCase()
  if (/housekeep|clean/.test(s)) return 'housekeeping'
  if (/maint/.test(s)) return 'maintenance'
  if (/inspect/.test(s)) return 'inspection'
  return 'other'
}

/** "Aug 29" — short enough for a task title, unambiguous to a person holding a phone. */
export function shortDate(ymd: string): string {
  const d = new Date(String(ymd) + 'T12:00:00Z')
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
    : String(ymd)
}

// The marker, and the rule that it never nests. A task moved three times must read
// "[Moved to Sep 2] Fix closet door", not "[Moved to Sep 2] [Moved to Aug 29] [Moved to Aug 27] …".
const MOVED_RE = /^\s*\[Moved to [^\]]+\]\s*/i

/** The task's real name, with any previous Lighthouse marker taken off. */
export function baseTitle(name: string): string {
  return str(name).replace(MOVED_RE, '').trim()
}

/** The name to write back: marked as moved, with the original name intact behind the marker. */
export function movedTitle(name: string, toDate: string): string {
  return `[Moved to ${shortDate(toDate)}] ${baseTitle(name)}`.slice(0, 240)
}

/**
 * The Lighthouse stamp for a description.
 *
 * Always dated, always says WHAT it did and WHY, and always appended rather than replacing — a
 * technician's own notes must survive an automation touching the task. Repeated stamps are trimmed
 * to the last few so a task moved weekly does not become a wall of them.
 */
export function stampDescription(existing: string, line: string, when: string): string {
  const mark = '— Lighthouse'
  const body = str(existing).split('\n').filter(l => l.indexOf(mark) !== 0).join('\n').trim()
  const priors = str(existing).split('\n').filter(l => l.indexOf(mark) === 0).slice(-3)
  const next = `${mark} ${when}: ${line}`
  return [body, ...priors, next].filter(Boolean).join('\n').slice(0, 1500)
}

export type PendingTask = {
  id: string
  listingId: string
  /** Display name, marker stripped, so the list reads like the work rather than like its history. */
  name: string
  rawName: string
  dept: 'maintenance' | 'housekeeping' | 'inspection' | 'other'
  /** Lighthouse created this one. Only its own inspections are allowed to ride forward. */
  byLighthouse: boolean
  /** Enough to open the task properly rather than only act on it blind. */
  status: string
  reportUrl: string | null
  scheduledDate: string | null
  assignees: string[]
  /** Days past its scheduled date. null when it is parked in the future or unscheduled. */
  overdueDays: number | null
  /** Scheduled after today. */
  future: boolean
  movedBefore: boolean
}

/**
 * Open work per unit that is NOT on today's board.
 *
 * Bounded on purpose: a task from eight months ago that nobody has touched is not "pending", it is
 * abandoned, and putting it in front of a coordinator every morning is how the whole panel starts
 * getting skipped. `lookBackDays` is the line between the two, and it is 30 days — see below.
 */
export async function pendingForUnits(
  listingIds: string[],
  today: string,
  opts: { lookBackDays?: number; lookAheadDays?: number } = {},
): Promise<Record<string, PendingTask[]>> {
  const out: Record<string, PendingTask[]> = {}
  if (!listingIds.length) return out
  // THIRTY DAYS (Jon, 2026-08-27: "I would only look back 30 days").
  // It was 120. That was too generous in both directions: a job nobody has touched in four months
  // is not pending, it is abandoned, and dragging it onto today's visit tells a tech something got
  // forgotten rather than that something needs doing. Thirty days is roughly "this month" — recent
  // enough that the person who logged it still remembers why, which is the test that matters when
  // somebody is standing in the unit deciding whether to act on it.
  const back = Math.max(1, opts.lookBackDays ?? 30)
  const ahead = Math.max(1, opts.lookAheadDays ?? 60)
  const from = dOf(new Date(Date.parse(today + 'T12:00:00Z') - back * 86400000).toISOString())
  const to = dOf(new Date(Date.parse(today + 'T12:00:00Z') + ahead * 86400000).toISOString())

  const db = supabaseAdmin()
  const { data, error } = await db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,name,status,scheduled_date,assignees,type_department,finished_at,report_url,description:raw->>description')
    .in('reference_property_id', listingIds.slice(0, 400))
    .gte('scheduled_date', from).lte('scheduled_date', to)
    .not('name', 'ilike', '%departure clean%')
    .not('name', 'ilike', '%strip%')
    .order('scheduled_date', { ascending: true }).order('id', { ascending: true })
    .limit(4000)
  if (error) return out

  for (const t of (data || []) as any[]) {
    const st = str(t.status).toLowerCase()
    if (GONE.test(st)) continue
    if (DONE.test(st) || t.finished_at) continue
    const sd = dOf(t.scheduled_date) || null
    if (sd === today) continue                      // already in front of them on the board
    const lid = String(t.reference_property_id)
    const raw = str(t.name)
    const days = sd && sd < today
      ? Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(sd + 'T12:00:00Z')) / 86400000)
      : null
    ;(out[lid] = out[lid] || []).push({
      id: String(t.id), listingId: lid,
      name: baseTitle(raw) || 'Task', rawName: raw,
      dept: deptOf(t.type_department),
      byLighthouse: /lighthouse/i.test(str(t.description)),
      status: str(t.status),
      reportUrl: t.report_url ? str(t.report_url) : null,
      scheduledDate: sd,
      assignees: Array.isArray(t.assignees)
        ? t.assignees.map((p: any) => str(p && typeof p === 'object' ? (p.name ?? '') : p).replace(/\s+/g, ' ').trim()).filter(Boolean)
        : [],
      overdueDays: days,
      future: !!sd && sd > today,
      movedBefore: MOVED_RE.test(raw),
    })
  }
  // Oldest first: the job that has waited longest is the one somebody should be embarrassed about.
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1)
      || String(a.scheduledDate || '').localeCompare(String(b.scheduledDate || '')))
  }
  return out
}

export type PushResult = { ok: boolean; moved: string[]; failed: { id: string; error: string }[] }

/**
 * Move tasks onto a date, optionally onto a person, and say on the task that Lighthouse did it.
 *
 * Breezeway's PATCH requires `name`, which is convenient: the retitle and the move are one call,
 * so a task can never end up moved but unmarked.
 */
export async function pushTasks(
  tasks: PendingTask[],
  toDate: string,
  opts: { assignee?: string | null; reason: string; by?: string | null } = { reason: '' },
): Promise<PushResult> {
  const res: PushResult = { ok: true, moved: [], failed: [] }
  if (!tasks.length) return res
  if (!breezewayConfigured()) return { ok: false, moved: [], failed: tasks.map(t => ({ id: t.id, error: 'Breezeway is not configured.' })) }

  const db = supabaseAdmin()
  let assigneeId: number | null = null
  const who = opts.assignee ? String(opts.assignee).trim() : ''
  if (who) { try { assigneeId = await matchBreezewayPerson(who) } catch { assigneeId = null } }

  // One read for the descriptions we are about to stamp — PATCH replaces the field, so a stamp
  // written without the current text would wipe whatever the technician had put there.
  const { data: cur } = await db.from('breezeway_tasks_sync')
    .select('id,raw').in('id', tasks.map(t => t.id)).limit(200)
  const descOf: Record<string, string> = {}
  for (const r of (cur || []) as any[]) {
    const raw = (r as any).raw
    descOf[String(r.id)] = str(raw && typeof raw === 'object' ? (raw.description ?? raw.notes ?? '') : '')
  }

  const stampedOn = new Date().toISOString().slice(0, 10)
  for (const t of tasks) {
    const name = movedTitle(t.rawName || t.name, toDate)
    const description = stampDescription(
      descOf[t.id] || '',
      `moved this from ${t.scheduledDate || 'unscheduled'} to ${toDate}${who ? ` and put it on ${who}` : ''}. ${opts.reason}`.trim(),
      stampedOn,
    )
    try {
      const patch: Record<string, any> = { name, scheduled_date: toDate, description }
      const r = await updateBreezewayTask(t.id, patch)
      if (!r.ok) throw new Error('Breezeway ' + r.status)
      if (assigneeId != null && Number.isFinite(assigneeId)) {
        try { await updateBreezewayTask(t.id, { name, assignments: [assigneeId] }) } catch { /* keeps its old assignee */ }
      }
      // Write-through so the board reflects it before the next sync.
      try {
        await db.from('breezeway_tasks_sync').update({
          name, scheduled_date: toDate,
          ...(assigneeId != null && who ? { assignees: [who] } : {}),
          synced_at: new Date().toISOString(),
        }).eq('id', t.id)
      } catch { /* sync catches up */ }
      res.moved.push(t.id)
    } catch (e: any) {
      res.ok = false
      res.failed.push({ id: t.id, error: String(e?.message || e).slice(0, 140) })
    }
  }
  return res
}

/**
 * THE TRIP CONSOLIDATOR. Somebody is going into this unit on `date` — bring the rest with them.
 *
 * Scoped to ONE department by default: a maintenance visit pulls maintenance, and does not conscript
 * the housekeeping deep clean somebody deliberately parked for next month. Returns what it moved so
 * the caller can say so out loud rather than changing the board silently.
 */
export async function sweepUnit(opts: {
  listingId: string
  unitName: string
  date: string
  dept: 'maintenance' | 'housekeeping' | 'inspection'
  assignee?: string | null
  by?: string | null
  /** Do not drag a job forward from further out than this — it was parked for a reason. */
  maxFutureDays?: number
}): Promise<PushResult & { candidates: PendingTask[]; skippedAsDone: PendingTask[] }> {
  const { listingId, unitName, date, dept } = opts
  // THE WINDOWS ARE OPERATOR SETTINGS NOW (Jon, 2026-08-27: "all this should be in settings and
  // automations"). They were hardcoded here, which meant the one number Jon actually wanted to
  // change — how far back counts as pending — was a code change.
  const { getTaskAutomation } = await import('./auto-inspections')
  const cfg = await getTaskAutomation().catch(() => null)
  const ts = cfg?.tripSweep
  if (ts && ts.enabled === false) return { ok: true, moved: [], failed: [], candidates: [], skippedAsDone: [] }
  const pending = (await pendingForUnits([listingId], date, { lookBackDays: ts?.lookBackDays }))[listingId] || []
  const horizon = Math.max(1, opts.maxFutureDays ?? ts?.maxFutureDays ?? 21)
  const cutoff = new Date(Date.parse(date + 'T12:00:00Z') + horizon * 86400000).toISOString().slice(0, 10)
  // ── THE DUPLICATE GATE RUNS FIRST (Jon, 2026-08-31: "that should be run before moving the task
  // forward") ───────────────────────────────────────────────────────────────────────────────────
  // Ask what this unit has ALREADY had done recently, before deciding what to drag onto today. A
  // pending job whose category was completed here last week is not pending — it is a record nobody
  // closed, and sending a tech to redo it is the single most expensive mistake this feature can
  // make. If the gate itself fails it returns empty and simply stops filtering; a broken audit must
  // never be able to block the day's work.
  const { completedRecently } = await import('./task-audit')
  const { auditKey } = await import('./task-audit')
  const alreadyDone = (await completedRecently([listingId], date, 14))[listingId] || new Set<string>()

  const skippedAsDone: PendingTask[] = []
  const take = pending.filter(t => {
    if (t.scheduledDate === date) return false
    // Future work is only pulled forward from inside the horizon. Something booked two months out
    // was scheduled deliberately, and yanking it to today is not helpfulness, it is meddling.
    if (t.future && String(t.scheduledDate) > cutoff) return false

    // ── MAINTENANCE ONLY (Jon, 2026-08-31: "for the pending work, it's only maintenance-related
    // tasks") ───────────────────────────────────────────────────────────────────────────────────
    // The sweep used to ride along with whatever trade was visiting. Housekeeping does not work
    // that way: a cleaner has a route and a clock, and handing them a backlog because they happened
    // to open the door costs the turn. Maintenance is the trade where the trip IS the cost, so
    // maintenance is the only trade that consolidates.
    //
    // Inspections are the one exception, and only Lighthouse's own: those carry a real brief and
    // were created by this system for a reason. An inspection somebody made by hand is not moved
    // forward at all — closeStrayInspections deals with those separately.
    const eligible = t.dept === 'maintenance' || (t.dept === 'inspection' && t.byLighthouse)
    if (!eligible) return false

    if (alreadyDone.has(auditKey(t.rawName, t.dept))) { skippedAsDone.push(t); return false }
    return true
  })
  if (!take.length) return { ok: true, moved: [], failed: [], candidates: [], skippedAsDone }
  const out = await pushTasks(take, date, {
    assignee: opts.assignee, by: opts.by,
    reason: `${dept === 'maintenance' ? 'Maintenance is' : 'Somebody is'} in ${unitName} that day, so this rides along instead of costing its own trip.`,
  })
  return { ...out, candidates: take, skippedAsDone }
}
