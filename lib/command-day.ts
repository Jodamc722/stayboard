// COMMAND CENTER — THE DAY, AND WHAT TO DO NEXT.
//
// Jon, 2026-09-02: "the Command Center should be where all key KPIs, items, or overview of the day
// are managed — claims, glitches, tasks, departure cleans, big arrival inspections, important
// top-priority issues — so we can manage it and get rid of the 'needs a human' tab." Then, on the
// second pass the same day: "think general manager of a STR business of 300+ units… actionable
// plan, visibility, direction and coordination. This needs to be world class."
//
// ── ONE READ, FOUR OUTPUTS ─────────────────────────────────────────────────────────────────────
// `buildCommandDay()` reads the day once (the same lib/ops-day picture the board reads, plus the
// capacity model, the glitch board, the claims desk, arrivals, reviews, sentiment, the task
// backlog) and produces:
//
//   verdict — DIRECTION. One sentence a GM says out loud at 8am: on track / at risk / behind, and
//             the two or three facts that make it so. Computed, never hand-typed.
//   tiles   — VISIBILITY. Eight always-present counters with the rows behind them, so the cockpit
//             has a fixed shape whatever the day looks like. Every number on a tile is reconciled
//             with the rows in its drawer — one denominator per thing.
//   next    — THE PLAN. ONE ranked list of things worth a person's attention, each with an OWNER
//             lane (housekeeping · maintenance · guest desk · GM), a DUE time, the evidence that
//             put it there, and the single action that clears it.
//   dismiss — COORDINATION. Rows can be dismissed for the day, server-side, so every device and
//             every person sees the same list.
//
// ── WHAT MAKES THE LIST (the predictive part) ──────────────────────────────────────────────────
//   turn        same-day turn with the clean not started / nobody on it
//   late        departure clean late or at risk against the 4pm clock
//   inspection  a BIG arrival (value ≥ task-automation bigValue) with no pre-arrival inspection on
//               record — dedupes against open/done inspection tasks AND auto_inspections. Only while
//               Task automation is NOT filing big-arrival inspections (2026-09-30); on, it reads 'auto'
//   feedback    a guest arrives into a unit whose recent reviews (≤3★ in the last five, 180 days,
//               naming a defect) — the quote rides with the row, and the proposed inspection carries it.
//               The Create button only while Task automation's arrival-feedback rule is off
//   pending     backlog (scheduled BEFORE the arrival day) still open in a unit a guest lands in
//   duplicate   the same job open twice on one unit on ONE DAY — proposes cancelling the extra one;
//               cancel stays behind the admin password (Jon: close/delete pw-gated)
//   glitch      an open guest issue that is overdue, an incident, or in the ops lane with no task
//   claim       a claim in Jon's review, or with its filing deadline inside 5 days / passed
//   refund      a glitch refund over the cap waiting on a sign-off (Decide; the amount only for
//               viewers who may see money)
//   staffing    a short-staffed day one to three days out, from the 14-day forecast (Decide)
//   guest       a guest waiting on a reply (the one rule, lib/response-times) or one the sentiment
//               scan marked unhappy — one row per thread, both tags when it is both
//   unassigned  open non-clean work on today's board with nobody attached (cleans are covered by
//               turn/late rows — never the same task twice)
//
// The model recommends; a person commits. Nothing here writes to Breezeway.
//
// ── ONE BUILD FOR EVERYONE, THE CLEARED ROWS PER REQUEST (2026-09-28 audit) ────────────────────
// Every read and every rule in buildCommandCore is the same for every viewer, so the core is cached
// (tag 'day', 30 seconds) and shared. Only the rows cleared today differ between two reads a second
// apart, so they are applied after the cache, read straight from the table — see withDismissals,
// which holds the cap, the counts, Handled/Completed and the verdict (all of which read them).
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from './supabase-admin'
import { DAY_TAG, tooOld } from './bust'
import { pageRows } from './db-page'
import { buildOpsDay } from './ops-day'
import { buildDayPicture, type DayPicture, type PersonTask } from './capacity-day'
import { getTaskAutomation } from './auto-inspections'
// The feedback rule is shared with the automation that files these inspections (lib/review-feedback).
import { keywordsOf, worstFeedbackReview } from './review-feedback'
import { getOpsPresets } from './app-settings'
import { noBreezewayRegex } from './ops-presets'
import { auditKey } from './task-audit'
import { isLiveStay } from './stay-status'
import { TASK_DONE_RE } from './task-categories'
import { STAGE_LABEL as CLAIM_STAGE_LABEL } from './claims'
import { ratingDisplay } from './review-scale'
import { COMPLETED, guestyCalled } from './call-desk'
import { readSnapshot, problemsFromSnapshot } from './channel-health'
import { CHANNEL_LABEL, VERDICT_LABEL } from './channel-types'
import { awaitingSet, slaDueAt, SLA_RULE_TEXT, type AwaitingRow, type AwaitingSet } from './response-times'
import { getAccess, canSeeMoney } from './access'
import type { StaffDay } from './forecast/staffing'

const str = (v: any) => String(v ?? '').trim()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (d: string, n: number) => ymd(new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000))
const DONE = TASK_DONE_RE   // the shared done rule (lib/task-categories)
const GONE = /\b(cancel|delet|void)/i
const INSPECT = /inspect|unit check|quality/i
const MOVED = /^\[moved to [^\]]+\]\s*/i
// Ratings are STORED on the 5-star scale (lib/review-scale — Booking is /2 at sync), so no halving
// here; only the DISPLAY string goes back to the channel's native scale.
const norm5 = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const starsText = (v: any, ch: any) => ratingDisplay(norm5(v), ch) + (/booking/i.test(str(ch)) ? '' : '★')
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const names = (a: any): string[] => Array.isArray(a) ? a.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean) : []
/** Midnight of an ET calendar day as a UTC instant — right through the DST switch, because the offset is read from the day itself. */
const etMidnightIso = (d: string) => {
  // Probe at 05:00Z — before the 06:00Z/07:00Z moment the clocks change — so the switch days get the
  // offset that was in force at THEIR midnight, not the one that took over later that morning.
  const probe = new Date(d + 'T05:00:00Z')
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(probe)) % 24
  const offset = (5 - etHour + 24) % 24 // 4 in summer, 5 in winter
  return new Date(Date.parse(d + 'T00:00:00Z') + offset * 3600000).toISOString()
}
/** Whole calendar days between two ET dates or timestamps, never off by the hour. */
const daysBetween = (fromIso: string, toYmd: string) => Math.round((Date.parse(toYmd + 'T12:00:00Z') - Date.parse(ymd(new Date(fromIso)) + 'T12:00:00Z')) / 86400000)

export const DISMISS_KEY = 'command_dismissed'
/** The key prefix of a refund sign-off row — how its cleared entries are recognised too. */
const REFUND_KEY = 'refund:'

export type NextKind = 'turn' | 'late' | 'inspection' | 'feedback' | 'pending' | 'duplicate' | 'glitch' | 'claim' | 'refund' | 'staffing' | 'guest' | 'unassigned' | 'channel'
/** A short label on a row ("Unhappy", "Late 25m"), with the hover that explains it. */
export type RowTag = { label: string; tone: 'rose' | 'amber' | 'violet' | 'sky' | 'slate'; title?: string }
/** Who owns clearing it. The lane a supervisor filters to. Lives in lib/command-types (client-safe). */
export type { Owner } from './command-types'
export { OWNER_LABEL } from './command-types'
import type { Owner } from './command-types'

export type NextAction =
  | { type: 'assign'; taskId: string; dept: string; label: string }
  | { type: 'create_task'; label: string; payload: { listingId: string; title: string; department: string; priority: string; description: string; date: string } }
  | { type: 'cancel_task'; taskId: string; label: string }
  | { type: 'open'; href: string; label: string; external?: boolean }

export type NextItem = {
  key: string
  kind: NextKind
  /** now = a guest feels it today · today = must land before the day ends · soon = next 48h */
  severity: 'now' | 'today' | 'soon'
  rank: number
  owner: Owner
  /** Plain-English deadline: "by 4:00 PM", "before 3:00 PM arrival", "tomorrow AM", "by 09-16". */
  due: string
  unit: string
  listingId: string | null
  market: string | null
  title: string
  why: string
  evidence?: { quote: string; stars: number | null; date: string; channel: string } | null
  /** Guest rows: "Unhappy" and the reply-by state ("Reply by 3:05pm" / "Late 25m"). */
  tags?: RowTag[]
  action: NextAction | null
  /** A Breezeway task this row is about — enables Note-to-assignee and the open link. */
  bzTaskId?: string | null
  href?: string | null
  /** When the thing this row is about last moved (a guest's latest message). A row closed before
   *  that moment comes back; a row closed after it stays closed (Jon, 2026-10-01). */
  since?: string | null
  dismissed?: Handled | null
}

/**
 * A row somebody cleared from the list today. `outcome` is what they said about it: done = the
 * work happened (it counts as completed), skipped = not relevant today. Rows the engine no longer
 * generates (the inspection got created, so the "no inspection" row is gone) still appear in
 * `handled`, because the title and unit were stored at the moment of the click.
 */
export type Handled = { key: string; by: string; at: string; outcome: 'done' | 'skipped'; title?: string; unit?: string }

export type Verdict = {
  state: 'on_track' | 'at_risk' | 'behind' | 'closing'
  headline: string
  detail: string
  /** Tomorrow's shape, so the GM can staff it today. */
  tomorrow: string
}

export type CleanRow = {
  taskId: string; unit: string; market: string; who: string
  /** A started clean is ALWAYS 'running' (Jon, 2026-10-05: "make sure it shows in progress if task is
   *  started") — the deadline worry rides on `behind`, it never hides that somebody is on it. */
  status: 'done' | 'running' | 'late' | 'atRisk' | 'open' | 'vendor' | 'extended'
  /** Only on a running clean: the projection says it lands past the deadline ('late') or close to it. */
  behind?: 'late' | 'atRisk' | null
  arrivingAt: string | null; sameDay: boolean; outAt: string | null
}
/** inspection 'auto' = a big arrival with none yet that Task automation files on its next run — nobody is asked. */
export type ArrivalRow = { reservationId: string; guest: string; unit: string; listingId: string | null; checkIn: string; nights: number; value: number; big: boolean; today: boolean; inspection: 'none' | 'open' | 'done' | 'n/a' | 'auto'; inspectionTaskId: string | null; welcomeDone: boolean }
export type TaskRow = { taskId: string; unit: string; market: string; name: string; dept: string; type: string; who: string; state: 'done' | 'running' | 'open'; prio: string; late: boolean }
export type TeamRow = { person: string; role: string | null; cleans: number; otherTasks: number; loadMinutes: number; capacityMinutes: number; utilisationPct: number; verdict: string; headroomCleans: number; triggers: string[]; tasks: PersonTask[] }
export type GlitchRow = { id: string; unit: string; issue: string; status: string; due: string | null; overdue: boolean; ageDays: number; assignee: string; hasTask: boolean; taskStatus: string | null; href: string }
export type ClaimRow = { id: string; unit: string; property: string; guest: string; stage: string; stageLabel: string; deadline: string | null; daysLeft: number | null; amount: number | null; waitingOn: string | null }
export type OverdueRow = { key: string; kind: 'breezeway' | 'field' | 'glitch' | 'urgent'; text: string; href: string | null; count?: number }
export type GuestDeskRow = { key: string; kind: 'review' | 'message' | 'welcome' | 'approval'; who: string; unit: string; text: string; meta: string; href: string }

export type CommandDay = {
  ok: true
  today: string
  generatedAt: string
  /** Reads that failed. The UI shows them; the numbers they feed are marked, never silently zero. */
  degraded: string[]
  verdict: Verdict
  pulse: { active: number; occupiedTonight: number; arrivals: number; departures: number; sameDayTurns: number; vacant: number; cleansDone: number; cleansTotal: number; minsLeft: number; lastSync: string | null }
  tiles: {
    cleans: { total: number; done: number; running: number; late: number; atRisk: number; vendor: number; extended: number; rows: CleanRow[] }
    arrivals: { today: number; big: number; bigToday: number; missingInspection: number; rows: ArrivalRow[] }
    tasks: { total: number; open: number; running: number; done: number; unassigned: number; late: number; urgent: number; byDept: Record<string, number>; rows: TaskRow[] }
    team: { onShift: number; utilisationPct: number; overloaded: number; underloaded: number; idle: string[]; unowned: number; implausible: number; moves: DayPicture['suggestions']; notes: string[]; rows: TeamRow[] }
    glitches: { open: number; overdue: number; noTask: number; byLane: Record<string, number>; rows: GlitchRow[] }
    claims: { open: number; review: number; dueSoon: number; rows: ClaimRow[] }
    overdue: { total: number; breezeway: number; field: number; glitches: number; urgent: number; rows: OverdueRow[] }
    guestDesk: { reviews: number; messages: number; welcome: number; approvals: number; total: number; shown: number; rows: GuestDeskRow[] }
  }
  next: NextItem[]
  /** Live rows hidden by the 48-hour caps, by kind — so a capped list never reads as "done". */
  hiddenSoon: Partial<Record<NextKind, number>>
  dismissedCount: number
  byOwner: Record<Owner, number>
  /** Everything cleared from the list today, newest first — whether or not the engine still generates the row. */
  handled: Handled[]
  /** What landed today: the day's work, done. */
  completed: {
    cleansDone: number; cleansTotal: number
    tasksDone: number; tasksTotal: number
    /** Guest calls completed today (welcome + post-checkout), from the Calls desk. */
    callsDone: number
    /** Rows on this page marked done today. */
    handledDone: number
  }
}

type Meta = { name: string; market: string; building: string | null; active: boolean }

type Deadline = { dueBy: string; minsLeft: number; passed: boolean; cleans: number; done: number; running: number; remaining: number; late: number; atRisk: number; missed: number; untracked: number }

/** Everything on the page that is the same for every viewer — the part that is cached. */
type CommandCore = {
  today: string
  generatedAt: string
  degraded: string[]
  pulse: CommandDay['pulse']
  tiles: CommandDay['tiles']
  /** Every row the engine generated, ranked. Nothing capped and nothing cleared yet: both depend on the rows cleared today. */
  rows: Omit<NextItem, 'dismissed'>[]
  /** The board's 4pm clock — what the verdict reads besides the live rows. */
  clock: Deadline
  util: number | null
  unowned: number
  glitchesOverdue: number
  /** Tomorrow's shape (the verdict's last line). */
  tomorrow: string
  completed: Omit<CommandDay['completed'], 'handledDone'>
  /** The day board read failed outright. This core degrades the one request, as it always did, and is never cached. */
  dayFailed: boolean
}

/**
 * THE DAY, BUILT ONCE FOR EVERYONE (2026-09-28 audit, 02-cache-perf D1). The page asked for the
 * whole day on every 5-minute poll, every tab focus and every click, for every viewer — ~25-30
 * PostgREST reads per build, ~40 with a cold board. The core is now built at most every 30 seconds
 * and shared (tag 'day': an assign, a staged pick or a Breezeway change still shows on the next
 * read), and the rows cleared today are applied after it, read straight from the table as before.
 *
 * `money`: may the caller see dollar amounts (lib/access canSeeMoney)? Left out, it is the signed-in
 * viewer's own switch — looked up only on a day that has an amount to hold back.
 */
export async function buildCommandDay(opts: { money?: boolean } = {}): Promise<CommandDay> {
  const today = ymd(new Date())
  const [core, dismissRow] = await Promise.all([
    commandCore(today),
    // Dismissals are read STRAIGHT from the table, not through the 60s settings cache (and never
    // through the day cache): a row you just dismissed must not bounce back because the next
    // request landed on another instance.
    supabaseAdmin().from('app_settings').select('value').eq('key', DISMISS_KEY).maybeSingle(),
  ])
  const day = withDismissals(core, dismissRow)
  // A REFUND'S AMOUNT IS FOR PEOPLE WHO MAY SEE MONEY (the owner, and whoever he switched on). The
  // core is shared, so it is taken out here, per request, after the cache.
  if (!day.next.some(n => n.kind === 'refund') && !day.handled.some(h => h.key.startsWith(REFUND_KEY))) return day
  const seesMoney = opts.money != null ? opts.money : await getAccess().then(a => canSeeMoney(a)).catch(() => false)
  return seesMoney ? day : withoutRefundAmounts(day)
}

/** A cached core older than this is rebuilt in place rather than served as now (lib/bust). */
const CORE_MAX_AGE_MS = 90_000

async function commandCore(today: string): Promise<CommandCore> {
  let core: CommandCore
  try { core = await cachedCore(today) }
  catch (e: any) { if (e && e.uncachedCore) return e.uncachedCore as CommandCore; throw e }
  return tooOld(core.generatedAt, CORE_MAX_AGE_MS) ? buildCommandCore(today) : core
}

const cachedCore = unstable_cache(async (today: string): Promise<CommandCore> => {
  const core = await buildCommandCore(today)
  // A FAILED BOARD READ IS NEVER SHARED: it degrades this request and the next one tries again,
  // instead of every viewer reading a zeroed day for the next 30 seconds. Throwing is how a value
  // is kept out of unstable_cache; commandCore catches it and uses the core all the same.
  if (core.dayFailed) { const e: any = new Error('command day not cached: the day board read failed'); e.uncachedCore = core; throw e }
  return core
}, ['command-day-core-v1'], { tags: [DAY_TAG], revalidate: 30 })

async function buildCommandCore(today: string): Promise<CommandCore> {
  const db = supabaseAdmin()
  const now = new Date()
  const tomorrow = shift(today, 1)
  const in2 = shift(today, 2)
  const back45 = shift(today, -45)
  const back60 = shift(today, -60)
  const back180 = shift(today, -180)
  const ahead14 = shift(today, 14)
  const nowIso = now.toISOString()
  const degraded: string[] = []
  const guard = <T,>(label: string, r: { data: T | null; error: any } | null | undefined, fallback: T): T => {
    if (!r || r.error) { degraded.push(label + (r && r.error && r.error.message ? ' — ' + String(r.error.message).slice(0, 80) : '')); return fallback }
    return (r.data ?? fallback) as T
  }
  /** PostgREST caps a page at 1000 rows whatever .limit() asks for; page until short. */
  const pageAll = async (build: (from: number, to: number) => any, pages = 6) => {
    let rows: any[] = []
    for (let i = 0; i < pages; i++) {
      const { data, error } = await build(i * 1000, i * 1000 + 999)
      if (error) throw error
      rows = rows.concat(data || [])
      if (!data || data.length < 1000) break
    }
    return rows
  }
  const OPEN = (q: any) => q.is('finished_at', null)
    .not('status', 'ilike', '%complet%').not('status', 'ilike', '%finish%')
    .not('status', 'ilike', '%close%').not('status', 'ilike', '%approv%')
    .not('status', 'ilike', '%delete%').not('status', 'ilike', '%cancel%')

  // Started first and awaited last (section 7), so the forecast's reads overlap the day's.
  const staffingP = shortDaysAhead()

  // ── WAVE 1: everything that does not depend on anything else ──────────────────────────────────
  // The channel snapshot read starts with everything else (2026-10-01 audit) — it used to run alone, after.
  const snapshotP = readSnapshot().catch(() => null as any)
  const [day, automation, presets, arrivalsRes, glitchesRes, claimsRes, sentimentRes, reviewsToReplyRes, waiting, approvalsRes, fieldOverdueRes, openTasksP, bzOverdueCountRes, callsDoneRes, refundsRes] = await Promise.all([
    // .catch, because buildOpsDay now THROWS on a failed read (2026-09-09) — right for the board's
    // own route, wrong here: a listings blip must not take claims, reviews, messages and the calls
    // desk down with it. A null day degrades; every `day.*` read below is guarded.
    buildOpsDay(null, { includeMeta: true }).catch((e: any) => { degraded.push('the day board — ' + String(e?.message || e).slice(0, 80)); return null }),
    getTaskAutomation(),
    getOpsPresets(),
    db.from('guesty_reservations')
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,money_total,status,custom_fields')
      .gte('check_in', today).lte('check_in', in2).order('check_in').limit(400),
    db.from('glitches')
      .select('id,listing_id,unit,status,glitch_type,category,overview,due_date,assignee,breezeway_task_id,created_at,guest_name')
      .not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: false }).limit(200),
    db.from('claims')
      .select('id,stage,waiting_on,property,unit_no,guest_name,deadline_on,amount_sought,listing_id,deleted_at')
      .neq('stage', 'closed').is('deleted_at', null).limit(200),
    // Unhappy guests only: who is WAITING comes from the one rule below, not from the scan.
    db.from('guesty_conversation_sentiment')
      .select('conversation_id,guest_name,listing_id,reservation_id,channel,dissatisfied,top_issue,guest_excerpt,last_message_at,last_guest_at,status')
      .eq('status', 'open').eq('dissatisfied', true).order('last_message_at', { ascending: false }).limit(60),
    db.from('guesty_reviews').select('id,listing_id,rating,channel,guest_name,created_at,content', { count: 'exact' })
      .eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', back60 + 'T00:00:00Z')
      .order('created_at', { ascending: false }).limit(80),
    // WHO IS WAITING ON US — THE ONE RULE (lib/response-times awaitingSet, 2026-09-28 audit D3–D5):
    // the set the /messages "N waiting" pill, its Needs-reply tab and Eve read. This counted Guesty's
    // unread flag, which says whether somebody opened the thread, not whether anybody answered it.
    // A failed read degrades (no rows, named below); it never takes the day down.
    awaitingSet({ db }).catch((e: any): AwaitingSet => ({ rows: [], ids: [], overdue: 0, slaKnown: false, truncated: false, error: String(e?.message || e) })),
    // PENDING ONLY, in SQL (2026-10-01 audit): the newest 60 of every approval ever asked, filtered
    // in JS, let decided ones crowd older pending ones off the desk.
    db.from('field_requests').select('id,title,type,building,unit,vendor,amount_usd,priority,approval_status,due_at,status')
      .eq('approval_required', true).or('approval_status.is.null,approval_status.eq.pending').order('created_at', { ascending: false }).limit(60),
    db.from('field_requests').select('id,title,type,building,unit,vendor,amount_usd,priority,approval_status,due_at,status')
      .in('status', ['open', 'in_progress']).lt('due_at', nowIso).order('due_at').limit(60),
    // ONE task read for the duplicate scan, the pending-in-unit signal and the inspection lookup:
    // open work from 45 days back through +14. Paged.
    pageAll((a, b) => OPEN(db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,assignees,type_department,prio:raw->>type_priority'))
      .gte('scheduled_date', back45).lte('scheduled_date', ahead14)
      .order('scheduled_date').order('id').range(a, b)).then(rows => ({ data: rows, error: null })).catch(e => ({ data: null, error: e })),
    // The overdue backlog is a NUMBER — ask for a count, not 8,000 rows.
    OPEN(db.from('breezeway_tasks_sync').select('id', { count: 'exact', head: true }))
      .gte('scheduled_date', back45).lt('scheduled_date', today),
    // Calls completed today — the Calls desk's own definition of "happened" (lib/call-desk
    // COMPLETED), counted on the ET day the call was logged. A count, not rows.
    db.from('guest_calls').select('reservation_id', { count: 'exact', head: true })
      .in('outcome', COMPLETED as any).gte('called_at', etMidnightIso(today)).lt('called_at', etMidnightIso(shift(today, 1))),
    // Refunds logged over the cap and not yet signed off — whatever lane the glitch is in.
    db.from('glitches').select('id,listing_id,unit,guest_name,overview,glitch_type,category,refund_approved')
      .eq('refund_needs_approval', true).order('created_at', { ascending: false }).limit(50),
  ])
  // THE CAPACITY MODEL rides in with the day: lib/ops-day prices it for its landings, and this used
  // to price the same day a second time in the same second. Read on its own only when the board read
  // failed or came back without one.
  const cap: DayPicture | null = day && day.picture && day.picture.date === today ? day.picture
    : await buildDayPicture(today).catch((e: any) => { degraded.push('capacity model — ' + String(e?.message || e).slice(0, 80)); return null as DayPicture | null })

  // ── listing meta comes from the board's own map (vendor-aware market, no second read) ─────────
  // A null `day` means the board read failed and was caught above: the page still renders claims,
  // reviews, messages and the calls desk, with the day's own numbers zeroed and named in `degraded`.
  const EMPTY_DEADLINE = { dueBy: '', minsLeft: 0, passed: false, cleans: 0, done: 0, running: 0, remaining: 0, late: 0, atRisk: 0, missed: 0, untracked: 0 }
  const EMPTY_PULSE = { active: 0, occupiedTonight: 0, arrivals: 0, departures: 0, sameDayTurns: 0, vacant: 0 }
  const dayDeadline = day ? day.deadline : EMPTY_DEADLINE
  const dayPulse: any = day ? day.pulse : EMPTY_PULSE
  // The board reports its own partial reads (a truncated arrival scan); fold them into ours so one
  // list on the cockpit names everything that is incomplete.
  if (day && Array.isArray((day as any).degraded)) for (const d of (day as any).degraded) degraded.push(d)
  const meta: Record<string, Meta> = ((day && day.listingMeta) || {}) as any
  if (!Object.keys(meta).length) degraded.push('listings')
  const nameOf = (id: any) => (meta[str(id)] || {}).name || ''
  const marketOfId = (id: any) => (meta[str(id)] || {}).market || null
  const noBzRe = noBreezewayRegex(presets.vendorBuildings)
  const canFile = (lid: string) => { const m = meta[lid]; return !!m && !noBzRe.test((m.building || '') + ' ' + m.name) }

  const openTasks = guard<any[]>('open tasks', openTasksP as any, [])
  const openByListing: Record<string, any[]> = {}
  const openById: Record<string, any> = {}
  for (const t of openTasks) {
    const st = str(t.status).toLowerCase()
    if (GONE.test(st) || DONE.test(st)) continue
    openById[str(t.id)] = t
    ;(openByListing[str(t.reference_property_id)] = openByListing[str(t.reference_property_id)] || []).push(t)
  }

  // ── arrivals (today → +2), live stays only ───────────────────────────────────────────────────
  const arrivalsAll = guard<any[]>('arrivals', arrivalsRes as any, []).filter(r => isLiveStay(r.status))
  const arrivalIds = Array.from(new Set(arrivalsAll.map(r => str(r.listing_id)).filter(Boolean)))
  // Reviews are only read for the units a guest lands in TODAY or TOMORROW — the only arrivals the
  // feedback rows below look at — so the paged read carries no day-after-tomorrow units.
  const feedbackIds = Array.from(new Set(arrivalsAll.filter(r => { const d = str(r.check_in).slice(0, 10); return d === today || d === tomorrow }).map(r => str(r.listing_id)).filter(Boolean)))
  const arrivalResIds = arrivalsAll.map(r => str(r.id)).filter(Boolean)
  const glitchTaskIds = guard<any[]>('glitches', glitchesRes as any, []).map(g => str(g.breezeway_task_id)).filter(Boolean)
  // The stays behind the unhappy-guest rows that could make the list (section 6). Read raw here —
  // the sentiment read's own guard stays where it was, so a failure is named in the same place.
  const sentResIds = Array.from(new Set((((sentimentRes as any)?.data || []) as any[]).filter(s => s && s.dissatisfied).map(s => str(s.reservation_id)).filter(Boolean)))
  if (waiting.error) degraded.push('guests waiting on a reply — ' + String(waiting.error).slice(0, 80))
  else if (waiting.truncated) degraded.push('guests waiting on a reply (the first 1,000)')

  // ── WAVE 2: keyed on the arriving units, all in parallel ─────────────────────────────────────
  const [arrivalReviews, autoInsp, doneInspRows, glitchTaskRows, guestStayRows, welcomeCallRows, waitThreads] = await Promise.all([
    // Recent reviews only (180d) — bounded by date, not by an arbitrary row cap that starves quiet units.
    // PAGED NEWEST FIRST (2026-09-29): the old .limit(3000) returned 1,000 — the newest 1,000 across
    // every arriving unit — so a quieter unit's last five reviews could be cut off the end of it.
    feedbackIds.length
      ? pageRows<any>((a, b) => db.from('guesty_reviews').select('id,listing_id,rating,content,guest_name,channel,created_at')
          .in('listing_id', feedbackIds.slice(0, 300)).eq('excluded_from_score', false).gte('created_at', back180 + 'T00:00:00Z')
          .order('created_at', { ascending: false }).order('id').range(a, b), 4)
          .then(r => { if (r.truncated) degraded.push('arrival reviews'); return r.rows })
      : Promise.resolve([] as any[]),
    arrivalIds.length
      ? db.from('auto_inspections').select('reservation_id,listing_id,task_id,check_in')
          .in('listing_id', arrivalIds.slice(0, 300)).gte('check_in', back45).lte('check_in', in2).then(r => guard<any[]>('auto inspections', r as any, []))
      : Promise.resolve([] as any[]),
    // Finished inspections on the arriving units — the name filter is in SQL, and the read is PAGED
    // NEWEST FIRST (2026-09-28 audit): an unordered .limit(2000) is 1,000 arbitrary rows, so the
    // newest walk could be the one left out — and a "walked since = done" feedback row came back.
    arrivalIds.length
      ? pageRows<any>((a, b) => db.from('breezeway_tasks_sync').select('id,reference_property_id,name,finished_at')
          .in('reference_property_id', arrivalIds.slice(0, 300)).gte('scheduled_date', back180).lte('scheduled_date', in2)
          .not('finished_at', 'is', null)
          .or('name.ilike.%inspect%,name.ilike.%unit%check%,name.ilike.%quality%')
          .order('finished_at', { ascending: false }).order('id').range(a, b), 4)
          .then(r => { if (r.truncated) degraded.push('done inspections'); return r.rows })
      : Promise.resolve([] as any[]),
    glitchTaskIds.length
      ? db.from('breezeway_tasks_sync').select('id,status,finished_at').in('id', glitchTaskIds.slice(0, 200)).then(r => guard<any[]>('glitch tasks', r as any, []))
      : Promise.resolve([] as any[]),
    sentResIds.length
      ? db.from('guesty_reservations').select('id,check_in,check_out,status').in('id', sentResIds.slice(0, 100)).then(r => guard<any[]>('guest stays', r as any, []))
      : Promise.resolve([] as any[]),
    // ONE DEFINITION OF "WELCOME CALL DONE" (2026-09-28 audit, D21) — the Calls desk's: the Guesty
    // field (matched by its id) or a completed welcome call logged here. This read the field by a
    // NAME Guesty never sends, so every arrival counted as "welcome call due".
    arrivalResIds.length
      ? db.from('guest_calls').select('reservation_id').eq('kind', 'welcome').in('outcome', COMPLETED as any)
          .in('reservation_id', arrivalResIds.slice(0, 300)).then(r => guard<any[]>('welcome calls', r as any, []))
      : Promise.resolve([] as any[]),
    // The waiting threads' guest and last line — conversation_response holds neither.
    waiting.ids.length
      ? db.from('guesty_conversations').select('id,listing_id,guest_name,channel,last_message_preview')
          .in('id', waiting.ids.slice(0, 200)).then(r => guard<any[]>('waiting threads', r as any, []))
      : Promise.resolve([] as any[]),
  ])
  const welcomeCalled = new Set<string>(welcomeCallRows.map((c: any) => str(c.reservation_id)))
  const stayById: Record<string, any> = {}
  for (const s of guestStayRows) stayById[str(s.id)] = s

  // The rows as the engine generates them — whether anybody cleared one today is withDismissals' job.
  const next: Omit<NextItem, 'dismissed'>[] = []
  const push = (i: Omit<NextItem, 'dismissed'>) => { next.push(i) }
  const bz = (id: string) => 'https://app.breezeway.io/task/' + id
  const FOUR = '4:00 PM'
  const past4Now = dayDeadline.minsLeft < 0
  /** The due phrase for work tied to today's 4pm arrivals — honest after the hour has passed. */
  const dueArrival = (isToday: boolean, at?: string | null) => isToday ? (past4Now ? 'arrival window open — now' : 'before ' + (at || FOUR) + ' arrival') : 'tomorrow, before ' + FOUR

  // ── 1. THE BOARD: turns, late/at-risk cleans, unowned work (from lib/ops-day) ────────────────
  const units = day && Array.isArray(day.units) ? day.units : []
  const cleanRows: CleanRow[] = []
  const taskRows: TaskRow[] = []
  const byDept: Record<string, number> = {}
  let tOpen = 0, tRunning = 0, tDone = 0, tUnassigned = 0, tLate = 0, tUrgent = 0, extendedN = 0
  for (const u of units) {
    const clean = u.tasks.find((t: any) => t.type === 'departure_clean')
    for (const t of u.tasks) {
      if (t.type === 'departure_clean' || t.guestyOnly) {
        const extended = t.moveState === 'extended'
        if (extended) extendedN++
        cleanRows.push({
          taskId: t.id, unit: u.unit, market: u.market, who: t.assignees.join(', '),
          // In progress wins over the deadline flags (2026-10-05): before this, a clean somebody was
          // halfway through read "at risk" after 3pm and the bar said 0 in progress, 13 at risk.
          status: extended ? 'extended' : (t.guestyOnly || t.untracked) ? 'vendor' : t.done ? 'done' : t.running ? 'running' : t.late ? 'late' : t.atRisk ? 'atRisk' : 'open',
          behind: !extended && !t.done && t.running ? (t.late ? 'late' : t.atRisk ? 'atRisk' : null) : null,
          arrivingAt: u.arrivingAt || null, sameDay: !!u.sameDayTurn, outAt: u.checkOutTime || null,
        })
        continue
      }
      byDept[t.dept] = (byDept[t.dept] || 0) + 1
      if (t.done) tDone++; else if (t.running) tRunning++; else tOpen++
      if (!t.done && !t.assignees.length) tUnassigned++
      if (t.late) tLate++
      const prio = str(openById[str(t.id)]?.prio).toLowerCase() || 'normal'
      if (!t.done && (prio === 'urgent' || prio === 'high')) tUrgent++
      taskRows.push({ taskId: t.id, unit: u.unit, market: u.market, name: t.name, dept: t.dept, type: t.type, who: t.assignees.join(', '), state: t.done ? 'done' : t.running ? 'running' : 'open', prio, late: !!t.late })
    }
    if (u.allDone) continue
    const liveClean = clean && !clean.done && !clean.guestyOnly && clean.moveState !== 'extended' ? clean : null
    if (liveClean && u.sameDayTurn) {
      const nobody = !liveClean.assignees.length
      push({
        key: 'turn:' + u.listingId, kind: 'turn', severity: 'now', rank: 0, owner: 'housekeeping',
        due: dueArrival(true, u.arrivingAt),
        unit: u.unit, listingId: u.listingId, market: u.market,
        title: 'Same-day turn' + (u.arrivingGuest ? ' — ' + u.arrivingGuest + ' in at ' + (u.arrivingAt || FOUR) : ''),
        why: liveClean.running ? 'Clean in progress' + (liveClean.assignees.length ? ' with ' + liveClean.assignees.join(', ') : '') + '.'
          : nobody ? 'Departure clean not started and nobody is on it.' : 'Departure clean not started — ' + liveClean.assignees.join(', ') + ' assigned.',
        action: nobody ? { type: 'assign', taskId: liveClean.id, dept: 'housekeeping', label: 'Assign' } : { type: 'open', href: bz(liveClean.id), label: 'Open task', external: true },
        bzTaskId: liveClean.id,
      })
    } else if (liveClean && (u.late || u.atRisk)) {
      push({
        key: 'late:' + u.listingId, kind: 'late', severity: 'now', rank: 1, owner: 'housekeeping',
        due: u.late ? 'now — past ' + FOUR : 'by ' + FOUR,
        unit: u.unit, listingId: u.listingId, market: u.market,
        title: u.late ? 'Departure clean late against the 4pm clock' : 'Departure clean at risk — not started',
        why: (u.checkOutTime ? 'Guest out ' + u.checkOutTime + '. ' : '') + (liveClean.assignees.length ? liveClean.assignees.join(', ') + ' assigned.' : 'Nobody assigned.'),
        action: liveClean.assignees.length ? { type: 'open', href: bz(liveClean.id), label: 'Open task', external: true } : { type: 'assign', taskId: liveClean.id, dept: 'housekeeping', label: 'Assign' },
        bzTaskId: liveClean.id,
      })
    }
    // Unowned NON-clean work (the clean is already a turn/late row when it matters — never the same task twice).
    const un = u.tasks.filter((t: any) => !t.done && !t.guestyOnly && t.type !== 'departure_clean' && !t.assignees.length)
    if (un.length) {
      const t = un[0]
      push({
        key: 'un:' + u.listingId, kind: 'unassigned', severity: 'today', rank: 5, owner: t.dept === 'housekeeping' ? 'housekeeping' : 'maintenance',
        due: 'by end of shift',
        unit: u.unit, listingId: u.listingId, market: u.market,
        title: un.length === 1 ? t.name + ' has nobody on it' : un.length + ' tasks today with nobody on them',
        why: (u.guestOut ? 'Guest leaves today. ' : '') + un.map((x: any) => x.name).slice(0, 3).join(' · '),
        action: { type: 'assign', taskId: t.id, dept: t.dept, label: 'Assign' }, bzTaskId: t.id,
      })
    }
  }

  // ── 2. ARRIVALS: big arrivals → inspection cover; feedback; backlog in the unit ──────────────
  const bigValue = automation.bigValue || 1000
  // THE AUTOMATION OWNS THESE, NOBODY IS ASKED (Jon, 2026-09-30: "quality inspection should be
  // auto-generated. It shouldn't be required or asked for"). With Task automation on, a big arrival
  // and an arrival into a unit with a bad review get their inspection from the cron
  // (lib/auto-inspections) — so no "Create inspection" row here; until the cron's next run the
  // arrival just reads 'auto'. With it off, the row stays, and says so and where to switch it on.
  const autoBig = automation.enabled && automation.bigArrivals
  const autoFeedback = automation.enabled && automation.arrivalFeedback
  const NOT_AUTO: RowTag = { label: 'Not automated', tone: 'slate', title: 'Inspections are not automated — switch them on in Admin → Users & admin → Settings → Task automation' }
  const AUTOMATION_HREF = '/users?tab=settings&panel=automation'
  const inspByRes = new Set(autoInsp.filter((a: any) => a.task_id).map((a: any) => str(a.reservation_id)))
  // Two reads of the same rows: the arrival's own "inspection done" (recent, 45 days) and, per
  // listing, when the LAST inspection finished — so a feedback row can tell whether the walk came
  // after the review it is about.
  const doneInsp: Record<string, string> = {}
  const lastWalk: Record<string, string> = {}
  for (const t of doneInspRows) {
    const lid = str(t.reference_property_id), fin = str(t.finished_at).slice(0, 10)
    // Rows arrive newest first: the first one per unit is the walk to link.
    if (fin >= back45 && !doneInsp[lid]) doneInsp[lid] = str(t.id)
    if (!lastWalk[lid] || fin > lastWalk[lid]) lastWalk[lid] = fin
  }
  const reviewsByListing: Record<string, any[]> = {}
  for (const r of arrivalReviews) (reviewsByListing[str(r.listing_id)] = reviewsByListing[str(r.listing_id)] || []).push(r)

  const arrivalRows: ArrivalRow[] = []
  let missingInspection = 0
  const seenFeedbackUnit = new Set<string>()
  for (const r of arrivalsAll) {
    const lid = str(r.listing_id)
    const unit = nameOf(lid) || str(r.listing_name) || 'Unit'
    const checkIn = str(r.check_in).slice(0, 10)
    const value = Number(r.money_total) || 0
    const nights = Number(r.nights) || 0
    // VALUE ONLY (Jon, 2026-08-22): a long cheap stay is not a big arrival.
    const big = value >= bigValue
    const isToday = checkIn === today, isTomorrow = checkIn === tomorrow
    const openInsp = (openByListing[lid] || []).find((t: any) => INSPECT.test(str(t.name)))
    const inspection: ArrivalRow['inspection'] = !canFile(lid) && !openInsp && !doneInsp[lid] ? 'n/a' : openInsp ? 'open' : (doneInsp[lid] || inspByRes.has(str(r.id))) ? 'done' : (big && autoBig) ? 'auto' : 'none'
    const welcomeDone = guestyCalled(r.custom_fields) || welcomeCalled.has(str(r.id))
    arrivalRows.push({ reservationId: str(r.id), guest: str(r.guest_name) || 'Guest', unit, listingId: lid || null, checkIn, nights, value, big, today: isToday, inspection, inspectionTaskId: openInsp ? str(openInsp.id) : (doneInsp[lid] || null), welcomeDone })

    if (!isToday && !isTomorrow) continue
    const when = isToday ? 'today' : 'tomorrow'
    if (big && inspection === 'none') {
      missingInspection++
      push({
        key: 'insp:' + str(r.id), kind: 'inspection', severity: isToday ? 'today' : 'soon', rank: isToday ? 2 : 6, owner: 'maintenance',
        due: dueArrival(isToday),
        unit, listingId: lid, market: marketOfId(lid),
        // Only reached when the automation does NOT own big arrivals ('auto' above otherwise).
        title: 'Big arrival ' + when + ' with no pre-arrival inspection — inspections are not automated',
        why: str(r.guest_name || 'Guest') + ' · ' + nights + ' nights · ' + money(value) + '. No inspection open or completed on this unit in 45 days.',
        tags: [NOT_AUTO], href: AUTOMATION_HREF,
        action: { type: 'create_task', label: 'Create inspection', payload: {
          listingId: lid, title: 'Pre-arrival inspection — ' + unit + ' (big arrival)', department: 'inspection', priority: 'high', date: today,
          description: 'Pre-arrival inspection for a big arrival: ' + str(r.guest_name || 'Guest') + ', ' + nights + ' nights, ' + money(value) + ', checking in ' + checkIn + '. Walk the unit against the listing photos, test every appliance and the A/C, confirm consumables and linens, and photograph anything below standard.\n\nProposed by Lighthouse Command Center (big arrival).',
        } },
      })
    }
    // Guest feedback: the worst of the last five reviews (already bounded to 180 days) when it is
    // ≤2★, or ≤3★ AND names a defect we can send someone to look at. Without that bar every arrival
    // day was a wall of feedback rows (100 of 287 units carry some ≤3★).
    if (!seenFeedbackUnit.has(lid)) {
      let worst: any = worstFeedbackReview(reviewsByListing[lid] || [])
      // WALKED SINCE = DONE (Jon, 2026-09-28: "if a bad review or quality inspection is done, it
      // should not populate"). A quality inspection that finished on or after the review's day
      // answers it; the row does not come back on every arrival after that. Only a review NEWER
      // than the last walk still asks for one.
      if (worst && lastWalk[lid] && lastWalk[lid] >= str(worst.created_at).slice(0, 10)) { seenFeedbackUnit.add(lid); worst = null }
      if (worst) {
        seenFeedbackUnit.add(lid)
        const quote = str(worst.content).replace(/\s+/g, ' ').slice(0, 220)
        const kw = keywordsOf(quote)
        // A finished walk from BEFORE the review is not cover (it did not see what the guest saw),
        // so only an inspection still open counts here; finished-after was handled above.
        const covered = !!openInsp
        // The automation files this one (lib/auto-inspections, arrival feedback) — nothing to ask.
        const owned = !covered && canFile(lid) && autoFeedback
        if (!owned) push({
          key: 'fb:' + lid + ':' + str(worst.id), kind: 'feedback', severity: isToday ? 'today' : 'soon', rank: isToday ? 3 : 7, owner: 'maintenance',
          due: dueArrival(isToday),
          unit, listingId: lid, market: marketOfId(lid),
          title: 'Guest arrives ' + when + ' into a unit with a ' + starsText(worst.rating, worst.channel) + ' review' + (kw.length ? ' about ' + kw.join(', ') : '') + (!covered && canFile(lid) ? ' — inspections are not automated' : ''),
          ...(!covered && canFile(lid) ? { tags: [NOT_AUTO], href: AUTOMATION_HREF } : {}),
          why: covered ? 'An inspection is already open on this unit — make sure it covers the complaint.' : canFile(lid) ? 'Nothing open on this unit addresses it. A targeted look before the guest lands is the cheapest fix.' : 'Vendor-run building — flag it to the vendor before the guest lands.',
          evidence: { quote, stars: norm5(worst.rating), date: str(worst.created_at).slice(0, 10), channel: str(worst.channel) },
          action: covered && openInsp
            ? { type: 'open', href: bz(str(openInsp.id)), label: 'Open inspection', external: true }
            : !canFile(lid) ? null
            : { type: 'create_task', label: 'Create inspection', payload: {
                listingId: lid, title: 'Quality inspection — ' + unit + (kw.length ? ' (' + kw[0] + ')' : ''), department: 'inspection', priority: 'high', date: today,
                description: 'Quality inspection before ' + str(r.guest_name || 'Guest') + ' arrives ' + checkIn + '.\n\nLook specifically at' + (kw.length ? ': ' + kw.join(', ') : ' the areas the guest named') + '.\nRecent guest feedback (' + starsText(worst.rating, worst.channel) + ', ' + str(worst.channel) + ', ' + str(worst.created_at).slice(0, 10) + '): “' + quote + '”\n\nProposed by Lighthouse Command Center (guest feedback).',
              } },
          bzTaskId: openInsp ? str(openInsp.id) : null,
        })
      }
    }
    // BACKLOG in the unit: open work scheduled BEFORE the arrival day (today's planned tasks are
    // already on the Tasks tile, and unowned ones already have an `un:` row).
    const pend = (openByListing[lid] || []).filter((t: any) => !/departure clean|strip|walkthrough/i.test(str(t.name)) && str(t.scheduled_date).slice(0, 10) < checkIn && str(t.scheduled_date).slice(0, 10) !== today)
    if (pend.length) {
      const titles = pend.map((t: any) => str(t.name).replace(MOVED, '')).slice(0, 3)
      const un = pend.find((t: any) => !names(t.assignees).length)
      const dates = Array.from(new Set(pend.map((t: any) => str(t.scheduled_date).slice(5)))).slice(0, 3)
      push({
        key: 'pend:' + str(r.id), kind: 'pending', severity: isToday ? 'today' : 'soon', rank: isToday ? 4 : 8, owner: deptOf(pend[0].type_department) === 'housekeeping' ? 'housekeeping' : 'maintenance',
        due: dueArrival(isToday),
        unit, listingId: lid, market: marketOfId(lid),
        title: pend.length + ' overdue task' + (pend.length === 1 ? '' : 's') + ' in a unit a guest lands in ' + when,
        why: titles.join(' · ') + (pend.length > 3 ? ' · +' + (pend.length - 3) + ' more' : '') + ' — scheduled ' + dates.join(', ') + (un ? '; at least one has nobody on it.' : '.'),
        action: un ? { type: 'assign', taskId: str(un.id), dept: deptOf(un.type_department), label: 'Assign' } : { type: 'open', href: bz(str(pend[0].id)), label: 'Open task', external: true },
        bzTaskId: str(pend[0].id),
      })
    }
  }

  // ── 3. DUPLICATES: same unit, same job, SAME DAY, both open ────────────────────────────────
  for (const lid of Object.keys(openByListing)) {
    const groups: Record<string, any[]> = {}
    for (const t of openByListing[lid]) {
      const k = auditKey(str(t.name).replace(MOVED, ''), t.type_department) + '@' + str(t.scheduled_date).slice(0, 10)
      ;(groups[k] = groups[k] || []).push(t)
    }
    for (const k of Object.keys(groups)) {
      const g = groups[k]
      if (g.length < 2) continue
      // Keep the one somebody's name is on (else the lowest id = oldest); propose cancelling the rest.
      const sorted = g.slice().sort((a: any, b: any) => (names(b.assignees).length ? 1 : 0) - (names(a.assignees).length ? 1 : 0) || str(a.id).localeCompare(str(b.id)))
      const keep = sorted[0], extra = sorted[1]
      const unit = nameOf(lid) || 'Unit'
      const date = str(keep.scheduled_date).slice(0, 10)
      push({
        key: 'dup:' + lid + ':' + k, kind: 'duplicate', severity: date <= today ? 'today' : 'soon', rank: 9, owner: deptOf(keep.type_department) === 'housekeeping' ? 'housekeeping' : 'maintenance',
        due: date <= today ? 'today' : 'before ' + date.slice(5),
        unit, listingId: lid, market: marketOfId(lid),
        title: 'Same job open ' + g.length + '× on ' + date.slice(5) + ': ' + str(keep.name).replace(MOVED, '').replace(/\s+/g, ' ').slice(0, 60),
        why: g.map((t: any) => '#' + str(t.id) + (names(t.assignees).length ? ' (' + names(t.assignees).join(', ') + ')' : ' (unassigned)')).join(' · ') + '. Keep #' + str(keep.id) + ', cancel #' + str(extra.id) + '.',
        action: { type: 'cancel_task', taskId: str(extra.id), label: 'Cancel duplicate' }, bzTaskId: str(keep.id),
      })
    }
  }

  // ── 4. GLITCHES (the in-app guest-issue board) ──────────────────────────────────────────────
  const glitchRows: GlitchRow[] = []
  const byLane: Record<string, number> = {}
  let glOverdue = 0, glNoTask = 0
  const taskStatus: Record<string, string> = {}
  for (const t of glitchTaskRows) taskStatus[str(t.id)] = t.finished_at || DONE.test(str(t.status)) ? 'done' : str(t.status)
  for (const g of guard<any[]>('glitches', glitchesRes as any, [])) {
    const unit = str(g.unit) || nameOf(g.listing_id) || 'Unit'
    const due = g.due_date ? str(g.due_date).slice(0, 10) : null
    const overdue = !!due && due < today
    const ageDays = g.created_at ? Math.max(0, daysBetween(str(g.created_at), today)) : 0
    const hasTask = !!str(g.breezeway_task_id)
    const lane = str(g.status) || 'pool'
    byLane[lane] = (byLane[lane] || 0) + 1
    if (overdue) glOverdue++
    if (!hasTask && (lane === 'ops' || lane === 'pool')) glNoTask++
    const issue = str(g.overview || g.glitch_type || g.category) || 'Guest issue'
    // The card itself, not the unit's search (2026-09-28 audit, D11): ?q= only filtered History.
    const href = '/glitches?id=' + encodeURIComponent(str(g.id))
    glitchRows.push({ id: str(g.id), unit, issue: issue.slice(0, 160), status: lane, due, overdue, ageDays, assignee: str(g.assignee), hasTask, taskStatus: hasTask ? (taskStatus[str(g.breezeway_task_id)] || null) : null, href })
    if (overdue || (!hasTask && lane === 'ops') || lane === 'incident') {
      push({
        key: 'gl:' + str(g.id), kind: 'glitch', severity: lane === 'incident' || overdue ? 'now' : 'today', rank: lane === 'incident' ? 1 : overdue ? 2 : 4,
        owner: hasTask ? 'maintenance' : 'desk',
        due: overdue ? 'was due ' + due!.slice(5) : due ? 'by ' + due.slice(5) : 'today',
        unit, listingId: str(g.listing_id) || null, market: marketOfId(g.listing_id),
        title: lane === 'incident' ? 'Incident open: ' + issue.slice(0, 80) : overdue ? 'Guest issue past its due date: ' + issue.slice(0, 80) : 'Guest issue in Ops with no Breezeway task: ' + issue.slice(0, 80),
        why: (g.guest_name ? str(g.guest_name) + ' · ' : '') + ageDays + 'd old' + (g.assignee ? ' · ' + str(g.assignee) : ' · nobody assigned') + (hasTask && taskStatus[str(g.breezeway_task_id)] ? ' · task ' + taskStatus[str(g.breezeway_task_id)] : ''),
        action: { type: 'open', href, label: 'Open on board' }, href, bzTaskId: hasTask ? str(g.breezeway_task_id) : null,
      })
    }
  }

  // ── 4b. REFUNDS WAITING ON A SIGN-OFF (2026-09-28 audit, D12) ───────────────────────────────
  // A refund logged over the cap sets refund_needs_approval, and Approve / Reject on the glitch card
  // clears it. Until someone does, it is a decision on the GM's desk, open glitch or not. The amount
  // rides in the title; buildCommandDay takes it out for viewers who may not see money. Before
  // migration 085 the column is not there: no rows, and nothing to report.
  const refundErr = (refundsRes as any)?.error
  const refunds = refundErr && /refund_needs_approval|42703|PGRST204/i.test(String(refundErr.code || '') + ' ' + String(refundErr.message || ''))
    ? [] : guard<any[]>('refund sign-offs', refundsRes as any, [])
  for (const g of refunds) {
    const unit = str(g.unit) || nameOf(g.listing_id) || 'Unit'
    const amount = Number(g.refund_approved) || 0
    const issue = str(g.overview || g.glitch_type || g.category) || 'Guest issue'
    const href = '/glitches?id=' + encodeURIComponent(str(g.id))
    push({
      key: REFUND_KEY + str(g.id), kind: 'refund', severity: 'today', rank: 3, owner: 'gm',
      due: 'today',
      unit, listingId: str(g.listing_id) || null, market: marketOfId(g.listing_id),
      title: 'Refund ' + (amount > 0 ? money(amount) + ' ' : '') + 'on ' + unit + ' awaiting sign-off',
      why: (g.guest_name ? str(g.guest_name) + ' · ' : '') + issue.slice(0, 100),
      action: { type: 'open', href, label: 'Review' }, href,
    })
  }

  // ── 5. CLAIMS ────────────────────────────────────────────────────────────────────────────────
  const claimRows: ClaimRow[] = []
  let clReview = 0, clDueSoon = 0
  for (const c of guard<any[]>('claims', claimsRes as any, [])) {
    const deadline = c.deadline_on ? str(c.deadline_on).slice(0, 10) : null
    const daysLeft = deadline ? Math.round((Date.parse(deadline + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null
    const stage = str(c.stage)
    const unit = [str(c.property), str(c.unit_no)].filter(Boolean).join(' ') || nameOf(c.listing_id) || 'Unit'
    const filed = stage === 'submitted' || stage === 'decided' || stage === 'settle'
    if (stage === 'review') clReview++
    const dueSoon = !filed && daysLeft != null && daysLeft <= 5
    if (dueSoon) clDueSoon++
    claimRows.push({ id: str(c.id), unit, property: str(c.property), guest: str(c.guest_name), stage, stageLabel: CLAIM_STAGE_LABEL[stage] || stage, deadline, daysLeft, amount: c.amount_sought != null ? Number(c.amount_sought) : null, waitingOn: c.waiting_on ? str(c.waiting_on) : null })
    if (stage === 'review' || dueSoon) {
      // Opens THIS claim (ClaimsBoard reads ?claim=), not the whole desk (2026-09-28 audit, D20).
      const href = '/claims?claim=' + encodeURIComponent(str(c.id))
      push({
        key: 'claim:' + str(c.id), kind: 'claim', severity: dueSoon && daysLeft != null && daysLeft <= 1 ? 'now' : 'today', rank: dueSoon ? 2 : 4, owner: 'gm',
        due: deadline ? (daysLeft != null && daysLeft < 0 ? 'deadline passed ' + deadline.slice(5) : 'file by ' + deadline.slice(5)) : 'today',
        unit, listingId: str(c.listing_id) || null, market: marketOfId(c.listing_id),
        title: stage === 'review' ? 'Claim waiting on your review' + (c.amount_sought ? ' — ' + money(Number(c.amount_sought)) : '')
          : daysLeft != null && daysLeft < 0 ? 'Claim filing deadline PASSED ' + Math.abs(daysLeft) + 'd ago' : 'Claim must be filed in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's'),
        why: str(c.guest_name || 'Guest') + ' · ' + (CLAIM_STAGE_LABEL[stage] || stage) + (c.waiting_on ? ' · waiting on ' + str(c.waiting_on) : ''),
        action: { type: 'open', href, label: 'Open claim' }, href,
      })
    }
  }

  // ── 5b. CHANNELS: a connection that BROKE on Airbnb / Booking.com / Vrbo / Expedia ─────────────
  // Read from the snapshot the listings sync writes, never recomputed here — 290 listings × 9
  // channels is the check's job, and the Command Center only needs the rows that are red today.
  // BROKEN only — failed, disconnected, suspended. "Not connected" is how a listing is set up, not
  // something that went wrong today: 217 of the 235 channel rows were "Not connected on Expedia"
  // (2026-09-29 audit), every day, burying the Fix lane. Coverage lives on the Channels page.
  // A break shared by 3+ units of one building (14 units at 17 West failing on Vrbo at once) is ONE
  // row that opens the Channels page filtered to it; the rest are one row per listing, its worst
  // channel first. GM-owned: reconnecting is a Guesty job, not a field one.
  try {
    const snap = await snapshotP
    const broken = problemsFromSnapshot(snap).filter(p => p.verdict !== 'missing')
    const EFFECT: Record<string, [string, string]> = {
      suspended: ['Airbnb is not selling it until the approval clears', 'Airbnb is not selling them until the approval clears'],
      failed: ['updates are not getting through, so rates and the calendar there can drift', 'updates are not getting through, so rates and the calendars there can drift'],
      disconnected: ['guests cannot book it there until it is reconnected', 'guests cannot book them there until they are reconnected'],
    }
    const effect = (v: string, many: boolean) => EFFECT[v] ? EFFECT[v][many ? 1 : 0] : 'check the connection in Guesty'
    const listOf = (xs: string[]) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
    const groups: Record<string, typeof broken> = {}
    for (const p of broken) if (p.building) (groups[p.building + '|' + p.platform + '|' + p.verdict] ||= []).push(p)
    const inGroup: Record<string, boolean> = {}
    for (const gk of Object.keys(groups)) {
      const g = groups[gk]
      if (g.length < 3) continue
      const lead = g[0]
      for (const p of g) inGroup[p.listingId + ':' + p.platform] = true
      const chan = CHANNEL_LABEL[lead.platform] || lead.platform
      const label = VERDICT_LABEL[lead.verdict] || lead.verdict
      const href = '/channels?building=' + encodeURIComponent(lead.building) + '&channel=' + encodeURIComponent(lead.platform) + '&problems=1'
      const names = g.map(p => p.unit)
      push({
        key: 'channel:' + lead.building + ':' + lead.platform + ':' + lead.verdict, kind: 'channel', severity: 'today', rank: 5, owner: 'gm',
        due: 'today',
        unit: lead.building, listingId: null, market: lead.market || marketOfId(lead.listingId),
        title: label + ' on ' + chan + ' · ' + g.length + ' units at ' + lead.building,
        why: chan + ' ' + label.toLowerCase() + ' on ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '') + ' — ' + effect(lead.verdict, true) + '.',
        action: { type: 'open', href, label: 'Open channels' }, href,
      })
    }
    const byListing: Record<string, typeof broken> = {}
    for (const p of broken) if (!inGroup[p.listingId + ':' + p.platform]) (byListing[p.listingId] ||= []).push(p)
    for (const lid of Object.keys(byListing)) {
      const rows = byListing[lid]
      const lead = rows[0]
      const unit = lead.unit || nameOf(lid) || 'Unit'
      const chans = rows.map(r => CHANNEL_LABEL[r.platform] || r.platform)
      const label = VERDICT_LABEL[lead.verdict] || lead.verdict
      const same = rows.every(r => r.verdict === lead.verdict)
      push({
        key: 'channel:' + lid, kind: 'channel', severity: 'today', rank: 5, owner: 'gm',
        due: 'today',
        unit, listingId: lid, market: lead.market || marketOfId(lid),
        title: label + ' on ' + (same ? listOf(chans) : chans[0] + ' +' + (chans.length - 1)),
        why: 'Guesty reports the listing ' + rows.map(r => (VERDICT_LABEL[r.verdict] || r.verdict).toLowerCase() + ' on ' + (CHANNEL_LABEL[r.platform] || r.platform)).join(', ') + ' — ' + effect(lead.verdict, false) + '.',
        action: { type: 'open', href: '/channels?listing=' + lid, label: 'Open channels' }, href: '/channels?listing=' + lid,
      })
    }
  } catch (e: any) { degraded.push('channel connections — ' + String(e?.message || e).slice(0, 80)) }

  // ── 6. GUESTS: waiting on a reply, and unhappy ─────────────────────────────────────────────
  // WAITING is the one rule (lib/response-times): the guest wrote since the last reply a person
  // could have sent, inside the last 72 hours. The row says when the reply is due ("Reply by
  // 3:05pm") or how late it is ("Late 25m"), and becomes a now-row once it is late.
  // UNHAPPY is the sentiment scan, for a CURRENT guest only (2026-09-28 audit, D8): the guest wrote
  // in the last 72 hours, or the stay is in house or lands inside 48 hours — the rows never age
  // out, so a complaint from a stay that ended weeks ago read "Unhappy guest … within the hour"
  // every morning. ONE ROW PER THREAD: a guest who is both carries both tags. Every row opens
  // THAT thread — "Reply" used to land on the inbox list, to hunt for it.
  const in48 = ymd(new Date(now.getTime() + 48 * 3600000))
  const unhappyBy: Record<string, any> = {}
  for (const s of guard<any[]>('sentiment', sentimentRes as any, [])) {
    if (!s.dissatisfied || !str(s.conversation_id)) continue
    const lastAt = Date.parse(str(s.last_guest_at || s.last_message_at))
    const wroteLately = Number.isFinite(lastAt) && now.getTime() - lastAt <= 72 * 3600000
    const stay = stayById[str(s.reservation_id)]
    const stayCurrent = !!stay && isLiveStay(stay.status) && str(stay.check_in).slice(0, 10) <= in48 && str(stay.check_out).slice(0, 10) >= today
    if (!wroteLately && !stayCurrent) continue
    unhappyBy[str(s.conversation_id)] = s
  }
  const threadBy: Record<string, any> = {}
  for (const c of waitThreads) threadBy[str(c.id)] = c
  const waitBy: Record<string, AwaitingRow> = {}
  const replyOf: Record<string, Reply> = {}
  for (const w of waiting.rows) { waitBy[w.conversation_id] = w; replyOf[w.conversation_id] = replyBy(w, now.getTime(), today) }
  for (const cid of waiting.ids.concat(Object.keys(unhappyBy).filter(id => !waitBy[id]))) {
    const w = waitBy[cid] || null, s = unhappyBy[cid] || null, c = threadBy[cid] || {}
    const reply = w ? replyOf[cid] : null
    const lid = str((s && s.listing_id) || (w && w.listing_id) || c.listing_id)
    const channel = str((s && s.channel) || (w && w.channel) || c.channel)
    const quote = str((s && s.guest_excerpt) || c.last_message_preview).replace(/\s+/g, ' ').slice(0, 140)
    const tags: RowTag[] = []
    if (s) tags.push({ label: 'Unhappy', tone: 'rose', title: 'The sentiment scan read this guest as unhappy' })
    if (reply) tags.push({ label: reply.label, tone: reply.late ? 'rose' : 'amber', title: 'Waiting on our reply — ' + SLA_RULE_TEXT })
    const hot = !!s || (!!reply && reply.late)
    const href = '/messages/' + encodeURIComponent(cid)
    push({
      key: 'guest:' + cid, kind: 'guest', severity: hot ? 'now' : 'today', rank: hot ? 2 : 5, owner: 'desk',
      due: reply ? reply.label : 'within the hour',
      unit: nameOf(lid) || 'Unit', listingId: lid || null, market: marketOfId(lid),
      title: s ? 'Unhappy guest' + (s.top_issue ? ': ' + str(s.top_issue).slice(0, 80) : '') : 'Guest waiting on a reply',
      why: (str((s && s.guest_name) || c.guest_name) || 'Guest') + (channel ? ' · ' + channel.toUpperCase() : '') + (quote ? ' · “' + quote + '”' : ''),
      tags,
      action: { type: 'open', href, label: 'Open thread' }, href,
      since: str((s && (s.last_guest_at || s.last_message_at)) || (w && (w.last_guest_at || w.awaiting_since)) || c.last_message_at) || null,
    })
  }

  // ── GUEST DESK (counts are the TRUE totals; rows are a sample the drawer labels as such) ────
  const reviewsAll = guard<any[]>('reviews to reply', reviewsToReplyRes as any, [])
  const reviews = reviewsAll.filter(r => meta[str(r.listing_id)] && meta[str(r.listing_id)].active)
  const reviewsTotal = Math.max(reviews.length, Number((reviewsToReplyRes as any)?.count) || 0)
  // Messages = guests waiting on a reply (the one rule), the ones due soonest — or latest — first.
  const dueMs = (id: string) => { const r = replyOf[id]; const t = r && r.at ? Date.parse(r.at) : NaN; return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER }
  const waitingFirst = waiting.rows.slice().sort((a, b) => dueMs(a.conversation_id) - dueMs(b.conversation_id))
  const welcomeDue = arrivalRows.filter(a => a.today && !a.welcomeDone)
  const approvals = guard<any[]>('approvals', approvalsRes as any, []).filter(r => !/^(approved|rejected)$/i.test(str(r.approval_status)))
  const deskRows: GuestDeskRow[] = []
  for (const r of reviews.slice(0, 8)) deskRows.push({ key: 'rv:' + str(r.id), kind: 'review', who: str(r.guest_name) || 'Guest', unit: nameOf(r.listing_id), text: str(r.content).replace(/\s+/g, ' ').slice(0, 140), meta: (Number.isFinite(norm5(r.rating)) ? starsText(r.rating, r.channel) + ' · ' : '') + str(r.channel), href: '/reviews' })
  for (const w of waitingFirst.slice(0, 8)) {
    const c = threadBy[w.conversation_id] || {}
    const channel = str(w.channel || c.channel)
    deskRows.push({ key: 'msg:' + w.conversation_id, kind: 'message', who: str(c.guest_name) || 'Guest', unit: nameOf(w.listing_id || c.listing_id), text: str(c.last_message_preview).slice(0, 140), meta: replyOf[w.conversation_id].label + (channel ? ' · ' + channel : ''), href: '/messages/' + encodeURIComponent(w.conversation_id) })
  }
  for (const a of welcomeDue.slice(0, 8)) deskRows.push({ key: 'wc:' + a.reservationId, kind: 'welcome', who: a.guest, unit: a.unit, text: 'Welcome call due today', meta: a.nights + ' nt · ' + money(a.value), href: '/welcome-calls' })
  for (const a of approvals.slice(0, 6)) deskRows.push({ key: 'ap:' + str(a.id), kind: 'approval', who: str(a.vendor) || str(a.type), unit: [str(a.building), str(a.unit)].filter(Boolean).join(' '), text: str(a.title), meta: a.amount_usd != null ? money(Number(a.amount_usd)) : str(a.priority), href: '/requests' })
  const deskTotal = reviewsTotal + waiting.rows.length + welcomeDue.length + approvals.length

  // ── OVERDUE: the backlog nobody sees on a "today" board ─────────────────────────────────────
  const fieldOverdue = guard<any[]>('overdue field requests', fieldOverdueRes as any, []).filter(r => r.due_at && Date.parse(String(r.due_at)) < now.getTime())
  const bzOverdueRaw = (bzOverdueCountRes as any)?.error ? (degraded.push('overdue backlog count'), 0) : (Number((bzOverdueCountRes as any)?.count) || 0)
  // The count query cannot exclude Guesty-only buildings (Botanica's stuck mirror tasks); the
  // open-task set we already hold can, so estimate the share to remove from the same window.
  const stuckNoBz = openTasks.filter((t: any) => str(t.scheduled_date).slice(0, 10) < today && (() => { const m = meta[str(t.reference_property_id)]; return !!m && noBzRe.test((m.building || '') + ' ' + m.name) })()).length
  const bzOverdue = Math.max(0, bzOverdueRaw - stuckNoBz)
  const urgentOpen = taskRows.filter(t => t.state !== 'done' && (t.prio === 'urgent' || t.prio === 'high'))
  const overdueRows: OverdueRow[] = []
  if (bzOverdue) overdueRows.push({ key: 'od:bz', kind: 'breezeway', count: bzOverdue, text: bzOverdue + ' Breezeway tasks scheduled in the last 45 days, still open', href: '/plan' })
  for (const r of fieldOverdue.slice(0, 6)) overdueRows.push({ key: 'od:fr:' + str(r.id), kind: 'field', text: [str(r.building), str(r.unit)].filter(Boolean).join(' ') + ' — ' + str(r.title) + ' (due ' + str(r.due_at).slice(5, 10) + ')', href: '/requests' })
  for (const g of glitchRows.filter(g => g.overdue).slice(0, 6)) overdueRows.push({ key: 'od:gl:' + g.id, kind: 'glitch', text: g.unit + ' — ' + g.issue.slice(0, 80) + ' (due ' + (g.due || '').slice(5) + ')', href: g.href })
  for (const t of urgentOpen.slice(0, 6)) overdueRows.push({ key: 'od:ur:' + t.taskId, kind: 'urgent', text: t.unit + ' — ' + t.name + ' · ' + t.prio + (t.who ? ' · ' + t.who : ' · unassigned'), href: bz(t.taskId) })
  const overdueTotal = bzOverdue + fieldOverdue.length + glOverdue

  // ── TEAM: the capacity model, priced per person ─────────────────────────────────────────────
  const teamRows: TeamRow[] = (cap?.people || []).map(p => ({ person: p.person, role: null, cleans: p.cleans, otherTasks: p.otherTasks, loadMinutes: p.loadMinutes, capacityMinutes: p.capacityMinutes, utilisationPct: p.utilisationPct, verdict: p.verdict, headroomCleans: p.headroomCleans, triggers: p.triggers || [], tasks: p.tasks || [] }))
    .sort((a, b) => (a.verdict === 'implausible' ? 1 : 0) - (b.verdict === 'implausible' ? 1 : 0) || b.utilisationPct - a.utilisationPct)
  const idle = teamRows.filter(p => p.verdict !== 'implausible' && p.capacityMinutes > 0 && p.cleans + p.otherTasks === 0).map(p => p.person)
  const k = cap?.kpi

  // ── 7. STAFFING: a short-staffed day one to three days out (the 14-day forecast) ──────────────
  // Booked checkouts × the pickup learned by lead time, priced in minutes, against the housekeepers
  // rostered (lib/forecast/staffing). Two at most, soonest first; the call — somebody on call comes
  // in, a day off moves — is made on /team, so the row goes there.
  for (const d of await staffingP) {
    const due = d.lead === 1 ? 'tomorrow' : 'in ' + d.lead + ' days'
    push({
      key: 'staff:' + d.market + ':' + d.date, kind: 'staffing', severity: d.lead === 1 ? 'today' : 'soon', rank: 6, owner: 'gm',
      due, unit: d.market, listingId: null, market: d.market,
      title: d.line, why: 'Staffing forecast · ' + due,
      action: { type: 'open', href: '/team', label: 'Team' }, href: '/team',
    })
  }

  // ── rank ────────────────────────────────────────────────────────────────────────────────────
  // The order never depends on who cleared what, so it is decided here, once, in the cached core.
  const sevRank = { now: 0, today: 1, soon: 2 }
  next.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.rank - b.rank || a.unit.localeCompare(b.unit))
  const callsDone = (callsDoneRes as any)?.error ? (degraded.push('calls done'), 0) : (Number((callsDoneRes as any)?.count) || 0)

  const dl = dayDeadline
  const util = k?.utilisationPct ?? null
  const tomorrowRows = arrivalRows.filter(a => a.checkIn === tomorrow)
  const tomorrowBig = tomorrowRows.filter(a => a.big).length
  const tomorrowMissing = tomorrowRows.filter(a => a.big && a.inspection === 'none').length
  const tomorrowStr = 'Tomorrow: ' + tomorrowRows.length + ' arrival' + (tomorrowRows.length === 1 ? '' : 's') + (tomorrowBig ? ' · ' + tomorrowBig + ' big' : '') + (tomorrowMissing ? ' · ' + tomorrowMissing + ' still need an inspection' : tomorrowBig ? ' · all inspected' : '')

  return {
    today, generatedAt: nowIso, degraded,
    pulse: { ...dayPulse, cleansDone: dl.done, cleansTotal: dl.cleans, minsLeft: dl.minsLeft, lastSync: day ? day.lastSync : null },
    tiles: {
      // ONE denominator: cleans on the 4pm clock + vendor cleans. Extended stays are listed but not counted.
      // late / atRisk count rows NOT started (a started clean is counted as running, see CleanRow).
      cleans: { total: dl.cleans + dl.untracked, done: dl.done, running: cleanRows.filter(r => r.status === 'running').length, late: cleanRows.filter(r => r.status === 'late').length, atRisk: cleanRows.filter(r => r.status === 'atRisk').length, vendor: dl.untracked, extended: extendedN, rows: cleanRows.sort((a, b) => cleanOrder(a) - cleanOrder(b) || a.unit.localeCompare(b.unit)) },
      arrivals: { today: arrivalRows.filter(a => a.today).length, big: arrivalRows.filter(a => a.big).length, bigToday: arrivalRows.filter(a => a.big && a.today).length, missingInspection, rows: arrivalRows.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || (b.big ? 1 : 0) - (a.big ? 1 : 0) || b.value - a.value) },
      tasks: { total: taskRows.length, open: tOpen, running: tRunning, done: tDone, unassigned: tUnassigned, late: tLate, urgent: tUrgent, byDept, rows: taskRows.sort((a, b) => taskOrder(a) - taskOrder(b) || a.unit.localeCompare(b.unit)) },
      team: { onShift: k?.peopleOnShift ?? teamRows.length, utilisationPct: util ?? 0, overloaded: k?.overloaded ?? 0, underloaded: k?.underloaded ?? 0, idle, unowned: k?.unassignedCount ?? 0, implausible: k?.implausible ?? 0, moves: (cap?.suggestions || []).slice(0, 6), notes: cap?.notes || [], rows: teamRows },
      glitches: { open: glitchRows.length, overdue: glOverdue, noTask: glNoTask, byLane, rows: glitchRows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.ageDays - a.ageDays) },
      claims: { open: claimRows.length, review: clReview, dueSoon: clDueSoon, rows: claimRows.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)) },
      overdue: { total: overdueTotal, breezeway: bzOverdue, field: fieldOverdue.length, glitches: glOverdue, urgent: urgentOpen.length, rows: overdueRows },
      guestDesk: { reviews: reviewsTotal, messages: waiting.rows.length, welcome: welcomeDue.length, approvals: approvals.length, total: deskTotal, shown: deskRows.length, rows: deskRows },
    },
    rows: next,
    clock: dl,
    util,
    unowned: tUnassigned,
    glitchesOverdue: glOverdue,
    tomorrow: tomorrowStr,
    completed: {
      cleansDone: dl.done, cleansTotal: dl.cleans,
      tasksDone: tDone, tasksTotal: taskRows.length,
      callsDone,
    },
    dayFailed: !day,
  }
}

/**
 * THE PER-REQUEST PART: the rows cleared today, and everything that reads them — the 48-hour caps,
 * the counts, Handled/Completed and the verdict. Moved out of the build unchanged (2026-09-28) so a
 * cached core gives exactly the page an uncached build gave.
 */
function withDismissals(core: CommandCore, dismissRow: any): CommandDay {
  const today = core.today
  const dismissedAll = (() => { try { const v = (dismissRow as any)?.data?.value; const o = typeof v === 'string' ? JSON.parse(v) : v; return o && typeof o === 'object' ? o : {} } catch { return {} } })()
  // A CLOSED ROW STAYS CLOSED (Jon, 2026-10-01: "if I close something it should not repopulate").
  // Every entry from the last 14 days applies, newest wins — not just today's. A guest row comes back
  // only when the guest wrote AFTER it was closed (its `since` is newer than the close).
  const dismissed: Record<string, Handled> = {}
  const todays: Record<string, true> = {}
  for (const dayKey of Object.keys(dismissedAll).sort()) {
    const entries = dismissedAll[dayKey]
    if (!entries || typeof entries !== 'object') continue
    for (const k of Object.keys(entries)) {
      const v = entries[k] || {}
      dismissed[k] = { key: k, by: str(v.by) || 'someone', at: str(v.at), outcome: v.outcome === 'done' ? 'done' : 'skipped', title: v.title ? str(v.title).slice(0, 160) : undefined, unit: v.unit ? str(v.unit).slice(0, 80) : undefined }
      if (dayKey === today) todays[k] = true; else delete todays[k]
    }
  }
  const stillClosed = (i: { key: string; since?: string | null }): Handled | null => {
    const h = dismissed[i.key]; if (!h) return null
    if (i.since && h.at && Date.parse(i.since) > Date.parse(h.at)) return null   // it moved since the close
    return h
  }
  // The core's rows arrive ranked; this only marks the ones cleared today.
  const next: NextItem[] = core.rows.map(i => ({ ...i, dismissed: stillClosed(i) }))

  // ── cap, count ──────────────────────────────────────────────────────────────────────────────
  // The 48-hour band is a heads-up, not a worklist: cap each kind so tomorrow never buries today —
  // and SAY how many were hidden, because a list that silently truncates reads as "done".
  const SOON_CAP: Partial<Record<NextKind, number>> = { feedback: 5, pending: 5, duplicate: 6 }
  const seenSoon: Record<string, number> = {}
  const hiddenSoon: Partial<Record<NextKind, number>> = {}
  const capped = next.filter(n => {
    if (n.severity !== 'soon' || n.dismissed) return true
    const c = SOON_CAP[n.kind]; if (!c) return true
    seenSoon[n.kind] = (seenSoon[n.kind] || 0) + 1
    if (seenSoon[n.kind] > c) { hiddenSoon[n.kind] = (hiddenSoon[n.kind] || 0) + 1; return false }
    return true
  })
  next.length = 0; next.push(...capped)
  const dismissedCount = next.filter(n => n.dismissed).length
  const byOwner: Record<Owner, number> = { housekeeping: 0, maintenance: 0, desk: 0, gm: 0 }
  for (const n of next) if (!n.dismissed) byOwner[n.owner]++

  // ── HANDLED TODAY: every row cleared from the list, with the live row's words when the engine
  // still generates it and the stored words when it no longer does (the recommendation was acted on).
  const liveByKey: Record<string, NextItem> = {}
  for (const n of next) liveByKey[n.key] = n
  const handled: Handled[] = Object.values(dismissed).filter(h => todays[h.key])
    .map(h => { const n = liveByKey[h.key]; return n ? { ...h, title: n.title, unit: n.unit } : h })
    .sort((a, b) => b.at.localeCompare(a.at))

  // ── THE VERDICT ─────────────────────────────────────────────────────────────────────────────
  const dl = core.clock
  const util = core.util
  const tUnassigned = core.unowned
  const glOverdue = core.glitchesOverdue
  const live = next.filter(n => !n.dismissed)
  const nowRows = live.filter(n => n.severity === 'now')
  const turnsOpen = live.filter(n => n.kind === 'turn').length
  const remaining = dl.remaining
  const past4 = dl.minsLeft < 0
  let state: Verdict['state'] = 'on_track'
  const drivers: string[] = []
  if (past4) {
    state = 'closing'
    if (remaining > 0) drivers.push(remaining + ' clean' + (remaining === 1 ? '' : 's') + ' still open past 4pm')
    if (dl.missed) drivers.push(dl.missed + ' finished late')
    if (nowRows.length) drivers.push(nowRows.length + ' issue' + (nowRows.length === 1 ? ' needs' : 's need') + ' a person now')
  } else {
    if (dl.late > 0) { state = 'behind'; drivers.push(dl.late + ' clean' + (dl.late === 1 ? '' : 's') + ' late') }
    if (turnsOpen > 0) { if (state === 'on_track') state = 'at_risk'; drivers.push(turnsOpen + ' same-day turn' + (turnsOpen === 1 ? '' : 's') + ' not started') }
    if (dl.atRisk > 0) { if (state === 'on_track') state = 'at_risk'; drivers.push(dl.atRisk + ' at risk for 4pm') }
    if (tUnassigned > 0) { if (state === 'on_track') state = 'at_risk'; drivers.push(tUnassigned + ' task' + (tUnassigned === 1 ? '' : 's') + ' unowned') }
    if (util != null && util > 100) { if (state !== 'behind') state = 'at_risk'; drivers.push('crew at ' + util + '%') }
    if (glOverdue) drivers.push(glOverdue + ' guest issue' + (glOverdue === 1 ? '' : 's') + ' overdue')
  }
  const headline = state === 'behind' ? 'Behind' : state === 'at_risk' ? 'At risk' : state === 'closing' ? (remaining > 0 ? 'Past 4pm — not closed out' : 'Day closed out') : 'On track'
  const detail = drivers.length ? drivers.slice(0, 3).join(' · ')
    : past4 ? 'Every clean landed. ' + (live.length ? live.length + ' item' + (live.length === 1 ? '' : 's') + ' left on the list for tomorrow.' : 'Nothing left on the list.')
    : dl.cleans ? dl.done + ' of ' + dl.cleans + ' cleans done' + (util != null ? ' · crew ' + util + '% loaded' : '') + ' · ' + live.length + ' item' + (live.length === 1 ? '' : 's') + ' on the list'
    : 'No cleans on the clock today' + (live.length ? ' · ' + live.length + ' item' + (live.length === 1 ? '' : 's') + ' on the list' : '')

  return {
    ok: true, today, generatedAt: core.generatedAt, degraded: core.degraded,
    verdict: { state, headline, detail, tomorrow: core.tomorrow },
    pulse: core.pulse,
    tiles: core.tiles,
    next,
    hiddenSoon,
    dismissedCount,
    byOwner,
    handled,
    completed: {
      ...core.completed,
      handledDone: handled.filter(h => h.outcome === 'done').length,
    },
  }
}

/** A dollar amount in running text: "Refund $350 on 17W-1204" → "Refund on 17W-1204". */
const AMOUNT_RE = /\s*\$\d[\d,]*(?:\.\d+)?/g
/** The day as a viewer without the money switch gets it: no amount on a refund row, live or cleared. */
function withoutRefundAmounts(day: CommandDay): CommandDay {
  const scrub = (s: string) => s.replace(AMOUNT_RE, '')
  return {
    ...day,
    next: day.next.map(n => n.kind !== 'refund' ? n : {
      ...n, title: scrub(n.title), why: scrub(n.why),
      dismissed: n.dismissed && n.dismissed.title ? { ...n.dismissed, title: scrub(n.dismissed.title) } : n.dismissed,
    }),
    handled: day.handled.map(h => h.key.startsWith(REFUND_KEY) && h.title ? { ...h, title: scrub(h.title) } : h),
  }
}

function cleanOrder(r: CleanRow) { return r.status === 'late' ? 0 : r.status === 'atRisk' ? 1 : r.sameDay && r.status !== 'done' ? 2 : r.status === 'open' ? 3 : r.status === 'running' ? 4 : r.status === 'vendor' ? 5 : r.status === 'extended' ? 7 : 6 }
function taskOrder(t: TaskRow) { return t.state === 'done' ? 9 : t.late ? 0 : t.prio === 'urgent' ? 1 : t.prio === 'high' ? 2 : !t.who ? 3 : t.state === 'running' ? 5 : 4 }
function deptOf(v: any): string { const s = str(v).toLowerCase(); if (/housekeep|clean/.test(s)) return 'housekeeping'; if (/maint/.test(s)) return 'maintenance'; if (/inspect/.test(s)) return 'inspection'; return 'maintenance' }

/** How long a day build waits on the staffing forecast before going on without its rows. */
const STAFFING_WAIT_MS = 8000

/**
 * Short-staffed days one to three days out, at most two, soonest first — lib/forecast/staffing, on
 * its own ten-minute cache. A forecast that fails, or that is still computing after
 * STAFFING_WAIT_MS on a cold cache, leaves the rows out of this build and says so in the log only:
 * the day never waits on it longer than that, and never fails because of it.
 */
async function shortDaysAhead(): Promise<StaffDay[]> {
  let timer: any = null
  try {
    const fc = await Promise.race([
      import('./forecast/staffing').then(m => m.buildStaffingForecast({ days: 14 })),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), STAFFING_WAIT_MS) }),
    ])
    if (!fc) { console.error('[command-day] staffing forecast took over ' + STAFFING_WAIT_MS + 'ms — short-day rows left out of this build'); return [] }
    return fc.short.filter(d => d.lead >= 1 && d.lead <= 3).slice(0, 2)
  } catch (e: any) {
    console.error('[command-day] staffing forecast failed — short-day rows left out:', String(e?.message || e).slice(0, 200))
    return []
  } finally { clearTimeout(timer) }
}

/** A waiting guest's reply-by state, as the row says it. */
type Reply = { at: string | null; late: boolean; label: string }
/** "25m", "1h 5m", "2d 3h". */
const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '')
  return Math.floor(h / 24) + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '')
}
/** "Reply by 3:05pm" (ET; "tomorrow" or the date when it is not today) before the reply-by time, "Late 25m" after it. */
function replyBy(w: AwaitingRow, nowMs: number, today: string): Reply {
  // Before migration 134 — or before the thread moved again — a row has no reply-by time. The same
  // rule applied to the guest's last message stands in: never earlier than the true one.
  const at = w.sla_due_at || slaDueAt(w.awaiting_since || w.last_guest_at)
  const t = at ? Date.parse(at) : NaN
  if (!Number.isFinite(t)) return { at: null, late: false, label: 'Waiting' }
  if (t <= nowMs) return { at, late: true, label: 'Late ' + span(nowMs - t) }
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    .format(new Date(t)).replace(/\s*([AP])M$/i, (_m, p: string) => p.toLowerCase() + 'm')
  const day = ymd(new Date(t))
  return { at, late: false, label: 'Reply by ' + clock + (day === today ? '' : day === shift(today, 1) ? ' tomorrow' : ' ' + day.slice(5)) }
}

/** The defect words in a review — lives in lib/review-feedback now, re-exported for old importers. */
export { keywordsOf }
