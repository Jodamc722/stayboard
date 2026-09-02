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
//               record — dedupes against open/done inspection tasks AND auto_inspections
//   feedback    a guest arrives into a unit whose recent reviews (≤3★ in the last five, 180 days,
//               naming a defect) — the quote rides with the row, and the proposed inspection carries it
//   pending     backlog (scheduled BEFORE the arrival day) still open in a unit a guest lands in
//   duplicate   the same job open twice on one unit on ONE DAY — proposes cancelling the extra one;
//               cancel stays behind the admin password (Jon: close/delete pw-gated)
//   glitch      an open guest issue that is overdue, an incident, or in the ops lane with no task
//   claim       a claim in Jon's review, or with its filing deadline inside 5 days / passed
//   guest       an in-house guest the sentiment scan marked unhappy or awaiting a reply
//   unassigned  open non-clean work on today's board with nobody attached (cleans are covered by
//               turn/late rows — never the same task twice)
//
// The model recommends; a person commits. Nothing here writes to Breezeway.
import { supabaseAdmin } from './supabase-admin'
import { buildOpsDay } from './ops-day'
import { buildDayPicture, type DayPicture } from './capacity-day'
import { getTaskAutomation } from './auto-inspections'
import { getOpsPresets } from './app-settings'
import { noBreezewayRegex } from './ops-presets'
import { auditKey } from './task-audit'
import { isLiveStay } from './stay-status'
import { STAGE_LABEL as CLAIM_STAGE_LABEL } from './claims'
import { ratingDisplay } from './review-scale'

const str = (v: any) => String(v ?? '').trim()
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
const shift = (d: string, n: number) => ymd(new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000))
const DONE = /\b(complete|finish|close|approv)/i
const GONE = /\b(cancel|delet|void)/i
const INSPECT = /inspect|unit check|quality/i
const MOVED = /^\[moved to [^\]]+\]\s*/i
// Ratings are STORED on the 5-star scale (lib/review-scale — Booking is /2 at sync), so no halving
// here; only the DISPLAY string goes back to the channel's native scale.
const norm5 = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const starsText = (v: any, ch: any) => ratingDisplay(norm5(v), ch) + (/booking/i.test(str(ch)) ? '' : '★')
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const names = (a: any): string[] => Array.isArray(a) ? a.map((p: any) => str(p && typeof p === 'object' ? p.name : p)).filter(Boolean) : []
/** Whole calendar days between two ET dates or timestamps, never off by the hour. */
const daysBetween = (fromIso: string, toYmd: string) => Math.round((Date.parse(toYmd + 'T12:00:00Z') - Date.parse(ymd(new Date(fromIso)) + 'T12:00:00Z')) / 86400000)

export const DISMISS_KEY = 'command_dismissed'

export type NextKind = 'turn' | 'late' | 'inspection' | 'feedback' | 'pending' | 'duplicate' | 'glitch' | 'claim' | 'guest' | 'unassigned'
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
  action: NextAction | null
  /** A Breezeway task this row is about — enables Note-to-assignee and the open link. */
  bzTaskId?: string | null
  href?: string | null
  dismissed?: { by: string; at: string } | null
}

export type Verdict = {
  state: 'on_track' | 'at_risk' | 'behind' | 'closing'
  headline: string
  detail: string
  /** Tomorrow's shape, so the GM can staff it today. */
  tomorrow: string
}

export type CleanRow = { taskId: string; unit: string; market: string; who: string; status: 'done' | 'running' | 'late' | 'atRisk' | 'open' | 'vendor' | 'extended'; arrivingAt: string | null; sameDay: boolean; outAt: string | null }
export type ArrivalRow = { reservationId: string; guest: string; unit: string; listingId: string | null; checkIn: string; nights: number; value: number; big: boolean; today: boolean; inspection: 'none' | 'open' | 'done' | 'n/a'; inspectionTaskId: string | null; welcomeDone: boolean }
export type TaskRow = { taskId: string; unit: string; market: string; name: string; dept: string; type: string; who: string; state: 'done' | 'running' | 'open'; prio: string; late: boolean }
export type TeamRow = { person: string; role: string | null; cleans: number; otherTasks: number; loadMinutes: number; capacityMinutes: number; utilisationPct: number; verdict: string; headroomCleans: number; triggers: string[] }
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
}

type Meta = { name: string; market: string; building: string | null; active: boolean }

export async function buildCommandDay(): Promise<CommandDay> {
  const db = supabaseAdmin()
  const now = new Date()
  const today = ymd(now)
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

  // ── WAVE 1: everything that does not depend on anything else ──────────────────────────────────
  const [day, cap, automation, presets, dismissRow, arrivalsRes, glitchesRes, claimsRes, sentimentRes, reviewsToReplyRes, convosRes, approvalsRes, fieldOverdueRes, openTasksP, bzOverdueCountRes] = await Promise.all([
    buildOpsDay(null, { includeMeta: true }),
    buildDayPicture(today).catch((e: any) => { degraded.push('capacity model — ' + String(e?.message || e).slice(0, 80)); return null as DayPicture | null }),
    getTaskAutomation(),
    getOpsPresets(),
    // Dismissals are read STRAIGHT from the table, not through the 60s settings cache: a row you
    // just dismissed must not bounce back because the next request landed on another instance.
    db.from('app_settings').select('value').eq('key', DISMISS_KEY).maybeSingle(),
    db.from('guesty_reservations')
      .select('id,listing_id,listing_name,guest_name,check_in,check_out,nights,money_total,status,custom_fields')
      .gte('check_in', today).lte('check_in', in2).order('check_in').limit(400),
    db.from('glitches')
      .select('id,listing_id,unit,status,glitch_type,category,overview,due_date,assignee,breezeway_task_id,created_at,guest_name')
      .not('status', 'in', '("done","resolved","closed")').order('created_at', { ascending: false }).limit(200),
    db.from('claims')
      .select('id,stage,waiting_on,property,unit_no,guest_name,deadline_on,amount_sought,listing_id,deleted_at')
      .neq('stage', 'closed').is('deleted_at', null).limit(200),
    db.from('guesty_conversation_sentiment')
      .select('conversation_id,guest_name,listing_id,channel,band,dissatisfied,awaiting_reply,top_issue,guest_excerpt,last_message_at,status')
      .eq('status', 'open').order('last_message_at', { ascending: false }).limit(60),
    db.from('guesty_reviews').select('id,listing_id,rating,channel,guest_name,created_at,content', { count: 'exact' })
      .eq('has_reply', false).eq('excluded_from_score', false).gte('created_at', back60 + 'T00:00:00Z')
      .order('created_at', { ascending: false }).limit(80),
    db.from('guesty_conversations').select('id,listing_id,guest_name,channel,last_message_preview,last_message_at,unread_count', { count: 'exact' })
      .gt('unread_count', 0).order('last_message_at', { ascending: false }).limit(40),
    db.from('field_requests').select('id,title,type,building,unit,vendor,amount_usd,priority,approval_status,due_at,status')
      .eq('approval_required', true).order('created_at', { ascending: false }).limit(60),
    db.from('field_requests').select('id,title,type,building,unit,vendor,amount_usd,priority,approval_status,due_at,status')
      .in('status', ['open', 'in_progress']).lt('due_at', nowIso).order('due_at').limit(60),
    // ONE task read for the duplicate scan, the pending-in-unit signal and the inspection lookup:
    // open work from 45 days back through +14. Paged.
    pageAll((a, b) => OPEN(db.from('breezeway_tasks_sync')
      .select('id,reference_property_id,name,status,scheduled_date,assignees,type_department,description:raw->>description,prio:raw->>type_priority'))
      .gte('scheduled_date', back45).lte('scheduled_date', ahead14)
      .order('scheduled_date').order('id').range(a, b)).then(rows => ({ data: rows, error: null })).catch(e => ({ data: null, error: e })),
    // The overdue backlog is a NUMBER — ask for a count, not 8,000 rows.
    OPEN(db.from('breezeway_tasks_sync').select('id', { count: 'exact', head: true }))
      .gte('scheduled_date', back45).lt('scheduled_date', today),
  ])

  // ── listing meta comes from the board's own map (vendor-aware market, no second read) ─────────
  const meta: Record<string, Meta> = (day.listingMeta || {}) as any
  if (!Object.keys(meta).length) degraded.push('listings')
  const nameOf = (id: any) => (meta[str(id)] || {}).name || ''
  const marketOfId = (id: any) => (meta[str(id)] || {}).market || null
  const noBzRe = noBreezewayRegex(presets.vendorBuildings)
  const canFile = (lid: string) => { const m = meta[lid]; return !!m && !noBzRe.test((m.building || '') + ' ' + m.name) }

  const dismissedAll = (() => { try { const v = (dismissRow as any)?.data?.value; const o = typeof v === 'string' ? JSON.parse(v) : v; return o && typeof o === 'object' ? o : {} } catch { return {} } })()
  const dismissed: Record<string, { by: string; at: string }> = (dismissedAll[today] && typeof dismissedAll[today] === 'object') ? dismissedAll[today] : {}

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
  const truthy = (v: any) => v === true || v === 1 || (typeof v === 'string' && /^(y|yes|true|done|complete|1|x)/i.test(v.trim()))
  const fieldVal = (cf: any, kw: string) => Array.isArray(cf) ? (cf.find((c: any) => str(c?.fieldName || c?.name).toLowerCase().includes(kw)) || {}).value : undefined
  const glitchTaskIds = guard<any[]>('glitches', glitchesRes as any, []).map(g => str(g.breezeway_task_id)).filter(Boolean)

  // ── WAVE 2: keyed on the arriving units, all in parallel ─────────────────────────────────────
  const [arrivalReviews, autoInsp, doneInspRows, glitchTaskRows] = await Promise.all([
    // Recent reviews only (180d) — bounded by date, not by an arbitrary row cap that starves quiet units.
    arrivalIds.length
      ? db.from('guesty_reviews').select('id,listing_id,rating,content,guest_name,channel,created_at')
          .in('listing_id', arrivalIds.slice(0, 300)).eq('excluded_from_score', false).gte('created_at', back180 + 'T00:00:00Z')
          .order('created_at', { ascending: false }).limit(3000).then(r => guard<any[]>('arrival reviews', r as any, []))
      : Promise.resolve([] as any[]),
    arrivalIds.length
      ? db.from('auto_inspections').select('reservation_id,listing_id,task_id,check_in')
          .in('listing_id', arrivalIds.slice(0, 300)).gte('check_in', back45).lte('check_in', in2).then(r => guard<any[]>('auto inspections', r as any, []))
      : Promise.resolve([] as any[]),
    // Finished inspections on the arriving units — the name filter is in SQL so the row cap can
    // never drop the one that mattered.
    arrivalIds.length
      ? db.from('breezeway_tasks_sync').select('id,reference_property_id,name')
          .in('reference_property_id', arrivalIds.slice(0, 300)).gte('scheduled_date', back45).lte('scheduled_date', in2)
          .not('finished_at', 'is', null)
          .or('name.ilike.%inspect%,name.ilike.%unit%check%,name.ilike.%quality%')
          .limit(2000).then(r => guard<any[]>('done inspections', r as any, []))
      : Promise.resolve([] as any[]),
    glitchTaskIds.length
      ? db.from('breezeway_tasks_sync').select('id,status,finished_at').in('id', glitchTaskIds.slice(0, 200)).then(r => guard<any[]>('glitch tasks', r as any, []))
      : Promise.resolve([] as any[]),
  ])

  const next: NextItem[] = []
  const push = (i: Omit<NextItem, 'dismissed'>) => next.push({ ...i, dismissed: dismissed[i.key] || null })
  const bz = (id: string) => 'https://app.breezeway.io/task/' + id
  const FOUR = '4:00 PM'

  // ── 1. THE BOARD: turns, late/at-risk cleans, unowned work (from lib/ops-day) ────────────────
  const units = Array.isArray(day.units) ? day.units : []
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
          status: extended ? 'extended' : (t.guestyOnly || t.untracked) ? 'vendor' : t.done ? 'done' : t.late ? 'late' : t.atRisk ? 'atRisk' : t.running ? 'running' : 'open',
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
        due: 'before ' + (u.arrivingAt || FOUR) + ' arrival',
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
  const inspByRes = new Set(autoInsp.filter((a: any) => a.task_id).map((a: any) => str(a.reservation_id)))
  const doneInsp: Record<string, string> = {}
  for (const t of doneInspRows) doneInsp[str(t.reference_property_id)] = str(t.id)
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
    const inspection: ArrivalRow['inspection'] = !canFile(lid) && !openInsp && !doneInsp[lid] ? 'n/a' : openInsp ? 'open' : (doneInsp[lid] || inspByRes.has(str(r.id))) ? 'done' : 'none'
    const welcomeDone = truthy(fieldVal(r.custom_fields, 'welcome'))
    arrivalRows.push({ reservationId: str(r.id), guest: str(r.guest_name) || 'Guest', unit, listingId: lid || null, checkIn, nights, value, big, today: isToday, inspection, inspectionTaskId: openInsp ? str(openInsp.id) : (doneInsp[lid] || null), welcomeDone })

    if (!isToday && !isTomorrow) continue
    const when = isToday ? 'today' : 'tomorrow'
    if (big && inspection === 'none') {
      missingInspection++
      push({
        key: 'insp:' + str(r.id), kind: 'inspection', severity: isToday ? 'today' : 'soon', rank: isToday ? 2 : 6, owner: 'maintenance',
        due: isToday ? 'before ' + FOUR + ' arrival' : 'tomorrow, before ' + FOUR,
        unit, listingId: lid, market: marketOfId(lid),
        title: 'Big arrival ' + when + ' with no pre-arrival inspection',
        why: str(r.guest_name || 'Guest') + ' · ' + nights + ' nights · ' + money(value) + '. No inspection open or completed on this unit in 45 days.',
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
      let worst: any = null
      for (const rv of (reviewsByListing[lid] || []).slice(0, 5)) {
        const n = norm5(rv.rating)
        if (!Number.isFinite(n) || n > 3) continue
        if (n > 2 && keywordsOf(str(rv.content)).length === 0) continue
        if (!worst || n < norm5(worst.rating)) worst = rv
      }
      if (worst) {
        seenFeedbackUnit.add(lid)
        const quote = str(worst.content).replace(/\s+/g, ' ').slice(0, 220)
        const kw = keywordsOf(quote)
        const covered = !!openInsp || !!doneInsp[lid]
        push({
          key: 'fb:' + lid + ':' + str(worst.id), kind: 'feedback', severity: isToday ? 'today' : 'soon', rank: isToday ? 3 : 7, owner: 'maintenance',
          due: isToday ? 'before ' + FOUR + ' arrival' : 'tomorrow, before ' + FOUR,
          unit, listingId: lid, market: marketOfId(lid),
          title: 'Guest arrives ' + when + ' into a unit with a ' + starsText(worst.rating, worst.channel) + ' review' + (kw.length ? ' about ' + kw.join(', ') : ''),
          why: covered ? 'An inspection is already ' + (openInsp ? 'open' : 'done') + ' on this unit — check it covered the complaint.' : canFile(lid) ? 'Nothing open on this unit addresses it. A targeted look before the guest lands is the cheapest fix.' : 'Vendor-run building — flag it to the vendor before the guest lands.',
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
        due: isToday ? 'before ' + FOUR + ' arrival' : 'tomorrow, before ' + FOUR,
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
    const href = '/glitches?q=' + encodeURIComponent(unit)
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
      push({
        key: 'claim:' + str(c.id), kind: 'claim', severity: dueSoon && daysLeft != null && daysLeft <= 1 ? 'now' : 'today', rank: dueSoon ? 2 : 4, owner: 'gm',
        due: deadline ? (daysLeft != null && daysLeft < 0 ? 'deadline passed ' + deadline.slice(5) : 'file by ' + deadline.slice(5)) : 'today',
        unit, listingId: str(c.listing_id) || null, market: marketOfId(c.listing_id),
        title: stage === 'review' ? 'Claim waiting on your review' + (c.amount_sought ? ' — ' + money(Number(c.amount_sought)) : '')
          : daysLeft != null && daysLeft < 0 ? 'Claim filing deadline PASSED ' + Math.abs(daysLeft) + 'd ago' : 'Claim must be filed in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's'),
        why: str(c.guest_name || 'Guest') + ' · ' + (CLAIM_STAGE_LABEL[stage] || stage) + (c.waiting_on ? ' · waiting on ' + str(c.waiting_on) : ''),
        action: { type: 'open', href: '/claims', label: 'Open claims' }, href: '/claims',
      })
    }
  }

  // ── 6. GUESTS: sentiment scan ───────────────────────────────────────────────────────────────
  for (const s of guard<any[]>('sentiment', sentimentRes as any, [])) {
    if (!s.dissatisfied && !s.awaiting_reply) continue
    const unit = nameOf(s.listing_id) || 'Unit'
    push({
      key: 'guest:' + str(s.conversation_id), kind: 'guest', severity: s.dissatisfied ? 'now' : 'today', rank: s.dissatisfied ? 2 : 5, owner: 'desk',
      due: s.dissatisfied ? 'within the hour' : 'today',
      unit, listingId: str(s.listing_id) || null, market: marketOfId(s.listing_id),
      title: (s.dissatisfied ? 'Unhappy guest' : 'Guest waiting on a reply') + (s.top_issue ? ': ' + str(s.top_issue).slice(0, 80) : ''),
      why: str(s.guest_name || 'Guest') + ' · ' + str(s.channel).toUpperCase() + (s.guest_excerpt ? ' · “' + str(s.guest_excerpt).replace(/\s+/g, ' ').slice(0, 140) + '”' : ''),
      action: { type: 'open', href: '/messages', label: 'Open thread' }, href: '/messages',
    })
  }

  // ── GUEST DESK (counts are the TRUE totals; rows are a sample the drawer labels as such) ────
  const reviewsAll = guard<any[]>('reviews to reply', reviewsToReplyRes as any, [])
  const reviews = reviewsAll.filter(r => meta[str(r.listing_id)] && meta[str(r.listing_id)].active)
  const reviewsTotal = Math.max(reviews.length, Number((reviewsToReplyRes as any)?.count) || 0)
  const convos = guard<any[]>('unread messages', convosRes as any, [])
  const convosTotal = Math.max(convos.length, Number((convosRes as any)?.count) || 0)
  const welcomeDue = arrivalRows.filter(a => a.today && !a.welcomeDone)
  const approvals = guard<any[]>('approvals', approvalsRes as any, []).filter(r => !/^(approved|rejected)$/i.test(str(r.approval_status)))
  const deskRows: GuestDeskRow[] = []
  for (const r of reviews.slice(0, 8)) deskRows.push({ key: 'rv:' + str(r.id), kind: 'review', who: str(r.guest_name) || 'Guest', unit: nameOf(r.listing_id), text: str(r.content).replace(/\s+/g, ' ').slice(0, 140), meta: (Number.isFinite(norm5(r.rating)) ? starsText(r.rating, r.channel) + ' · ' : '') + str(r.channel), href: '/reviews' })
  for (const c of convos.slice(0, 8)) deskRows.push({ key: 'msg:' + str(c.id), kind: 'message', who: str(c.guest_name) || 'Guest', unit: nameOf(c.listing_id), text: str(c.last_message_preview).slice(0, 140), meta: (Number(c.unread_count) || 0) + ' unread · ' + str(c.channel), href: '/messages' })
  for (const a of welcomeDue.slice(0, 8)) deskRows.push({ key: 'wc:' + a.reservationId, kind: 'welcome', who: a.guest, unit: a.unit, text: 'Welcome call due today', meta: a.nights + ' nt · ' + money(a.value), href: '/welcome-calls' })
  for (const a of approvals.slice(0, 6)) deskRows.push({ key: 'ap:' + str(a.id), kind: 'approval', who: str(a.vendor) || str(a.type), unit: [str(a.building), str(a.unit)].filter(Boolean).join(' '), text: str(a.title), meta: a.amount_usd != null ? money(Number(a.amount_usd)) : str(a.priority), href: '/requests' })
  const deskTotal = reviewsTotal + convosTotal + welcomeDue.length + approvals.length

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
  const teamRows: TeamRow[] = (cap?.people || []).map(p => ({ person: p.person, role: null, cleans: p.cleans, otherTasks: p.otherTasks, loadMinutes: p.loadMinutes, capacityMinutes: p.capacityMinutes, utilisationPct: p.utilisationPct, verdict: p.verdict, headroomCleans: p.headroomCleans, triggers: p.triggers || [] }))
    .sort((a, b) => (a.verdict === 'implausible' ? 1 : 0) - (b.verdict === 'implausible' ? 1 : 0) || b.utilisationPct - a.utilisationPct)
  const idle = teamRows.filter(p => p.verdict !== 'implausible' && p.capacityMinutes > 0 && p.cleans + p.otherTasks === 0).map(p => p.person)
  const k = cap?.kpi

  // ── rank, cap, count ────────────────────────────────────────────────────────────────────────
  const sevRank = { now: 0, today: 1, soon: 2 }
  next.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.rank - b.rank || a.unit.localeCompare(b.unit))
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

  // ── THE VERDICT ─────────────────────────────────────────────────────────────────────────────
  const dl = day.deadline
  const pulse = day.pulse
  const live = next.filter(n => !n.dismissed)
  const nowRows = live.filter(n => n.severity === 'now')
  const turnsOpen = live.filter(n => n.kind === 'turn').length
  const remaining = dl.remaining
  const util = k?.utilisationPct ?? null
  const past4 = dl.minsLeft < 0
  let state: Verdict['state'] = 'on_track'
  const drivers: string[] = []
  if (past4) {
    state = 'closing'
    if (remaining > 0) drivers.push(remaining + ' clean' + (remaining === 1 ? '' : 's') + ' still open past 4pm')
    if (dl.missed) drivers.push(dl.missed + ' finished late')
    if (nowRows.length) drivers.push(nowRows.length + ' issue' + (nowRows.length === 1 ? '' : 's') + ' need a person now')
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
  const tomorrowRows = arrivalRows.filter(a => a.checkIn === tomorrow)
  const tomorrowBig = tomorrowRows.filter(a => a.big).length
  const tomorrowMissing = tomorrowRows.filter(a => a.big && a.inspection === 'none').length
  const tomorrowStr = 'Tomorrow: ' + tomorrowRows.length + ' arrival' + (tomorrowRows.length === 1 ? '' : 's') + (tomorrowBig ? ' · ' + tomorrowBig + ' big' : '') + (tomorrowMissing ? ' · ' + tomorrowMissing + ' still need an inspection' : tomorrowBig ? ' · all inspected' : '')

  return {
    ok: true, today, generatedAt: nowIso, degraded,
    verdict: { state, headline, detail, tomorrow: tomorrowStr },
    pulse: { ...pulse, cleansDone: dl.done, cleansTotal: dl.cleans, minsLeft: dl.minsLeft, lastSync: day.lastSync },
    tiles: {
      // ONE denominator: cleans on the 4pm clock + vendor cleans. Extended stays are listed but not counted.
      cleans: { total: dl.cleans + dl.untracked, done: dl.done, running: dl.running, late: dl.late, atRisk: dl.atRisk, vendor: dl.untracked, extended: extendedN, rows: cleanRows.sort((a, b) => cleanOrder(a) - cleanOrder(b) || a.unit.localeCompare(b.unit)) },
      arrivals: { today: arrivalRows.filter(a => a.today).length, big: arrivalRows.filter(a => a.big).length, bigToday: arrivalRows.filter(a => a.big && a.today).length, missingInspection, rows: arrivalRows.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || (b.big ? 1 : 0) - (a.big ? 1 : 0) || b.value - a.value) },
      tasks: { total: taskRows.length, open: tOpen, running: tRunning, done: tDone, unassigned: tUnassigned, late: tLate, urgent: tUrgent, byDept, rows: taskRows.sort((a, b) => taskOrder(a) - taskOrder(b) || a.unit.localeCompare(b.unit)) },
      team: { onShift: k?.peopleOnShift ?? teamRows.length, utilisationPct: util ?? 0, overloaded: k?.overloaded ?? 0, underloaded: k?.underloaded ?? 0, idle, unowned: k?.unassignedCount ?? 0, implausible: k?.implausible ?? 0, moves: (cap?.suggestions || []).slice(0, 6), notes: cap?.notes || [], rows: teamRows },
      glitches: { open: glitchRows.length, overdue: glOverdue, noTask: glNoTask, byLane, rows: glitchRows.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || b.ageDays - a.ageDays) },
      claims: { open: claimRows.length, review: clReview, dueSoon: clDueSoon, rows: claimRows.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)) },
      overdue: { total: overdueTotal, breezeway: bzOverdue, field: fieldOverdue.length, glitches: glOverdue, urgent: urgentOpen.length, rows: overdueRows },
      guestDesk: { reviews: reviewsTotal, messages: convosTotal, welcome: welcomeDue.length, approvals: approvals.length, total: deskTotal, shown: deskRows.length, rows: deskRows },
    },
    next,
    hiddenSoon,
    dismissedCount,
    byOwner,
  }
}

function cleanOrder(r: CleanRow) { return r.status === 'late' ? 0 : r.status === 'atRisk' ? 1 : r.sameDay && r.status !== 'done' ? 2 : r.status === 'open' ? 3 : r.status === 'running' ? 4 : r.status === 'vendor' ? 5 : r.status === 'extended' ? 7 : 6 }
function taskOrder(t: TaskRow) { return t.state === 'done' ? 9 : t.late ? 0 : t.prio === 'urgent' ? 1 : t.prio === 'high' ? 2 : !t.who ? 3 : t.state === 'running' ? 5 : 4 }
function deptOf(v: any): string { const s = str(v).toLowerCase(); if (/housekeep|clean/.test(s)) return 'housekeeping'; if (/maint/.test(s)) return 'maintenance'; if (/inspect/.test(s)) return 'inspection'; return 'maintenance' }

/** The defect words in a review, so the proposed inspection says what to look at. */
export function keywordsOf(text: string): string[] {
  const t = text.toLowerCase()
  const out: string[] = []
  const KW: [RegExp, string][] = [
    [/dirty|unclean|filthy|hair|stain|dust|smell|odor|mold|mould|damp|grime|crumbs|sticky/, 'cleanliness'],
    [/\ba\/?c\b|air ?con|ac unit|hot inside|cooling|thermostat/, 'A/C'],
    [/wifi|wi-fi|internet|tv\b|remote|netflix/, 'Wi-Fi / TV'],
    [/lock|code|key|door|check[- ]?in|access|elevator|gate/, 'access'],
    [/noise|loud|construction|party|neighbo/, 'noise'],
    [/water|shower|leak|plumb|toilet|drain|hot water|pressure/, 'plumbing'],
    [/bed|mattress|pillow|linen|sheet|towel|blanket/, 'bedding / linens'],
    [/bug|roach|ant\b|ants\b|pest|mosquito/, 'pests'],
    [/broken|not work|didn.t work|doesn.t work|fix|repair|maintenance/, 'repairs'],
    [/kitchen|stove|oven|fridge|refrigerator|microwave|coffee|dishwasher|utensil|pan\b|pots/, 'kitchen'],
    [/parking|garage|valet/, 'parking'],
  ]
  for (const [re, label] of KW) if (re.test(t) && !out.includes(label)) out.push(label)
  return out.slice(0, 3)
}
